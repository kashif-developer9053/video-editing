/**
 * PDF to page bitmaps, server side.
 *
 * Rendering goes through node-canvas (see ./canvas.ts for why the whole
 * server uses one canvas library).
 *
 * Pages are rasterized at the size the output actually needs rather than a
 * fixed large width — on a 2-core laptop with 8GB, rasterizing 50 pages at
 * 2560px is the step most likely to exhaust memory.
 */

import { createRequire } from "node:module";
import path from "node:path";
import type { DrawablePage } from "@/engine/types";
import { createCanvas } from "./canvas";

const require = createRequire(import.meta.url);

/** Cap the raster scale so one huge page cannot blow up memory alone. */
const MAX_SCALE = 3.0;
/**
 * Extra resolution over the size the page is actually drawn at.
 *
 * Kept near 1 on purpose. node-canvas rescales in software on every
 * drawImage, so a page rasterized larger than it is drawn pays that
 * difference on every frame: a 1600px page drawn into a 1280px frame
 * measured 289ms per frame, which was most of the render.
 */
const OVERSAMPLE = 1.04;

export interface RasterResult {
  pages: DrawablePage[];
  /** Total pages in the document, before any range filter. */
  documentPages: number;
}

export interface RasterOptions {
  data: Uint8Array;
  pageFrom: number;
  pageTo: number;
  /**
   * The width, in output pixels, that a page will actually be drawn at.
   * Pages are rasterized to match, so no per-frame rescaling is needed.
   */
  outputWidth: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Where pdfjs keeps the assets it needs for fonts and CJK encodings. */
function assetPaths() {
  const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  return {
    // Trailing separators are required: pdfjs concatenates a filename onto
    // these, it does not join paths.
    standardFontDataUrl: path.join(pdfjsRoot, "standard_fonts") + path.sep,
    cMapUrl: path.join(pdfjsRoot, "cmaps") + path.sep,
  };
}

/**
 * pdfjs 3.x ships a CommonJS legacy build, which is the one that works under
 * Node without a DOM. Loaded lazily so importing this module in a client
 * bundle does not drag it in.
 */
async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.js");
  // No worker under Node: the main thread does the parsing.
  pdfjs.GlobalWorkerOptions.workerSrc = "";
  return pdfjs;
}

export async function rasterizePdf(opts: RasterOptions): Promise<RasterResult> {
  const pdfjs = await loadPdfjs();
  const assets = assetPaths();

  const doc = await pdfjs.getDocument({
    data: opts.data,
    // Without these, any PDF relying on the standard fonts (Helvetica,
    // Times, Courier) or a CJK encoding fails to open.
    standardFontDataUrl: assets.standardFontDataUrl,
    cMapUrl: assets.cMapUrl,
    cMapPacked: true,
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;

  const documentPages = doc.numPages;
  const from = Math.max(1, Math.min(documentPages, opts.pageFrom));
  const to = Math.max(from, Math.min(documentPages, opts.pageTo));
  const total = to - from + 1;

  const pages: DrawablePage[] = [];
  const targetWidth = Math.round(opts.outputWidth * OVERSAMPLE);

  try {
    for (let num = from; num <= to; num++) {
      if (opts.signal?.aborted) throw new Error("cancelled");

      const page = await doc.getPage(num);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(MAX_SCALE, targetWidth / base.width);
      const viewport = page.getViewport({ scale });

      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      const ctx = canvas.getContext("2d");

      // PDFs assume paper: without this, transparent areas come out black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport }).promise;

      const chars = await countCharacters(page);
      const contentBottom = measureContentBottom(ctx, canvas.width, canvas.height);

      pages.push({
        num,
        width: canvas.width,
        height: canvas.height,
        chars,
        contentBottom,
        bitmap: canvas as unknown as CanvasImageSource,
      });

      // Release pdfjs's per-page buffers as we go; without this a long
      // document holds every page's operator list at once.
      page.cleanup();
      opts.onProgress?.(pages.length, total);
    }
  } finally {
    await doc.destroy();
  }

  return { pages, documentPages };
}

/**
 * Find the last row of the page that carries any ink.
 *
 * Panning the full height of a page whose text stops a third of the way down
 * drifts across blank paper, which looks broken. Measuring the pixels rather
 * than the text geometry also catches images, tables and stamps.
 *
 * Rows are sampled rather than read whole: at a few hundred samples per row
 * the result is identical for this purpose and the scan stays cheap.
 */
function measureContentBottom(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): number {
  const INK_THRESHOLD = 246; // anything darker than near-white counts as content
  const MIN_INK_PIXELS = 3; // ignore stray specks and compression noise
  const SAMPLE_STEP = Math.max(1, Math.floor(width / 320));

  try {
    for (let y = height - 1; y >= 0; y--) {
      const row = ctx.getImageData(0, y, width, 1).data;
      let ink = 0;
      for (let x = 0; x < width; x += SAMPLE_STEP) {
        const i = x * 4;
        // Alpha 0 is untouched background, which is not ink.
        if (row[i + 3] === 0) continue;
        if (row[i] < INK_THRESHOLD || row[i + 1] < INK_THRESHOLD || row[i + 2] < INK_THRESHOLD) {
          if (++ink >= MIN_INK_PIXELS) {
            // Leave a little breathing room below the last line.
            return Math.min(1, (y + height * 0.02) / height);
          }
        }
      }
    }
  } catch {
    // If the pixels cannot be read, fall back to using the whole page.
    return 1;
  }
  return 1;
}

/** Text volume for auto-pace weighting. Failure just means even pacing. */
async function countCharacters(page: {
  getTextContent: () => Promise<{ items: unknown[] }>;
}): Promise<number> {
  try {
    const content = await page.getTextContent();
    // items mixes text runs with marked-content markers, which carry no str.
    return content.items.reduce<number>((sum, item) => {
      const str = (item as { str?: unknown }).str;
      return sum + (typeof str === "string" ? str.length : 0);
    }, 0);
  } catch {
    return 0;
  }
}

/** Free the bitmaps once encoding is done. */
export function releasePages(pages: DrawablePage[]): void {
  for (const page of pages) {
    const canvas = page.bitmap as unknown as { width: number; height: number };
    // Zeroing the dimensions frees the backing buffer promptly rather than
    // waiting on GC pressure.
    try {
      canvas.width = 0;
      canvas.height = 0;
    } catch {
      // Not every image source is resizable; GC will handle those.
    }
  }
  pages.length = 0;
}
