/**
 * POST /api/preview — render one frame of the would-be video.
 *
 * The editor needs to show what a setting does before committing to a full
 * render. This runs the same compositor over the same rasterized pages, for
 * a single moment in time, and returns a PNG — so the preview cannot drift
 * from the finished video.
 *
 * Rasterized pages are cached per PDF so dragging a slider does not re-read
 * the document on every frame.
 */

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { drawFrame, prepareFrameContext } from "@/engine/compositor";
import { estimateReuse } from "@/engine/framekey";
import { drawnPageWidth, layout, outputSize } from "@/engine/layout";
import { predictSeconds } from "@/engine/estimate";
import { DEFAULT_SETTINGS, type DrawablePage, type Settings } from "@/engine/types";
import { createCanvas } from "@/server/canvas";
import { detectEncoder } from "@/server/ffmpeg";
import { finishProgress, reportProgress, startProgress } from "@/server/progress";
import { rasterizePdf, releasePages } from "@/server/raster";

export const runtime = "nodejs";
export const maxDuration = 120;

interface CacheEntry {
  pages: DrawablePage[];
  documentPages: number;
  /**
   * The settings the cached bitmaps were prepared for. Prescaling rewrites
   * pages in place, so a cache entry is only reusable while these match —
   * otherwise the preview would draw a bitmap sized for different settings
   * and drift from the finished video.
   */
  shape: number;
  touchedAt: number;
}

/**
 * The width the cached pages were rasterized for.
 *
 * Only the drawn width matters. Keying on quality, platform, margin and mode
 * as well meant nudging the margin slider — or switching to a quality that
 * happens to want the same width — threw the pages away and re-read the
 * whole document.
 */
function shapeOf(settings: Settings): number {
  return Math.round(drawnPageWidth(settings));
}

// One document at a time is all the editor ever previews; holding more would
// pin a lot of bitmaps in memory for no benefit.
const cache = new Map<string, CacheEntry>();
const CACHE_LIMIT = 2;
const CACHE_TTL_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }

  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...safeParse(form.get("settings")),
  };
  const time = Number(form.get("time") ?? 0);
  const out = outputSize(settings);

  // The browser cannot know the cache key before the file is read, so it
  // sends an id of its own and polls progress under that.
  const trackingId = typeof form.get("track") === "string" ? String(form.get("track")) : null;

  const pdfFile = form.get("pdf");
  const providedKey = form.get("key");

  let entry: CacheEntry | undefined;
  let key: string;

  if (pdfFile instanceof File && pdfFile.size > 0) {
    const bytes = new Uint8Array(await pdfFile.arrayBuffer());
    key = hashOf(bytes, settings.pageFrom, settings.pageTo);
    entry = cache.get(key);

    // Re-rasterize only when the cached pages are too small for what is
    // being asked for. Bitmaps larger than needed scale down fine, so a
    // lower quality reuses what is already there rather than starting over.
    if (!entry || entry.shape < shapeOf(settings)) {
      if (entry) releasePages(entry.pages);

      // The client polls /api/preview/progress with this same key while the
      // request runs, so a long document can show how far along it is
      // instead of an empty screen.
      const expected = Math.max(1, settings.pageTo - settings.pageFrom + 1);
      if (trackingId) startProgress(trackingId, expected);

      try {
        const result = await rasterizePdf({
          data: bytes,
          pageFrom: settings.pageFrom,
          pageTo: settings.pageTo,
          outputWidth: drawnPageWidth(settings),
          onProgress: (done, total) => {
            if (trackingId) reportProgress(trackingId, done, total);
          },
        });
      // Deliberately NOT prescaled. Prescaling costs about 600ms and saves
      // ~170ms on every frame drawn, which is a huge win across a whole
      // render but pure delay for a preview that draws one frame. The
      // compositor scales identically either way, so the picture is the
      // same; only the sharpness of the downscale differs, invisibly.
        entry = {
          pages: result.pages,
          documentPages: result.documentPages,
          shape: shapeOf(settings),
          touchedAt: Date.now(),
        };
        cache.set(key, entry);
        evictStale();
      } finally {
        if (trackingId) finishProgress(trackingId);
      }
    }
  } else if (typeof providedKey === "string") {
    key = providedKey;
    entry = cache.get(key);
    if (!entry || entry.shape < shapeOf(settings)) {
      // The client should re-send the file: either the cache expired, or the
      // pages it holds are too small for the new settings.
      return NextResponse.json({ error: "stale-key" }, { status: 409 });
    }
  } else {
    return NextResponse.json({ error: "No PDF was attached." }, { status: 400 });
  }

  entry.touchedAt = Date.now();

  if (!entry.pages.length) {
    return NextResponse.json({ error: "That page range is empty." }, { status: 400 });
  }

  const layoutResult = layout(entry.pages, settings);
  const fc = prepareFrameContext(layoutResult, entry.pages, settings);

  const canvas = createCanvas(out.width, out.height);
  drawFrame(canvas.getContext("2d"), Math.max(0, Math.min(settings.duration, time)), fc);
  const png = canvas.toBuffer("image/png");

  const reuse = estimateReuse(settings.fps, settings.duration, fc);
  const encoder = await detectEncoder();
  const predicted = predictSeconds({
    uniqueFrames: reuse.unique,
    totalFrames: reuse.total,
    width: out.width,
    height: out.height,
    hardwareEncoder: encoder.hardware,
  });

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "X-Scrollcast-Key": key,
      "X-Scrollcast-Pages": String(entry.documentPages),
      "X-Scrollcast-Rendered": String(entry.pages.length),
      "X-Scrollcast-Frames": String(reuse.total),
      "X-Scrollcast-Unique": String(reuse.unique),
      "X-Scrollcast-Estimate": predicted.toFixed(1),
      "X-Scrollcast-Encoder": encoder.label,
    },
  });
}

function safeParse(raw: FormDataEntryValue | null): Partial<Settings> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Partial<Settings>) : {};
  } catch {
    return {};
  }
}

function hashOf(bytes: Uint8Array, from: number, to: number): string {
  // Hash the ends and the length rather than the whole file: enough to tell
  // two uploads apart, without reading 100MB on every slider drag.
  const head = bytes.subarray(0, Math.min(65536, bytes.length));
  const tail = bytes.subarray(Math.max(0, bytes.length - 65536));
  return createHash("sha1")
    .update(head)
    .update(tail)
    .update(`${bytes.length}:${from}:${to}`)
    .digest("hex");
}

function evictStale(): void {
  const now = Date.now();
  for (const [key, entry] of [...cache.entries()]) {
    if (now - entry.touchedAt > CACHE_TTL_MS) {
      releasePages(entry.pages);
      cache.delete(key);
    }
  }
  while (cache.size > CACHE_LIMIT) {
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [key, entry] of cache.entries()) {
      if (entry.touchedAt < oldest) {
        oldest = entry.touchedAt;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    releasePages(cache.get(oldestKey)!.pages);
    cache.delete(oldestKey);
  }
}
