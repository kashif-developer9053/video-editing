/**
 * Layout and timing maths.
 *
 * Every motion mode works on one idea: a virtual strip of pages stacked
 * vertically, and a camera that moves down it. Slide modes snap the camera
 * to one page at a time instead of gliding between them.
 */

import {
  PLATFORMS,
  type CardTiming,
  type DrawablePage,
  type Layout,
  type OutputSize,
  type Settings,
} from "./types";

/** Long edge in pixels for each quality preset. */
const LONG_EDGE: Record<number, number> = { 720: 1280, 1080: 1920, 1440: 2560 };

export function outputSize(settings: Settings): OutputSize {
  const p = PLATFORMS[settings.platform];
  const ratio = p.w / p.h;
  const long = LONG_EDGE[settings.quality] ?? 1920;

  let width: number;
  let height: number;
  if (ratio >= 1) {
    width = long;
    height = Math.round(long / ratio);
  } else {
    height = long;
    width = Math.round(long * ratio);
  }

  // Encoders want even dimensions; odd ones fail or get silently padded.
  return { width: width - (width % 2), height: height - (height % 2) };
}

export function layout(pages: DrawablePage[], settings: Settings): Layout {
  const out = outputSize(settings);
  const pad = Math.round(out.width * (settings.margin / 100));
  const avail = out.width - pad * 2;
  const scrolling = settings.mode === "scroll" || settings.mode === "autopace";
  const gap = scrolling ? Math.round(out.height * 0.035) : 0;

  const boxes = [];
  let y = 0;

  for (const page of pages) {
    let width: number;
    let height: number;

    if (settings.fit === "contain" && !scrolling) {
      const scale = Math.min(avail / page.width, (out.height - pad * 2) / page.height);
      width = page.width * scale;
      height = page.height * scale;
    } else {
      width = avail;
      height = page.height * (avail / page.width);
    }

    boxes.push({ page, x: (out.width - width) / 2, y, width, height });
    y += height + gap;
  }

  return { out, boxes, totalHeight: Math.max(0, y - gap), pad };
}

export function cardTiming(settings: Settings): CardTiming {
  const intro = settings.title ? settings.cardSeconds : 0;
  const outro = settings.outro ? settings.cardSeconds : 0;
  // Always leave at least a second for the pages, even if the cards are
  // configured longer than the whole video.
  return { intro, outro, body: Math.max(1, settings.duration - intro - outro) };
}

/**
 * Share of the body time each page gets. Auto-pace weights by text volume so
 * dense pages linger; every other mode splits the time evenly.
 */
export function pageWeights(pages: DrawablePage[], settings: Settings): number[] {
  const n = pages.length;
  if (n === 0) return [];

  if (settings.mode !== "autopace") {
    return new Array(n).fill(1 / n);
  }

  const raw = pages.map((p) => {
    // The 0.45 floor keeps a near-empty page from flashing past.
    return 0.45 + Math.min(2.2, p.chars / 900);
  });
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / total);
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Maps linear time onto distance down the strip so that, in auto-pace, the
 * camera slows over text-heavy pages instead of moving at a constant rate.
 */
export function autopaceDistance(
  progress: number,
  layoutResult: Layout,
  weights: number[],
): number {
  const { boxes, totalHeight } = layoutResult;
  if (!boxes.length || totalHeight <= 0) return progress;

  // Build matched time/distance breakpoints, then interpolate between them.
  const timeAt = [0];
  const distAt = [0];
  let tAcc = 0;

  for (let i = 0; i < boxes.length; i++) {
    tAcc += weights[i] ?? 0;
    const box = boxes[i];
    timeAt.push(tAcc);
    distAt.push(Math.min(1, (box.y + box.height) / totalHeight));
  }

  for (let i = 1; i < timeAt.length; i++) {
    if (progress <= timeAt[i]) {
      const span = timeAt[i] - timeAt[i - 1] || 1;
      const local = (progress - timeAt[i - 1]) / span;
      return distAt[i - 1] + (distAt[i] - distAt[i - 1]) * local;
    }
  }
  return 1;
}

/** Which page index is on screen at a given point in the body timeline. */
export function pageAtProgress(
  progress: number,
  weights: number[],
): { index: number; local: number } {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    if (progress <= acc + weights[i] || i === weights.length - 1) {
      const local = weights[i] ? (progress - acc) / weights[i] : 0;
      return { index: i, local: Math.min(1, Math.max(0, local)) };
    }
    acc += weights[i];
  }
  return { index: 0, local: 0 };
}

export function formatTimecode(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function formatShort(seconds: number): string {
  let m = Math.floor(seconds / 60);
  let s = Math.round(seconds % 60);
  if (s === 60) {
    m += 1;
    s = 0;
  }
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
