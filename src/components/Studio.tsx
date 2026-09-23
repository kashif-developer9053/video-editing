"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatShort } from "@/engine/layout";
import type { JobProgress } from "@/engine/types";
import {
  useMusic,
  usePreviewKey,
  useSetPreviewKey,
  useSetSource,
  useSetStats,
  useSettingsValue,
  useSource,
  useStats,
  useTime,
} from "@/store/settings";
import { Landing } from "./Landing";
import { Rail } from "./Rail";
import { Stage, type StageStatus } from "./Stage";

interface Finished {
  id: string;
  width: number;
  height: number;
  frames: number;
  uniqueFrames: number;
  encoder: string;
  elapsedSeconds: number;
  sizeBytes: number;
}

export function Studio() {
  const settings = useSettingsValue();
  const source = useSource();
  const music = useMusic();
  const previewKey = usePreviewKey();
  const stats = useStats();
  const time = useTime();
  const setSource = useSetSource();
  const setPreviewKey = useSetPreviewKey();
  const setStats = useSetStats();

  const [status, setStatus] = useState<StageStatus>("idle");
  const [statusText, setStatusText] = useState("Choose a PDF to start");
  const [statusMeta, setStatusMeta] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobProgress | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const jobId = useRef<string | null>(null);

  /* ---------------- preview ---------------- */

  // The preview is a server render of one frame, so it cannot drift from the
  // finished video. Requests are debounced and superseded: dragging a slider
  // should not queue a dozen renders.
  const previewSeq = useRef(0);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const readStats = useCallback(
    (res: Response) => {
      setStats({
        frames: Number(res.headers.get("X-Scrollcast-Frames") ?? 0),
        uniqueFrames: Number(res.headers.get("X-Scrollcast-Unique") ?? 0),
        predictedSeconds: Number(res.headers.get("X-Scrollcast-Estimate") ?? 0),
        encoder: res.headers.get("X-Scrollcast-Encoder") ?? "",
      });
    },
    [setStats],
  );

  const requestPreview = useCallback(() => {
    if (!source) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);

    const run = async () => {
      const seq = ++previewSeq.current;
      const form = new FormData();
      form.set("settings", JSON.stringify(settings));
      form.set("time", String(time));
      // Sending the file means the server has to rasterize every page, which
      // on a long document takes a while; a tracking id lets us show how far
      // along it is. With a cached key there is nothing to wait for.
      const track = previewKey ? null : `prev-${seq}-${Date.now()}`;
      if (previewKey) form.set("key", previewKey);
      else form.set("pdf", source.file);
      if (track) form.set("track", track);

      let polling = !!track;
      if (track) {
        void (async () => {
          while (polling) {
            await new Promise((r) => setTimeout(r, 400));
            if (!polling) break;
            try {
              const res = await fetch(`/api/preview/progress?key=${encodeURIComponent(track)}`);
              if (!res.ok) continue;
              const p = (await res.json()) as { done: number; total: number; finished: boolean };
              if (!polling || p.finished) break;
              // Only speak up once there is enough work to be worth reporting.
              if (p.total > 3 && seq === previewSeq.current) {
                setStatus("loading");
                setStatusText("Getting your pages ready");
                setStatusMeta(`reading page ${p.done} of ${p.total}`);
              }
            } catch {
              // A failed poll is not worth surfacing; the real request runs on.
            }
          }
        })();
      }

      try {
        const res = await fetch("/api/preview", { method: "POST", body: form });

        if (res.status === 409) {
          // The server's cached pages are gone, or are too small for these
          // settings. Send the file straight away rather than only clearing
          // the key: waiting for the effect to fire again leaves the stage
          // showing nothing in between.
          setPreviewKey(null);
          if (seq !== previewSeq.current) return;

          const retry = new FormData();
          retry.set("settings", JSON.stringify(settings));
          retry.set("time", String(time));
          retry.set("pdf", source.file);
          if (track) retry.set("track", track);

          const again = await fetch("/api/preview", { method: "POST", body: retry });
          if (!again.ok || seq !== previewSeq.current) return;

          const retryKey = again.headers.get("X-Scrollcast-Key");
          if (retryKey) setPreviewKey(retryKey);
          readStats(again);

          const retryBlob = await again.blob();
          window.dispatchEvent(
            new CustomEvent("scrollcast:preview", { detail: URL.createObjectURL(retryBlob) }),
          );
          setError(null);
          setStatus("ready");
          setStatusText("Ready");
          setStatusMeta("");
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Could not show a preview." }));
          throw new Error(body.error ?? "Could not show a preview.");
        }
        // A newer request has already started; drop this result.
        if (seq !== previewSeq.current) return;

        const key = res.headers.get("X-Scrollcast-Key");
        if (key) setPreviewKey(key);

        readStats(res);

        const blob = await res.blob();
        window.dispatchEvent(
          new CustomEvent("scrollcast:preview", { detail: URL.createObjectURL(blob) }),
        );
        setError(null);
        if (track && seq === previewSeq.current) {
          setStatus("ready");
          setStatusText("Ready");
          setStatusMeta("");
        }
      } catch (err) {
        if (seq === previewSeq.current) {
          setError(err instanceof Error ? err.message : "Could not show a preview.");
        }
      } finally {
        polling = false;
      }
    };

    previewTimer.current = setTimeout(run, 220);
  }, [settings, time, source, previewKey, setPreviewKey, readStats]);

  useEffect(() => {
    if (source && status !== "rendering") requestPreview();
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [requestPreview, source, status]);

  /* ---------------- loading ---------------- */

  const onFile = useCallback(
    async (file: File) => {
      if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
        setError("That is not a PDF file. Please choose a PDF.");
        return;
      }

      setStatus("loading");
      setStatusText("Opening your PDF");
      setStatusMeta(file.name);
      setError(null);
      setFinished(null);

      const unreadable = "Could not read that PDF. It may be damaged or password protected.";

      // Ask only for the page count. This used to be a full preview request
      // with pageTo:1, which meant uploading the whole document twice — once
      // to learn how many pages it had, then again for the real preview. On
      // a phone the upload is the slow part.
      const form = new FormData();
      form.set("pdf", file);

      try {
        const res = await fetch("/api/pages", { method: "POST", body: form });
        const text = await res.text();
        let data: { pages?: number; error?: string } = {};
        try {
          data = JSON.parse(text) as { pages?: number; error?: string };
        } catch {
          throw new Error(unreadable);
        }
        if (!res.ok || !data.pages) throw new Error(data.error ?? unreadable);

        const pages = data.pages;
        setSource({ file, name: file.name, documentPages: pages });
        setPreviewKey(null);
        setStatus("ready");
        setStatusText("Ready");
        setStatusMeta(`${pages} ${pages === 1 ? "page" : "pages"}`);
      } catch (err) {
        setStatus("error");
        setStatusText("Could not open that file");
        setStatusMeta("");
        setError(err instanceof Error ? err.message : unreadable);
      }
    },
    [setSource, setPreviewKey],
  );

  /* ---------------- rendering ---------------- */

  const poll = useCallback((id: string) => {
    const lost = "Lost track of the video. Please try again.";
    // A render runs for minutes, and on a phone a poll or two will fail:
    // the radio drops, the tab is backgrounded, the connection stalls. One
    // failure used to end the loop and report the video lost, which is why
    // progress could jump from 0% straight to an error. Give up only after
    // several consecutive failures.
    let consecutiveFailures = 0;
    const MAX_FAILURES = 8;

    const tick = async () => {
      try {
        const res = await fetch(`/api/render/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(lost);

        // Parse defensively: a proxy in front of the app can answer with an
        // HTML error page, and res.json() on that throws "Unexpected end of
        // JSON input" — an error about our own parsing, not about the video.
        const text = await res.text();
        let data: (JobProgress & { result: Finished | null }) | null = null;
        try {
          data = JSON.parse(text) as JobProgress & { result: Finished | null };
        } catch {
          throw new Error(lost);
        }

        consecutiveFailures = 0;
        setJob(data);

        if (data.status === "done" && data.result) {
          setFinished({ ...data.result, id });
          setStatus("ready");
          setStatusText("Your video is ready");
          setStatusMeta("");
          jobId.current = null;
          return;
        }
        if (data.status === "failed" || data.status === "cancelled") {
          setStatus(data.status === "failed" ? "error" : "ready");
          setStatusText(data.status === "failed" ? "Something went wrong" : "Stopped");
          setStatusMeta("");
          if (data.error) setError(data.error);
          jobId.current = null;
          return;
        }

        setStatusText(data.message);
        setStatusMeta(
          data.etaSeconds !== null ? `about ${formatShort(data.etaSeconds)} left` : "",
        );
        setTimeout(tick, 1000);
      } catch (err) {
        consecutiveFailures += 1;
        if (consecutiveFailures < MAX_FAILURES) {
          // Back off a little rather than hammering a connection that is
          // already struggling.
          setTimeout(tick, Math.min(5000, 1000 * consecutiveFailures));
          return;
        }
        setStatus("error");
        setError(err instanceof Error ? err.message : lost);
        jobId.current = null;
      }
    };
    void tick();
  }, []);

  const startRender = useCallback(async () => {
    if (!source) return;

    setStatus("rendering");
    setStatusText("Getting ready");
    setStatusMeta("");
    setError(null);
    setFinished(null);
    setJob(null);

    const form = new FormData();
    form.set("pdf", source.file);
    form.set("settings", JSON.stringify(settings));
    if (music) form.set("audio", music);

    try {
      const res = await fetch("/api/render", { method: "POST", body: form });
      // Same defensive parse: a 502 from a proxy is HTML, not JSON.
      const text = await res.text();
      let data: { id?: string; error?: string } = {};
      try {
        data = JSON.parse(text) as { id?: string; error?: string };
      } catch {
        throw new Error(
          res.ok
            ? "The server gave an unexpected reply. Please try again."
            : "The server is busy or unreachable. Please try again in a moment.",
        );
      }
      if (!res.ok) throw new Error(data.error ?? "Could not start making the video.");
      if (!data.id) throw new Error("The server did not start the video. Please try again.");
      jobId.current = data.id;
      poll(data.id);
    } catch (err) {
      setStatus("error");
      setStatusText("Could not start");
      setError(err instanceof Error ? err.message : "Could not start making the video.");
    }
  }, [source, settings, music, poll]);

  const cancelRender = useCallback(async () => {
    if (!jobId.current) return;
    await fetch(`/api/render/${jobId.current}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const rendering = status === "rendering";
  const progress = job?.progress ?? 0;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-none items-center gap-3 border-b border-rule bg-panel px-4 py-3">
        <h1 className="mr-auto font-display text-xl font-bold tracking-[0.055em] uppercase">
          Scroll<span className="text-accent">cast</span>
        </h1>
        <span className="hidden rounded-full border border-ok/30 bg-ok/10 px-2.5 py-1 text-[11px] text-ok sm:inline">
          Stays on your computer
        </span>
      </header>

      {/*
        One column on a phone, side by side once there is room. Before a file
        is chosen the columns swap weight: the explanation leads and the drop
        zone sits beside it, rather than a big empty box dominating the page.
      */}
      <main
        className={`mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 pt-4 lg:grid lg:items-start ${
          source
            ? "pb-32 lg:grid-cols-[minmax(0,1fr)_380px]"
            : "gap-8 pb-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10"
        }`}
      >
        <div
          className={
            source
              ? "lg:sticky lg:top-4 lg:flex lg:h-[calc(100dvh-13rem)] lg:flex-col"
              : "lg:order-2 lg:sticky lg:top-4 lg:self-start"
          }
        >
          <Stage
            status={status}
            statusText={statusText}
            statusMeta={statusMeta}
            onFile={onFile}
          />
        </div>

        {source ? (
          <div className="flex flex-col gap-4">
            <Rail disabled={rendering} />
          </div>
        ) : (
          <Landing />
        )}
      </main>

      {/* The action bar follows on a phone and sits in the flow on a desktop. */}
      {source ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-panel/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
            {error ? (
              <p className="rounded-lg border border-rec/30 bg-rec/10 px-3 py-2 text-xs text-rec">
                {error}
              </p>
            ) : null}

            {finished ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <p className="flex-1 text-sm text-ok">
                  Video ready — {(finished.sizeBytes / 1048576).toFixed(1)} MB
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={startRender}
                    className="min-h-12 flex-1 rounded-lg border border-rule bg-panel2 px-4 text-sm transition-colors hover:border-rulehi sm:flex-none"
                  >
                    Make again
                  </button>
                  <a
                    href={`/api/render/${finished.id}/download`}
                    className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-5 font-display text-base font-semibold tracking-[0.06em] text-accentink uppercase transition-colors hover:bg-accenthi sm:flex-none"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 fill-current">
                      <path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5v-2z" />
                    </svg>
                    Save video
                  </a>
                </div>
              </div>
            ) : (
              <>
                {rendering ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-rule">
                      <span
                        className="block h-full bg-accent transition-[width] duration-200"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </div>
                    <p className="text-center text-xs text-dim">
                      {Math.round(progress * 100)}% done
                      {job?.etaSeconds != null ? ` · about ${formatShort(job.etaSeconds)} left` : ""}
                    </p>
                  </div>
                ) : stats ? (
                  <p className="text-center text-xs text-dim">
                    Takes about {formatShort(stats.predictedSeconds)} to make
                  </p>
                ) : null}

                <button
                  type="button"
                  onClick={rendering ? cancelRender : startRender}
                  className={`min-h-14 w-full rounded-lg font-display text-lg font-semibold tracking-[0.06em] uppercase transition-colors ${
                    rendering
                      ? "bg-rec text-white hover:bg-rec/90"
                      : "bg-accent text-accentink hover:bg-accenthi"
                  }`}
                >
                  {rendering ? "Stop" : "Make video"}
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
