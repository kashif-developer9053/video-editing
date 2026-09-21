/**
 * The compositor: paints the whole video at any moment in time.
 *
 * drawFrame() is the single source of truth for what the video looks like.
 * The preview, the worker pool and the server renderer all call it, so what
 * you scrub is exactly what gets encoded.
 */

import {
  autopaceDistance,
  cardTiming,
  easeInOut,
  pageAtProgress,
  pageWeights,
} from "./layout";
import type { DrawablePage, Layout, LayoutBox, OutputSize, Settings } from "./types";

/**
 * The slice of the 2D API the compositor actually uses.
 *
 * Declared structurally rather than as CanvasRenderingContext2D so the same
 * code runs against a browser canvas, an OffscreenCanvas, and the native
 * server canvas — whose context implements the drawing API but is not the
 * DOM type, and is missing DOM-only members like drawFocusIfNeeded.
 */
export interface Ctx {
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  fill(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drawImage(image: any, dx: number, dy: number, dw: number, dh: number): void;
  globalAlpha: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fillStyle: any;
  font: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  textAlign: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  textBaseline: any;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetY: number;
}

/** Share of a page's screen time spent transitioning to the next one. */
const TRANSITION_SHARE = 0.22;

export interface FrameContext {
  layout: Layout;
  weights: number[];
  settings: Settings;
}

export function prepareFrameContext(
  layoutResult: Layout,
  pages: DrawablePage[],
  settings: Settings,
): FrameContext {
  return { layout: layoutResult, weights: pageWeights(pages, settings), settings };
}

export function drawFrame(ctx: Ctx, time: number, fc: FrameContext): void {
  const { layout, settings } = fc;
  const out = layout.out;
  const timing = cardTiming(settings);

  ctx.save();
  ctx.fillStyle = settings.background;
  ctx.fillRect(0, 0, out.width, out.height);

  if (timing.intro && time < timing.intro) {
    drawCard(ctx, out, settings.title, settings.subtitle, settings, cardAlpha(time, timing.intro));
  } else if (timing.outro && time >= timing.intro + timing.body) {
    const local = time - timing.intro - timing.body;
    drawCard(ctx, out, settings.outro, "", settings, cardAlpha(local, timing.outro));
  } else {
    const bodyTime = Math.min(timing.body, Math.max(0, time - timing.intro));
    const progress = timing.body > 0 ? bodyTime / timing.body : 0;

    const shown =
      settings.mode === "slide" || settings.mode === "kenburns"
        ? drawSlides(ctx, out, progress, fc)
        : drawScroll(ctx, out, progress, fc);

    // The bar tracks the whole video, cards included — a viewer reads it as
    // "how far through am I", not "how far through the pages".
    drawOverlays(ctx, out, shown, time / Math.max(1, settings.duration), fc);
  }

  ctx.restore();
}

/** Cards fade in and out rather than cutting hard. */
function cardAlpha(time: number, span: number): number {
  const fade = Math.min(0.45, span * 0.28);
  if (time < fade) return time / fade;
  if (time > span - fade) return Math.max(0, (span - time) / fade);
  return 1;
}

/* ---------------- continuous scroll and auto pace ---------------- */

function drawScroll(ctx: Ctx, out: OutputSize, progress: number, fc: FrameContext): number {
  const { layout, weights, settings } = fc;
  const travel = Math.max(0, layout.totalHeight - out.height);

  let p = progress;
  if (settings.mode === "autopace") {
    p = autopaceDistance(progress, layout, weights);
  } else if (settings.ease) {
    p = easeInOut(progress);
  }

  // A strip shorter than the frame has nowhere to travel, so centre it.
  const camY = travel > 0 ? p * travel : -(out.height - layout.totalHeight) / 2;
  let shown = layout.boxes[0]?.page.num ?? 1;

  for (const box of layout.boxes) {
    const y = box.y - camY;
    if (y > out.height || y + box.height < 0) continue;
    // Whatever sits at 45% down the frame is "the page you are reading".
    const mark = out.height * 0.45;
    if (y <= mark && y + box.height >= mark) shown = box.page.num;
    drawPage(ctx, box.page, box.x, y, box.width, box.height);
  }
  return shown;
}

/* ---------------- slide and ken burns ---------------- */

function drawSlides(ctx: Ctx, out: OutputSize, progress: number, fc: FrameContext): number {
  const { layout, weights, settings } = fc;
  const { index, local } = pageAtProgress(progress, weights);

  const current = layout.boxes[index];
  const next = layout.boxes[index + 1];
  if (!current) return 1;

  if (settings.mode === "kenburns") {
    drawKenBurns(ctx, out, current, local, 1, fc);
    if (next && local > 1 - TRANSITION_SHARE && settings.transition !== "cut") {
      const k = (local - (1 - TRANSITION_SHARE)) / TRANSITION_SHARE;
      drawKenBurns(ctx, out, next, 0, k, fc);
    }
    return current.page.num;
  }

  // The pan holds still briefly at the top and bottom rather than moving
  // the whole time: a page that starts sliding the instant it appears reads
  // as restless, and the reader needs a moment at each end.
  const panSpan = settings.transition === "cut" ? 1 : 1 - TRANSITION_SHARE;
  const reveal = panProgress(local, panSpan);

  const transitioning = !!next && local > 1 - TRANSITION_SHARE && settings.transition !== "cut";
  if (!transitioning) {
    drawFitted(ctx, out, current, 0, 0, 1, fc, reveal);
    return current.page.num;
  }

  const k = easeInOut(Math.min(1, (local - (1 - TRANSITION_SHARE)) / TRANSITION_SHARE));

  switch (settings.transition) {
    case "fade":
      drawFitted(ctx, out, current, 0, 0, 1 - k, fc, 1);
      drawFitted(ctx, out, next!, 0, 0, k, fc, 0);
      break;
    case "push":
      drawFitted(ctx, out, current, 0, -out.height * k, 1, fc, 1);
      drawFitted(ctx, out, next!, 0, out.height * (1 - k), 1, fc, 0);
      break;
    default:
      drawFitted(ctx, out, current, -out.width * k, 0, 1, fc, 1);
      drawFitted(ctx, out, next!, out.width * (1 - k), 0, 1, fc, 0);
  }

  return (k > 0.5 ? next! : current).page.num;
}

/** Fraction of a page's hold spent still, at each end, before panning. */
const PAN_DWELL = 0.18;

/**
 * Width of one progress-bar step, in pixels.
 *
 * The bar is the most expensive overlay in the renderer: advancing it
 * continuously makes every frame unique and drops slide-mode reuse from
 * ~75% to ~8%. Stepping it keeps the reuse and still reads as smooth at
 * playback speed, because each step is a few pixels on a 1280px frame.
 */
const BAR_STEP_PX = 4;

/** Bar width in whole steps — shared by the compositor and the frame cache. */
export function quantizeBar(progress: number, frameWidth: number): number {
  const steps = Math.max(1, Math.round(frameWidth / BAR_STEP_PX));
  return (Math.round(progress * steps) / steps) * frameWidth;
}

/**
 * A page never grows past this many frames of height under "fill width".
 * An A4 page filling the width of a 9:16 frame would be about 2.4 frames
 * tall, and a single hold cannot pan far enough to read all of it.
 */
const MAX_PAGE_OVERFLOW = 1.8;

/**
 * The scale a page is drawn at. Shared so the compositor and the frame-reuse
 * cache cannot disagree — if they do, reuse freezes moving frames.
 */
export function pageScale(
  page: { width: number; height: number },
  out: OutputSize,
  pad: number,
  fit: string,
): number {
  const contain = Math.min((out.width - pad * 2) / page.width, (out.height - pad * 2) / page.height);
  if (fit !== "width") return contain;

  const fillWidth = (out.width - pad * 2) / page.width;
  const capped = Math.min(fillWidth, (out.height * MAX_PAGE_OVERFLOW) / page.height);
  // Never shrink below "fit the page": the cap is an upper bound, not a floor.
  return Math.max(contain, capped);
}

/**
 * How far a page should pan: enough to bring its last line into view, not
 * the full height of the paper. Panning past the content shows blank paper,
 * which reads as a broken render.
 */
export function panDistance(
  page: { height: number; contentBottom?: number },
  drawnHeight: number,
  out: OutputSize,
  pad: number,
): number {
  const frameHeight = out.height - pad * 2;
  const overflow = Math.max(0, drawnHeight - frameHeight);
  if (overflow <= 0) return 0;

  // Where the content ends, in drawn pixels down the page.
  const contentEnd = drawnHeight * Math.min(1, Math.max(0.05, page.contentBottom ?? 1));
  // Stop once that point sits at the bottom of the frame.
  const needed = Math.max(0, contentEnd - frameHeight);
  return Math.min(overflow, needed);
}

/**
 * Pan position within a page's hold: still, then moving, then still again.
 * Exported so the frame-key cache can quantise the same curve.
 */
export function panProgress(local: number, span: number): number {
  if (span <= 0) return 1;
  const t = Math.min(1, Math.max(0, local / span));
  const moveStart = PAN_DWELL;
  const moveEnd = 1 - PAN_DWELL;
  if (t <= moveStart) return 0;
  if (t >= moveEnd) return 1;
  return easeInOut((t - moveStart) / (moveEnd - moveStart));
}

/**
 * Draw one page for a slide-style mode.
 *
 * `reveal` (0..1) is how far through this page's hold we are. When the page
 * is scaled to the frame width it is taller than the frame, and this pans
 * down it so the whole page gets read — legible text and nothing hidden,
 * which fitting the entire page in frame cannot give you at 16:9.
 */
function drawFitted(
  ctx: Ctx,
  out: OutputSize,
  box: LayoutBox,
  dx: number,
  dy: number,
  alpha: number,
  fc: FrameContext,
  reveal = 0,
): void {
  const { pad } = fc.layout;
  const page = box.page;

  // Fitting a whole A4 page into a 16:9 frame shrinks it to about 40% of
  // the width and leaves the text too small to read — the page is portrait
  // and the frame is landscape. "Fit page" accepts that trade; "fill width"
  // instead scales to the frame width and pins to the top, so the text is
  // legible and the rest of the page is simply below the cut.
  const scale = pageScale(page, out, pad, fc.settings.fit);

  const width = page.width * scale;
  const height = page.height * scale;
  const x = (out.width - width) / 2 + dx;

  // Two separate questions. Does the page overflow the frame at all — which
  // decides whether it is pinned to the top or centred? And how far should
  // it pan — which is capped at the content, and is legitimately zero for a
  // tall page whose text all fits on the first screen.
  const overflows = height > out.height - pad * 2;
  const travel = panDistance(page, height, out, pad);

  // reveal is already eased by panProgress; easing it again would stall the
  // pan in the middle of the page.
  const y = overflows
    ? pad - travel * Math.min(1, Math.max(0, reveal)) + dy
    : (out.height - height) / 2 + dy;

  ctx.save();
  ctx.globalAlpha = alpha;
  drawPage(ctx, page, x, y, width, height);
  ctx.restore();
}

function drawKenBurns(
  ctx: Ctx,
  out: OutputSize,
  box: LayoutBox,
  local: number,
  alpha: number,
  fc: FrameContext,
): void {
  const { pad } = fc.layout;
  const page = box.page;
  const zoom = 1.06 + 0.07 * local;
  const scale =
    Math.min((out.width - pad * 2) / page.width, (out.height - pad * 2) / page.height) * zoom;

  const width = page.width * scale;
  const height = page.height * scale;
  // Tall pages drift downward over the hold; short ones just sit and zoom.
  const overflow = Math.max(0, height - out.height);
  const y = (out.height - height) / 2 + (overflow > 0 ? overflow / 2 - overflow * local : 0);

  ctx.save();
  ctx.globalAlpha = alpha;
  drawPage(ctx, page, (out.width - width) / 2, y, width, height);
  ctx.restore();
}

/**
 * Draw one page, with a cheap stand-in for a drop shadow.
 *
 * A real blurred shadow measured 216ms per frame on the server canvas —
 * eighteen times the cost of scaling the page itself, and by far the largest
 * item in a render. Since the shadow is decoration and the page is an opaque
 * rectangle, a few translucent offset rectangles read almost identically at
 * playback size for well under a millisecond.
 */
function drawPage(
  ctx: Ctx,
  page: DrawablePage,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const depth = Math.max(2, Math.round(width * 0.005));

  ctx.save();
  // Stacked rectangles, each fainter and further out, approximate a blur.
  // They sit below and outside the page and are always overdrawn by it, so
  // nothing of the shadow shows through the page itself.
  ctx.fillStyle = "#000000";
  for (let i = depth; i >= 1; i--) {
    ctx.globalAlpha = 0.055 * (1 - (i - 1) / depth);
    ctx.fillRect(x - i, y + i, width + i * 2, height + i);
  }
  ctx.restore();

  // The page may carry transparency, so it needs an opaque ground — and that
  // ground also hides the shadow rectangles underneath it.
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, width, height);
  ctx.restore();

