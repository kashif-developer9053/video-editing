/**
 * Pre-scaling pages to their drawn size.
 *
 * node-canvas rescales in software on every drawImage, and that dominates a
 * render: a page bitmap 1.5x the size it is drawn at measured ~250ms per
 * frame, against ~2ms to read the finished frame out. Since every frame draws
 * the same page at the same size, that scaling is the same work repeated
 * hundreds of times.
 *
 * So each page is resampled once, up front, to exactly the pixels it will
 * occupy. Per-frame draws then become 1:1 blits.
 *
 * Zoom modes are the exception: they scale continuously, so there is no
 * single size to pre-scale to, and they keep the original bitmap.
 */

import { drawnPageWidth, outputSize } from "@/engine/layout";
import type { DrawablePage, Settings } from "@/engine/types";
import { createCanvas } from "./canvas";

/** Below this much difference, resampling costs more than it saves. */
const WORTH_IT_RATIO = 1.02;

export function shouldPrescale(settings: Settings): boolean {
  // Slow zoom changes scale every frame, so no fixed size exists.
  return settings.mode !== "kenburns";
}

/**
 * Resample pages to their drawn width, in place. Returns how many were
 * changed, for logging.
 */
export function prescalePages(pages: DrawablePage[], settings: Settings): number {
  if (!shouldPrescale(settings) || !pages.length) return 0;

  const targetWidth = Math.round(drawnPageWidth(settings));
  if (targetWidth < 1) return 0;

  let changed = 0;

  for (const page of pages) {
    // Scale by whichever axis is further off. A portrait page in a landscape
    // frame is drawn much shorter than it is narrow, and matching only the
    // width leaves the expensive vertical resample on every frame.
    const ratio = drawRatio(page, targetWidth, settings);
    // Already the right size, or smaller — upscaling here would only blur it.
    if (ratio <= WORTH_IT_RATIO) continue;

    const width = Math.max(1, Math.round(page.width / ratio));
    const height = Math.max(1, Math.round(page.height / ratio));
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // One good-quality resample, paid once instead of once per frame.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(page.bitmap as unknown as CanvasImageSource, 0, 0, width, height);

    const old = page.bitmap as unknown as { width: number; height: number };
    page.bitmap = canvas as unknown as CanvasImageSource;
    page.width = width;
    page.height = height;

    // Release the original promptly rather than waiting on GC.
    try {
      old.width = 0;
      old.height = 0;
    } catch {
      // Not every image source is resizable.
    }

    changed++;
  }

  return changed;
}

/**
 * How much larger a page's bitmap is than the pixels it will occupy.
 *
 * In slide modes a portrait page is fitted to the frame, so its drawn height
 * is the binding constraint, not its width. Scaling by the width alone would
 * leave a 1667px-tall bitmap being squeezed into a 720px frame on every
 * single frame of the render.
 */
function drawRatio(
  page: { width: number; height: number },
  targetWidth: number,
  settings: Settings,
): number {
  const byWidth = page.width / targetWidth;

  const scrolling = settings.mode === "scroll" || settings.mode === "autopace";
  if (scrolling || settings.fit === "width") {
    // A scrolling strip and a fill-width page are both sized by width; their
    // height follows, and the part past the frame is simply off screen.
    return byWidth;
  }

  const out = outputSize(settings);
  const pad = Math.round(out.width * (settings.margin / 100));
  const drawnHeight = Math.min(
    page.height * (targetWidth / page.width),
    out.height - pad * 2,
  );
  const byHeight = page.height / Math.max(1, drawnHeight);

  // Never shrink past what the width needs, or the page turns soft.
  return Math.min(byWidth, byHeight);
}
