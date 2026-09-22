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

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { DrawablePage } from "@/engine/types";
import { createCanvas } from "./canvas";


/** Pages to rasterize between handing the event loop back. */
const YIELD_EVERY = 4;

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

/**
 * Where pdfjs keeps the fonts and CJK encodings it needs.
 *
 * Found by walking up from the working directory rather than with
 * require.resolve: under Turbopack that returns a bundler-internal virtual
 * path ("[externals]/pdfjs-dist/package.json [external] (...)"), and
 * path.dirname of it points nowhere real. The failure is quiet — pdfjs falls
 * back to a built-in fetch, cannot find the file, and every glyph is dropped
 * with "Requesting object that isn't resolved yet", leaving a blank page and
 * a successful response.
 */
function assetDirs(): { fonts: string; cmaps: string } {
  if (cachedAssetDirs) return cachedAssetDirs;

  const candidates: string[] = [];
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(dir, "node_modules", "pdfjs-dist"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const root of candidates) {
    const fonts = path.join(root, "standard_fonts");
    if (existsSync(path.join(fonts, "LiberationSans-Regular.ttf"))) {
      cachedAssetDirs = { fonts, cmaps: path.join(root, "cmaps") };
      return cachedAssetDirs;
    }
  }

  throw new Error(
    "Could not find the pdfjs font files. Run `npm install` and try again.",
  );
}

let cachedAssetDirs: { fonts: string; cmaps: string } | null = null;

/**
 * Feed pdfjs its own asset files from disk.
 *
 * Passing `standardFontDataUrl` / `cMapUrl` as filesystem paths works under
 * plain Node but not inside Next: pdfjs treats them as URLs and fetches
 * them, which fails silently. The symptom is every glyph dropped with
 * "Requesting object that isn't resolved yet Helvetica_path_N", and a page
 * that renders blank while reporting success.
 *
 * These factories read the bytes directly, so no fetch is involved and both
 * runtimes behave the same. The shapes below match pdfjs's own
 * BaseStandardFontDataFactory and BaseCMapReaderFactory.
 */
function readAsset(dir: string, name: string): Promise<Uint8Array> {
  // Keep the read inside the asset directory whatever pdfjs asks for.
  const target = path.resolve(dir, name);
  if (!target.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error(`Refusing to read outside the asset directory: ${name}`);
  }
  return fs.readFile(target).then((buf) => new Uint8Array(buf));
}

function standardFontFactory(dir: string) {
  return class {
    async fetch({ filename }: { filename: string }): Promise<Uint8Array> {
      if (!filename) throw new Error("Font filename must be specified.");
      return readAsset(dir, filename);
    }
  };
}

function cMapFactory(dir: string) {
  return class {
    async fetch({ name }: { name: string }): Promise<{
      cMapData: Uint8Array;
      compressionType: number;
    }> {
      if (!name) throw new Error("CMap name must be specified.");
      return {
        cMapData: await readAsset(dir, `${name}.bcmap`),
        // 1 is CMapCompressionType.BINARY, which is what .bcmap files are.
        compressionType: 1,
      };
    }
  };
}

/**
 * pdfjs 3.x ships a CommonJS legacy build, which is the one that works under
 * Node without a DOM. Loaded lazily so importing this module in a client
 * bundle does not drag it in.
 */
let pdfjsPromise: ReturnType<typeof importPdfjs> | null = null;

/**
 * The canvas factory pdfjs uses for its own scratch surfaces.
 *
 * pdfjs does not only draw into the canvas we hand it: for images, masks and
 * transparency groups it allocates extra canvases of its own. Without a
 * factory it falls back to the DOM one, which calls
 * document.createElement("canvas") — under Node that yields nothing usable
 * and the render dies with "TypeError: Image or Canvas expected" somewhere
 * inside paintInlineImageXObject. A text-only PDF never allocates a scratch
 * canvas, which is why this only appears on documents containing images.
 */
class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.max(1, width), Math.max(1, height));
    return { canvas, context: canvas.getContext("2d") };
  }

  reset(entry: { canvas: { width: number; height: number } }, width: number, height: number) {
    entry.canvas.width = Math.max(1, width);
    entry.canvas.height = Math.max(1, height);
  }

  destroy(entry: { canvas: { width: number; height: number } }) {
    // Zeroing frees the backing buffer rather than waiting on GC.
    entry.canvas.width = 0;
    entry.canvas.height = 0;
  }
}

async function importPdfjs() {

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.js");
  // No worker under Node: the main thread does the parsing.
  pdfjs.GlobalWorkerOptions.workerSrc = "";
  return pdfjs;
}

/**
 * Load pdfjs once per process.
 *
 * Without this the first page of every render paid pdfjs's start-up cost:
 * measured at 3.4 seconds against 40-60ms for each page after it. The module
 * is stateless once loaded, so one copy serves every request.
 */
