/**
 * Frame reuse.
 *
 * This is the single biggest speed win in the renderer. In slide mode a page
 * holds still for seconds at a time, so those frames are pixel-identical —
 * drawing each one again is wasted work. frameKey() returns a string that
 * changes only when the picture changes, so the caller can re-encode the
 * previous buffer instead of redrawing.
 *
 * The key must capture everything drawFrame() reads at a given time, and
 * nothing else. Getting that wrong shows up as a frozen or flickering video,
 * so the rounding below is deliberately coarse only where a sub-pixel
 * difference cannot be seen.
 */

import { autopaceDistance, cardTiming, easeEnds, pageAtProgress } from "./layout";
import {
  pageScale,
  panDistance,
  panProgress,
  quantizeBar,
  type FrameContext,
} from "./compositor";

/** Share of a page's time spent transitioning — must match the compositor. */
const TRANSITION_SHARE = 0.22;

/**
 * Identity of the frame at `time`. Two times with the same key render to the
 * same pixels.
 */
export function frameKey(time: number, fc: FrameContext): string {
  const { settings, weights, layout } = fc;
  const timing = cardTiming(settings);

  // Cards fade, so they change every frame while the fade runs; once a card
  // is fully opaque it is static and can be reused.
  if (timing.intro && time < timing.intro) {
    return `intro:${alphaBucket(time, timing.intro)}`;
  }
  if (timing.outro && time >= timing.intro + timing.body) {
    return `outro:${alphaBucket(time - timing.intro - timing.body, timing.outro)}`;
  }

  const bodyTime = Math.min(timing.body, Math.max(0, time - timing.intro));
  const progress = timing.body > 0 ? bodyTime / timing.body : 0;

  // Quantised to the same steps the compositor draws, so a held page still
  // reuses between bar steps instead of every frame being unique.
  const barPart = settings.showProgressBar
    ? `:b${Math.round(quantizeBar(time / Math.max(1, settings.duration), layout.out.width))}`
    : "";

  // Scrolling frames differ only by where the camera sits. On a long slow
  // scroll it can advance less than a pixel per frame, and those frames are
  // identical — so the key is the camera position in whole pixels, not the
  // timestamp.
  if (settings.mode === "scroll" || settings.mode === "autopace") {
    const travel = Math.max(0, layout.totalHeight - layout.out.height);
    let p = progress;
    if (settings.mode === "autopace") p = autopaceDistance(progress, layout, weights);
    else if (settings.ease) p = easeEnds(progress);
    const camY = Math.round(travel > 0 ? p * travel : 0);
    return `scroll:${camY}${barPart}`;
  }

  const { index, local } = pageAtProgress(progress, weights);
  const box = layout.boxes[index];
  if (!box) return `empty:${index}`;

  const hasNext = index + 1 < layout.boxes.length;
  const inTransition = hasNext && local > 1 - TRANSITION_SHARE && settings.transition !== "cut";

  if (settings.mode === "kenburns") {
    // Ken Burns drifts continuously, so its frames never truly repeat.
    return `kb:${index}:${local.toFixed(4)}${inTransition ? ":t" : ""}${barPart}`;
  }

  if (inTransition) {
    const k = (local - (1 - TRANSITION_SHARE)) / TRANSITION_SHARE;
    return `tr:${index}:${k.toFixed(4)}${barPart}`;
  }

  // A page taller than the frame pans while it is held, so those frames are
  // not identical after all — the key has to follow the pan, quantised to
  // whole pixels of travel. A page that fits entirely still reuses.
  const overflow = pageOverflow(box, layout, settings.fit);
  if (overflow > 0) {
    const panSpan = settings.transition === "cut" ? 1 : 1 - TRANSITION_SHARE;
    const reveal = panProgress(local, panSpan);
    // Quantised to whole pixels of travel, so the dwell at each end of the
    // pan collapses into reused frames.
    return `pan:${index}:${Math.round(reveal * overflow)}${barPart}`;
  }

  // The static case this whole module exists for: a page simply held.
  return `hold:${index}${barPart}`;
}

/**
 * Pixels of the page that hang below the frame, which is how far the pan
 * travels. Must mirror drawFitted's scaling exactly — if the two disagree,
 * reuse either freezes a moving frame or redraws a still one.
 */
function pageOverflow(
  box: { page: { width: number; height: number; contentBottom?: number } },
  layout: FrameContext["layout"],
  fit: string,
): number {
  const { out, pad } = layout;
  const page = box.page;
  return panDistance(page, page.height * pageScale(page, out, pad, fit), out, pad);
}

/** Card fades quantised to 1/255 — finer than the eye or the encoder sees. */
function alphaBucket(time: number, span: number): string {
  const fade = Math.min(0.45, span * 0.28);
  let alpha = 1;
  if (time < fade) alpha = time / fade;
  else if (time > span - fade) alpha = Math.max(0, (span - time) / fade);
  return Math.round(alpha * 255).toString();
}

/**
 * How many of the frames in a render would be redraws. Used to show an
 * honest estimate before the user commits, and to pick a strategy.
 */
export function estimateReuse(
  fps: number,
  duration: number,
  fc: FrameContext,
): { total: number; unique: number; ratio: number } {
  const total = Math.max(1, Math.round(duration * fps));
  const seen = new Set<string>();

  // Sampling every frame is cheap: it is string building, not drawing.
  for (let i = 0; i < total; i++) {
    seen.add(frameKey(i / fps, fc));
  }

  return { total, unique: seen.size, ratio: seen.size / total };
}
