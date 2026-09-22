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
import path from "node:path";

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

/**
 * Resolve the same node-canvas that pdfjs uses.
 *
 * pdfjs-dist installs its own nested copy (2.11.2 against our 3.2.3), and a
 * native canvas only accepts objects created by its own build: hand a 3.x
 * Canvas to a 2.x drawImage and it throws "Image or Canvas expected". pdfjs
 * allocates scratch canvases for images through its copy, so ours has to be
 * that copy too or every PDF containing an image fails.
 */
function mod(): CanvasModule {
  if (cached) return cached;

  // pdfjs's nested copy first, so both halves agree; the top-level install
  // is the fallback for when npm has deduped them into one. Resolved from
  // pdfjs's own location rather than written as a bare specifier, because
  // the bundler cannot statically analyse a nested path and fails the build
  // with "non-ecmascript placeable asset".
  const candidates: string[] = [];
  try {
    candidates.push(require.resolve("canvas", { paths: [path.dirname(require.resolve("pdfjs-dist/package.json"))] }));
  } catch {
    // pdfjs may not carry its own copy; the plain one below covers that.
  }
  candidates.push("canvas");

  for (const id of candidates) {
    try {
      cached = require(id) as CanvasModule;
      return cached;
    } catch {
      // try the next one
    }
  }

  throw new Error("node-canvas is not installed. Run `npm install`.");
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