function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = importPdfjs();
  return pdfjsPromise;
}

/**
 * Start loading pdfjs and its fonts before anyone asks for a render, so the
 * cost lands while the user is still choosing settings rather than on their
 * first page.
 */
export async function warmUp(): Promise<void> {
  try {
    await loadPdfjs();
    assetDirs();
    // node-canvas sets up its font subsystem on the first createCanvas,
    // which measured 1.6 seconds. Paying it here keeps it off the first
    // page of the first render.
    createCanvas(8, 8).getContext("2d").fillRect(0, 0, 1, 1);
  } catch {
    // A failure here is not fatal: the real render reports it properly.
  }
}

export async function rasterizePdf(opts: RasterOptions): Promise<RasterResult> {
  const pdfjs = await loadPdfjs();
  const dirs = assetDirs();

  const doc = await pdfjs.getDocument({
    data: opts.data,
    // Without these, any PDF using the standard fonts (Helvetica, Times,
    // Courier) or a CJK encoding renders with no text at all.
    StandardFontDataFactory: standardFontFactory(dirs.fonts),
    CMapReaderFactory: cMapFactory(dirs.cmaps),
    // Scratch canvases for images and masks; see NodeCanvasFactory.
    CanvasFactory: NodeCanvasFactory,
    cMapPacked: true,
    useSystemFonts: false,
    isEvalSupported: false,
  } as Parameters<typeof pdfjs.getDocument>[0]).promise;

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

      await page.render({
        canvasContext: ctx,
        viewport,
        // Also needed here: the render task allocates its own scratch
        // canvases independently of the document.
        canvasFactory: new NodeCanvasFactory(),
      } as Parameters<typeof page.render>[0]).promise;

      const chars = await countCharacters(page);
      const { contentBottom, coverage } = measureInk(ctx, canvas.width, canvas.height);

      pages.push({
        num,
        width: canvas.width,
        height: canvas.height,
        chars,
        coverage,
        contentBottom,
        bitmap: canvas as unknown as CanvasImageSource,
      });

      // Release pdfjs's per-page buffers as we go; without this a long
      // document holds every page's operator list at once.
      page.cleanup();
      opts.onProgress?.(pages.length, total);

      // Hand the event loop back periodically. pdfjs rasterizes on the main
      // thread, so without this a long document blocks the server outright
      // and the browser's progress polls all queue up, arriving together
      // once the work is already done.
      //
      // Every page measured twice as slow overall — the yield costs more
      // than the page does on a simple document. Every few pages keeps the
      // server answering without that penalty.
      if (pages.length % YIELD_EVERY === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  } finally {
    await doc.destroy();
  }

  return { pages, documentPages };
}

/**
 * Scan the rendered page once for two things:
 *
 * - where its content stops, so panning does not drift across blank paper;
 * - how much of it is covered, which is what screen time should follow.
 *
 * Coverage is measured from pixels rather than the text layer because a
 * scanned page or a full-page diagram has no characters at all. Weighting by
 * character count alone rushes those pages past while lingering on text.
 *
 * The scan samples a grid rather than every pixel: at a few hundred samples
 * per axis the numbers are identical for this purpose and it stays cheap.
 */
function measureInk(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): { contentBottom: number; coverage: number } {
  const INK_THRESHOLD = 246; // darker than near-white counts as content
  const MIN_INK_PIXELS = 3; // ignore specks and compression noise
  const colStep = Math.max(1, Math.floor(width / 320));
  const rowStep = Math.max(1, Math.floor(height / 320));

  let data: Uint8ClampedArray;
  try {
    // One read for the whole page: a getImageData per row costs a call into
    // the native canvas for every row scanned.
    data = ctx.getImageData(0, 0, width, height).data;
  } catch {
    // If the pixels cannot be read, assume a full page of average density.
    return { contentBottom: 1, coverage: 0.25 };
  }

  let lastInkRow = -1;
  let inkSamples = 0;
  let totalSamples = 0;

  for (let y = 0; y < height; y += rowStep) {
    const rowStart = y * width * 4;
    let rowInk = 0;
    for (let x = 0; x < width; x += colStep) {
      const i = rowStart + x * 4;
      totalSamples++;
      // Alpha 0 is untouched background, which is not ink.
      if (data[i + 3] === 0) continue;
      if (data[i] < INK_THRESHOLD || data[i + 1] < INK_THRESHOLD || data[i + 2] < INK_THRESHOLD) {
        rowInk++;
        inkSamples++;
      }
    }
    if (rowInk >= MIN_INK_PIXELS) lastInkRow = y;
  }

  const contentBottom =
    lastInkRow < 0
      ? 1
      : // Leave a little breathing room below the last line.
        Math.min(1, (lastInkRow + height * 0.02) / height);

  return { contentBottom, coverage: totalSamples > 0 ? inkSamples / totalSamples : 0 };
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
