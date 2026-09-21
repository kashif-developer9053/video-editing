/**
 * The one place that decides which canvas library the server uses.
 *
 * It must be node-canvas everywhere. Two native canvas libraries cannot be
 * mixed: drawing a node-canvas image into an @napi-rs/canvas context
 * segfaults, because each expects its own image handles. pdfjs also crashes
 * against @napi-rs/canvas on real documents, so node-canvas is the one that
 * has to win.
 *
 * Both failures are native — the process dies with no JavaScript error and
 * no stack, so there is nothing to catch. Keeping the choice in one module
 * is what stops it coming back.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface ServerCanvas {
  width: number;
  height: number;
  /** Bytes per row of the raw buffer; may exceed width * 4 from padding. */
  stride: number;
  getContext(kind: "2d"): CanvasRenderingContext2D;
  toBuffer(mime: "image/png"): Buffer;
  toBuffer(format: "raw"): Buffer;
}

/**
 * Pixel format of the raw buffer below.
 *
 * node-canvas stores pixels natively, which is BGRA on every little-endian
 * platform — a red pixel reads as 0,0,255,255. Rather than converting, the
 * encoder is told the frames are bgra and does the swap itself, for free.
 */
export const RAW_PIXEL_FORMAT = "bgra";

interface CanvasModule {
  createCanvas: (width: number, height: number) => ServerCanvas;
}

let cached: CanvasModule | null = null;

function mod(): CanvasModule {
  if (!cached) cached = require("canvas") as CanvasModule;
  return cached;
}

export function createCanvas(width: number, height: number): ServerCanvas {
  return mod().createCanvas(width, height);
}

/**
 * One frame's pixels, ready for ffmpeg's rawvideo input.
 *
 * toBuffer("raw") hands back the canvas's own memory. Going through
 * getImageData instead costs a full conversion per frame, which measured at
 * roughly 17x slower over a whole render — 138s against 8s for the same
 * 20-second video.
 *
 * The result is only safe to hand straight to the encoder because the frame
 * loop copies it before the next draw; see render.ts.
 */
export function frameBytes(canvas: ServerCanvas): Buffer {
  return canvas.toBuffer("raw");
}

/** True when the raw buffer has no row padding, so it can be piped as-is. */
export function isTightlyPacked(canvas: ServerCanvas): boolean {
  return canvas.stride === canvas.width * 4;
}
