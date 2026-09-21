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
import { rasterizePdf, releasePages } from "@/server/raster";

export const runtime = "nodejs";
export const maxDuration = 120;

interface CacheEntry {
  pages: DrawablePage[];
  documentPages: number;
  outputWidth: number;
  touchedAt: number;
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

  const pdfFile = form.get("pdf");
  const providedKey = form.get("key");

  let entry: CacheEntry | undefined;
  let key: string;

  if (pdfFile instanceof File && pdfFile.size > 0) {
    const bytes = new Uint8Array(await pdfFile.arrayBuffer());
    key = hashOf(bytes, settings.pageFrom, settings.pageTo);
    entry = cache.get(key);

    // Re-rasterize when the output got bigger, or the pages would be soft.
    if (!entry || entry.outputWidth < drawnPageWidth(settings)) {
      if (entry) releasePages(entry.pages);
      const result = await rasterizePdf({
        data: bytes,
        pageFrom: settings.pageFrom,
        pageTo: settings.pageTo,
        outputWidth: drawnPageWidth(settings),
      });
      entry = {
        pages: result.pages,
        documentPages: result.documentPages,
        outputWidth: drawnPageWidth(settings),
        touchedAt: Date.now(),
      };
      cache.set(key, entry);
      evictStale();
    }
  } else if (typeof providedKey === "string") {
    key = providedKey;
    entry = cache.get(key);
    if (!entry) {
      // The client should re-send the file; its cached pages have expired.
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
