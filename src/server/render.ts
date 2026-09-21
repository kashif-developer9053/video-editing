/**
 * The render orchestrator.
 *
 * Rasterize → composite frame by frame → pipe into FFmpeg. The frame-reuse
 * cache here is what turns a ten-minute render into a one-minute one: in
 * slide mode most frames are identical to the one before, so we hand the
 * encoder the same buffer again instead of repainting it.
 */

import { drawFrame, prepareFrameContext } from "@/engine/compositor";
import { RenderEstimator } from "@/engine/estimate";
import { frameKey } from "@/engine/framekey";
import { drawnPageWidth, layout, outputSize } from "@/engine/layout";
import type { JobProgress, Settings } from "@/engine/types";
import { createCanvas, frameBytes, isTightlyPacked } from "./canvas";
import { encoderFor, startEncoder } from "./ffmpeg";
import { prescalePages } from "./prescale";
import { rasterizePdf, releasePages } from "./raster";
import { buildStrip, drawStripSlice, releaseStrip, type Strip } from "./strip";

export interface RenderInput {
  pdf: Uint8Array;
  settings: Settings;
  outputPath: string;
  audioPath?: string | null;
  onProgress?: (progress: JobProgress) => void;
  signal?: AbortSignal;
}

export interface RenderOutput {
  outputPath: string;
  width: number;
  height: number;
  frames: number;
  uniqueFrames: number;
  encoder: string;
  elapsedSeconds: number;
}

export async function renderVideo(input: RenderInput): Promise<RenderOutput> {
  const { settings, signal } = input;
  const out = outputSize(settings);
  const startedAt = Date.now();

  const report = (patch: Partial<JobProgress>) => {
    input.onProgress?.({
      status: "rendering",
      progress: 0,
      framesDone: 0,
      framesTotal: 0,
      etaSeconds: null,
      message: "",
      ...patch,
    } as JobProgress);
  };

  /* ---- 1. rasterize ---- */
  report({ status: "rasterizing", message: "Opening your PDF" });

  const { pages } = await rasterizePdf({
    data: input.pdf,
    pageFrom: settings.pageFrom,
    pageTo: settings.pageTo,
    outputWidth: drawnPageWidth(settings),
    signal,
    onProgress: (done, total) => {
      report({
        status: "rasterizing",
        progress: (done / total) * 0.15,
        message: `Reading page ${done} of ${total}`,
      });
    },
  });

  if (!pages.length) {
    throw new Error("No pages were selected.");
  }

  let strip: Strip | null = null;

  // Resample each page once to the size it will be drawn at, so the frame
  // loop is blitting rather than rescaling. Worth roughly 3x on a render.
  prescalePages(pages, settings);

  try {
    /* ---- 2. set up compositing ---- */
    const layoutResult = layout(pages, settings);

    // Scrolling modes move a camera down an unchanging column of pages, so
    // the column is drawn once and each frame becomes a single blit. Without
    // this, every frame redraws every visible page and a scrolling video
    // costs several times what a slide one does.
    const scrolling = settings.mode === "scroll" || settings.mode === "autopace";
    strip = scrolling ? buildStrip(layoutResult, settings.background) : null;

    const fc = prepareFrameContext(layoutResult, pages, settings);
    if (strip) {
      const held = strip;
      fc.strip = {
        height: held.height,
        draw: (c, cameraY, o) => drawStripSlice(c as never, held, cameraY, o),
      };
    }

    const canvas = createCanvas(out.width, out.height);
    const ctx = canvas.getContext("2d");

    // Row padding would shear every frame, since ffmpeg assumes tightly
    // packed rows. Output widths are forced even, so this should never fire.
    if (!isTightlyPacked(canvas)) {
      throw new Error(`Canvas stride ${canvas.stride} does not match width ${out.width}`);
    }

    const totalFrames = Math.max(1, Math.round(settings.duration * settings.fps));
    const encoder = await encoderFor(out.width, out.height);

    const sink = startEncoder({
      width: out.width,
      height: out.height,
      fps: settings.fps,
      outputPath: input.outputPath,
      audioPath: input.audioPath ?? null,
      audioVolume: settings.musicVolume,
      audioFade: settings.musicFade,
      audioLoop: settings.musicLoop,
      durationSeconds: settings.duration,
      encoder,
    });

    const estimator = new RenderEstimator(totalFrames);
    estimator.start();

    /* ---- 3. frame loop with reuse ---- */
    let lastKey: string | null = null;
    // Holds the previous frame's pixels so an identical frame costs a copy
    // rather than a full repaint.
    let lastBuffer: Buffer | null = null;
    let uniqueFrames = 0;

    try {
      for (let i = 0; i < totalFrames; i++) {
        if (signal?.aborted) throw new Error("cancelled");

        const time = i / settings.fps;
        const key = frameKey(time, fc);

        if (key !== lastKey || lastBuffer === null) {
          drawFrame(ctx, time, fc);
          // frameBytes hands back the canvas's own memory, so it has to be
          // copied: the next draw would otherwise rewrite the buffer this
          // cache is holding for reuse.
          lastBuffer = Buffer.from(frameBytes(canvas));
          lastKey = key;
          uniqueFrames++;
        }

        await sink.write(lastBuffer);
        estimator.tick();

        // Reporting every frame would spend more time on JSON than on
        // pixels; twice a second is enough for a smooth countdown.
        if (i % Math.max(1, Math.round(settings.fps / 2)) === 0 || i === totalFrames - 1) {
          report({
            status: "rendering",
            progress: 0.15 + estimator.progress * 0.8,
            framesDone: estimator.done,
            framesTotal: totalFrames,
            etaSeconds: estimator.etaSeconds(),
            message: "Making your video",
          });
        }
      }

      report({
        status: "encoding",
        progress: 0.96,
        framesDone: totalFrames,
        framesTotal: totalFrames,
        etaSeconds: null,
        message: "Almost done",
      });

      await sink.finish();
    } catch (err) {
      sink.abort();
      throw err;
    }

    const elapsedSeconds = (Date.now() - startedAt) / 1000;

    report({
      status: "done",
      progress: 1,
      framesDone: totalFrames,
      framesTotal: totalFrames,
      etaSeconds: 0,
      message: "Finished",
    });

    return {
      outputPath: input.outputPath,
      width: out.width,
      height: out.height,
      frames: totalFrames,
      uniqueFrames,
      encoder: encoder.label,
      elapsedSeconds,
    };
  } finally {
    // Always drop the bitmaps, including on failure — the rasterized pages
    // and the scroll strip are the largest things this process holds.
    releaseStrip(strip);
    releasePages(pages);
  }
}
