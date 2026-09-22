/**
 * Progress for work that happens inside a single request.
 *
 * Opening a PDF is one POST that returns when every page has been
 * rasterized. On a 100-page document that is a long silence with nothing on
 * screen, and no way for the browser to tell whether it is working or stuck.
 *
 * The rasterizer already reports per-page progress; this holds the latest
 * value under a key the client knows, so a second, cheap request can read it
 * while the first is still running.
 */

export interface Progress {
  done: number;
  total: number;
  /** Set once the work has finished, so a poller can stop. */
  finished: boolean;
  updatedAt: number;
}

/**
 * Held on globalThis rather than in module scope.
 *
 * Next gives each route its own module instance, so a plain module-level Map
 * exists twice — the preview route writes to one copy and the progress route
 * reads an empty other one, and every poll comes back as "nothing recorded".
 * A global is the one thing both instances share.
 */
const store = globalThis as unknown as { __scrollcastProgress?: Map<string, Progress> };
store.__scrollcastProgress ??= new Map<string, Progress>();
const entries = store.__scrollcastProgress;

/** Drop anything older than this, so a failed request cannot leak. */
const TTL_MS = 10 * 60 * 1000;

export function startProgress(key: string, total: number): void {
  entries.set(key, { done: 0, total, finished: false, updatedAt: Date.now() });
  sweep();
}

export function reportProgress(key: string, done: number, total: number): void {
  entries.set(key, { done, total, finished: false, updatedAt: Date.now() });
}

export function finishProgress(key: string): void {
  const current = entries.get(key);
  entries.set(key, {
    done: current?.total ?? 1,
    total: current?.total ?? 1,
    finished: true,
    updatedAt: Date.now(),
  });
}

export function readProgress(key: string): Progress | null {
  return entries.get(key) ?? null;
}

function sweep(): void {
  const now = Date.now();
  for (const [key, value] of entries) {
    if (now - value.updatedAt > TTL_MS) entries.delete(key);
  }
}
