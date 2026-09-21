/**
 * Measured time estimates.
 *
 * A predicted ETA is worthless across the range of machines this runs on, so
 * nothing here guesses from hardware. It times real frames and extrapolates,
 * then keeps correcting as the render proceeds. An accurate countdown is the
 * difference between a user waiting and a user closing the tab.
 */

/** Frames to time before the first estimate is trustworthy. */
const WARMUP_FRAMES = 20;
/** Weight of the newest sample in the rolling average. */
const SMOOTHING = 0.15;

export class RenderEstimator {
  private readonly totalFrames: number;
  private framesDone = 0;
  private startedAt = 0;
  /** Exponentially smoothed seconds per frame. */
  private msPerFrame: number | null = null;
  private lastFrameAt = 0;

  constructor(totalFrames: number) {
    this.totalFrames = Math.max(1, totalFrames);
  }

  start(now = Date.now()): void {
    this.startedAt = now;
    this.lastFrameAt = now;
    this.framesDone = 0;
    this.msPerFrame = null;
  }

  /**
   * Record one finished frame. `count` lets a worker report a batch, and
   * reused frames can be reported too — they are genuinely faster, and the
   * rolling average absorbs that.
   */
  tick(count = 1, now = Date.now()): void {
    const elapsed = now - this.lastFrameAt;
    this.lastFrameAt = now;
    this.framesDone += count;

    const per = elapsed / Math.max(1, count);
    // Ignore the first frame: it carries one-off setup cost and would
    // poison the average with a wildly high number.
    if (this.framesDone <= 1) return;

    this.msPerFrame =
      this.msPerFrame === null ? per : this.msPerFrame * (1 - SMOOTHING) + per * SMOOTHING;
  }

  get done(): number {
    return this.framesDone;
  }

  get total(): number {
    return this.totalFrames;
  }

  get progress(): number {
    return Math.min(1, this.framesDone / this.totalFrames);
  }

  /** Seconds remaining, or null while the measurement is still warming up. */
  etaSeconds(now = Date.now()): number | null {
    if (this.framesDone < WARMUP_FRAMES) {
      // Before warmup, fall back to wall-clock extrapolation if we have
      // enough elapsed time for it to mean anything.
      const elapsed = (now - this.startedAt) / 1000;
      if (this.framesDone < 3 || elapsed < 0.5) return null;
      const rate = this.framesDone / elapsed;
      return Math.max(0, (this.totalFrames - this.framesDone) / rate);
    }

    if (this.msPerFrame === null) return null;
    const remaining = this.totalFrames - this.framesDone;
    return Math.max(0, (remaining * this.msPerFrame) / 1000);
  }

  elapsedSeconds(now = Date.now()): number {
    return Math.max(0, (now - this.startedAt) / 1000);
  }
}

/**
 * A rough up-front estimate, shown before the user commits so the cost of
 * each setting is visible at the moment they change it. Deliberately
 * conservative: it is replaced by measured numbers seconds after the render
 * starts, and an estimate that comes in early reads as a broken promise.
 */
export function predictSeconds(opts: {
  uniqueFrames: number;
  totalFrames: number;
  width: number;
  height: number;
  hardwareEncoder: boolean;
}): number {
  const megapixels = (opts.width * opts.height) / 1_000_000;

  // Calibrated against a 2-core mobile i5: roughly 18ms per megapixel to
  // composite a frame, with reused frames costing only the encode.
  const drawMs = opts.uniqueFrames * megapixels * 18;
  const encodeMsPerFrame = opts.hardwareEncoder ? 1.4 : 4.0;
  const encodeMs = opts.totalFrames * megapixels * encodeMsPerFrame;

  return (drawMs + encodeMs) / 1000;
}
