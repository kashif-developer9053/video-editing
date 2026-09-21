/**
 * PDF to page bitmaps, server side.
 *
 * pdfjs-dist runs under Node with a canvas shim. Pages are rasterized at the
 * size the output actually needs rather than a fixed large width — on a
 * 2-core laptop with 8GB, rasterizing 50 pages at 2560px is the step most
 * likely to run the machine out of memory.
 */

import { createCanvas, type Canvas } from "@napi-rs/canvas";
import type { DrawablePage } from "@/engine/types";

/** Cap the raster scale so a huge page cannot blow up memory on its own. */
const MAX_SCALE = 3.0;
/** Extra resolution over the output width, for crisp downscaling. */
const OVERSAMPLE = 1.25;

export interface RasterResult {
  pages: DrawablePage[];
  /** Total pages in the document, before any range filter. */
  documentPages: number;
}

export interface RasterOptions {
  data: Uint8Array;
  pageFrom: number;
  pageTo: number;
  /** Width of the output frame; pages are sized relative to this. */
  outputWidth: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
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

  const doc = await pdfjs.getDocument({
    data: opts.data,
    // Fonts and images come from the file itself; nothing is fetched.
    disableFontFace: false,
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const documentPages = doc.numPages;
  const from = Math.max(1, Math.min(documentPages, opts.pageFrom));
  const to = Math.max(from, Math.min(documentPages, opts.pageTo));
  const total = to - from + 1;

  const pages: DrawablePage[] = [];
  const targetWidth = Math.round(opts.outputWidth * OVERSAMPLE);

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

    await page.render({
      // The napi-rs context satisfies the parts of the 2D API pdfjs uses,
      // but its types are not the DOM ones.
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

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

    // Release pdfjs's own per-page buffers as we go; without this a long
    // document holds every page's operator list at once.
    page.cleanup();
    opts.onProgress?.(pages.length, total);
  }

  await doc.destroy();
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
  ctx: { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } },
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
        // Alpha 0 is the untouched background, which is not ink.
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

/** Text volume for auto-pace weighting. Failure is fine — it just means even pacing. */
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
    const canvas = page.bitmap as unknown as Canvas;
    // Zero the dimensions so the native buffer can be collected promptly
    // rather than waiting on GC pressure.
    try {
      canvas.width = 0;
      canvas.height = 0;
    } catch {
      // Not all image sources are resizable; GC will handle those.
    }
  }
  pages.length = 0;
}