  ctx.drawImage(page.bitmap, x, y, width, height);
}

/* ---------------- cards and overlays ---------------- */

function drawCard(
  ctx: Ctx,
  out: OutputSize,
  title: string,
  subtitle: string,
  settings: Settings,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.textAlign = "center";
  const base = Math.min(out.width, out.height);

  ctx.fillStyle = settings.accent;
  ctx.font = `600 ${Math.round(base * 0.075)}px "Barlow Condensed", sans-serif`;
  wrapText(
    ctx,
    title,
    out.width / 2,
    out.height / 2 - (subtitle ? base * 0.045 : 0),
    out.width * 0.82,
    base * 0.09,
  );

  if (subtitle) {
    ctx.fillStyle = "#C9CEDA";
    ctx.font = `400 ${Math.round(base * 0.034)}px Inter, sans-serif`;
    wrapText(ctx, subtitle, out.width / 2, out.height / 2 + base * 0.065, out.width * 0.75, base * 0.045);
  }
  ctx.restore();
}

function wrapText(
  ctx: Ctx,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const startY = cy - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
}

function drawOverlays(
  ctx: Ctx,
  out: OutputSize,
  pageNum: number,
  progress: number,
  fc: FrameContext,
): void {
  const { settings, layout } = fc;
  const base = Math.min(out.width, out.height);
  const inset = Math.round(base * 0.028);

  if (settings.watermark) {
    ctx.save();
    ctx.font = `500 ${Math.round(base * 0.024)}px Inter, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";

    // Sit the watermark above the progress bar rather than under it.
    const barSpace = settings.showProgressBar ? Math.max(3, Math.round(out.height * 0.006)) * 2 : 0;
    const y = out.height - inset - barSpace;

    // A blurred shadow behind semi-transparent text reads as a doubled
    // image, so the backing is a crisp offset copy instead.
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = "#000000";
    ctx.fillText(settings.watermark, inset + 1.5, y + 1.5);

    ctx.globalAlpha = 0.72;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(settings.watermark, inset, y);
    ctx.restore();
  }

  if (settings.showCounter && layout.boxes.length) {
    const last = layout.boxes[layout.boxes.length - 1].page.num;
    const label = `Page ${pageNum} / ${last}`;
    ctx.save();
    ctx.font = `500 ${Math.round(base * 0.022)}px "JetBrains Mono", monospace`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    const textWidth = ctx.measureText(label).width;
    const pillHeight = Math.round(base * 0.042);

    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#000000";
    roundRect(
      ctx,
      out.width - inset - textWidth - pillHeight * 0.5,
      out.height - inset - pillHeight,
      textWidth + pillHeight * 0.5,
      pillHeight,
      pillHeight * 0.22,
    );
    ctx.fill();

    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, out.width - inset - pillHeight * 0.25, out.height - inset - pillHeight * 0.24);
    ctx.restore();
  }

  if (settings.showProgressBar) {
    const barHeight = Math.max(3, Math.round(out.height * 0.006));
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, out.height - barHeight, out.width, barHeight);
    ctx.globalAlpha = 1;
    ctx.fillStyle = settings.accent;
    // Quantised to the same steps the frame cache uses. A bar that advances
    // a fraction of a pixel per frame makes every frame unique and costs
    // most of the render speed, for movement no one can see.
    ctx.fillRect(
      0,
      out.height - barHeight,
      quantizeBar(Math.min(1, Math.max(0, progress)), out.width),
      barHeight,
    );
    ctx.restore();
  }
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
