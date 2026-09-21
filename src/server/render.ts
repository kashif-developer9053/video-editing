/**
 * The render orchestrator.
 *
 * Rasterize → composite frame by frame → pipe into FFmpeg. The frame-reuse
 * cache here is what turns a ten-minute render into a one-minute one: in
 * slide mode most frames are identical to the one before, so we hand the
 * encoder the same buffer again instead of repainting it.
 */

import { createCanvas } from "@napi-rs/canvas";
import { drawFrame, prepareFrameContext } from "@/engine/compositor";
import { RenderEstimator } from "@/engine/estimate";
import { frameKey } from "@/engine/framekey";
import { layout, outputSize } from "@/engine/layout";
import type { JobProgress, Settings } from "@/engine/types";
import { encoderFor, startEncoder } from "./ffmpeg";
import { rasterizePdf, releasePages } from "./raster";

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
  report({ status: "rasterizing", message: "Reading the PDF" });

  const { pages } = await rasterizePdf({
    data: input.pdf,
    pageFrom: settings.pageFrom,
    pageTo: settings.pageTo,
    outputWidth: out.width,
    signal,
    onProgress: (done, total) => {
      report({
        status: "rasterizing",
        progress: (done / total) * 0.15,
        message: `Preparing page ${done} of ${total}`,
      });
    },
  });

  if (!pages.length) {
    throw new Error("The selected page range produced no pages.");
  }

  try {
    /* ---- 2. set up compositing ---- */
    const layoutResult = layout(pages, settings);
    const fc = prepareFrameContext(layoutResult, pages, settings);

    const canvas = createCanvas(out.width, out.height);
    const ctx = canvas.getContext("2d");

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
          // Copy out of the canvas: the next draw would otherwise mutate
          // the buffer we are about to reuse.
          lastBuffer = Buffer.from(canvas.data());
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
            message: `Rendering frame ${estimator.done} of ${totalFrames}`,
          });
        }
      }

      report({
        status: "encoding",
        progress: 0.96,
        framesDone: totalFrames,
        framesTotal: totalFrames,
        etaSeconds: null,
        message: "Finishing the file",
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
      message: "Done",
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
    // Always drop the bitmaps, including on failure — 50 rasterized pages
    // is the largest thing this process holds.
    releasePages(pages);
  }
}
