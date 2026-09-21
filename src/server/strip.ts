/**
 * Pre-rendering the scroll strip.
 *
 * Scrolling modes move a camera down a column of pages. Nothing in that
 * column changes between frames — only the camera position does — yet the
 * compositor was redrawing every visible page, with its shadow, on every
 * single frame. That is why scroll and smart-speed got no benefit from the
 * frame-reuse cache and ran several times slower than slide mode.
 *
 * Drawing the whole strip once turns each frame into a single blit of the
 * visible slice. The cost is memory: a tall strip at 1080p is large, so it
 * is built in horizontal bands and only when it is small enough to be worth
 * holding.
 */

import { drawPageInto } from "@/engine/compositor";
import type { Layout, OutputSize } from "@/engine/types";
import { createCanvas, type ServerCanvas } from "./canvas";

/**
 * Largest strip worth holding in memory, in pixels.
 *
 * 120 megapixels is roughly 480MB of RGBA — acceptable on a laptop with a
 * few gigabytes free, and enough for a 50-page document at 1080p. Past that
 * the fallback of drawing pages per frame is slower but bounded.
 */
const MAX_STRIP_PIXELS = 120_000_000;

export interface Strip {
  canvas: ServerCanvas;
  /** Height of one repeat of the strip, in strip pixels. */
  height: number;
}

export function canBuildStrip(layout: Layout): boolean {
  const height = Math.ceil(layout.totalHeight);
  return height > 0 && layout.out.width * height <= MAX_STRIP_PIXELS;
}

/**
 * Draw every page into one tall canvas, in the positions the layout gives.
 * Returns null when the strip would be too large to hold.
 */
export function buildStrip(layout: Layout, background: string): Strip | null {
  if (!canBuildStrip(layout)) return null;

  const width = layout.out.width;
  const height = Math.ceil(layout.totalHeight);

  let canvas: ServerCanvas;
  try {
    canvas = createCanvas(width, height);
  } catch {
    // Allocation can still fail on a machine under memory pressure; the
    // caller falls back to drawing pages per frame.
    return null;
  }

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  for (const box of layout.boxes) {
    drawPageInto(ctx, box.page, box.x, box.y, box.width, box.height);
  }

  return { canvas, height };
}

export function releaseStrip(strip: Strip | null): void {
  if (!strip) return;
  try {
    strip.canvas.width = 0;
    strip.canvas.height = 0;
  } catch {
    // Not every canvas is resizable; GC will handle it.
  }
}

/** Blit the slice of the strip that the camera is looking at. */
export function drawStripSlice(
  ctx: { drawImage: (...args: never[]) => void },
  strip: Strip,
  cameraY: number,
  out: OutputSize,
): void {
  // Clamp so the source rectangle stays inside the strip: drawing past the
  // edge is undefined across canvas implementations.
  const sy = Math.max(0, Math.min(strip.height - 1, Math.round(cameraY)));
  const sh = Math.max(1, Math.min(out.height, strip.height - sy));
  const dy = cameraY < 0 ? Math.round(-cameraY) : 0;

  (ctx.drawImage as unknown as (
    image: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => void)(strip.canvas, 0, sy, out.width, sh, 0, dy, out.width, sh);
}
