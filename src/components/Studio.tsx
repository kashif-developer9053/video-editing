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

  const requestPreview = useCallback(
    (immediate = false) => {
      if (!source) return;

      if (previewTimer.current) clearTimeout(previewTimer.current);
      const run = async () => {
        const seq = ++previewSeq.current;
        const form = new FormData();
        form.set("settings", JSON.stringify(settings));
        form.set("time", String(time));
        // Send the file only when the server has no cached raster for it.
        if (previewKey) form.set("key", previewKey);
        else form.set("pdf", source.file);

        try {
          const res = await fetch("/api/preview", { method: "POST", body: form });

          if (res.status === 409) {
            // Cache expired; retry once with the file attached.
            setPreviewKey(null);
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

          setStats({
            frames: Number(res.headers.get("X-Scrollcast-Frames") ?? 0),
            uniqueFrames: Number(res.headers.get("X-Scrollcast-Unique") ?? 0),
            predictedSeconds: Number(res.headers.get("X-Scrollcast-Estimate") ?? 0),
            encoder: res.headers.get("X-Scrollcast-Encoder") ?? "",
          });

          const blob = await res.blob();
          window.dispatchEvent(
            new CustomEvent("scrollcast:preview", { detail: URL.createObjectURL(blob) }),
          );
          setError(null);
        } catch (err) {
          if (seq === previewSeq.current) {
            setError(err instanceof Error ? err.message : "Could not show a preview.");
          }
        }
      };

      if (immediate) void run();
      else previewTimer.current = setTimeout(run, 220);
    },
    [settings, time, source, previewKey, setPreviewKey, setStats],
  );

  useEffect(() => {
    if (source && status !== "rendering") requestPreview();
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
    // requestPreview closes over everything that should retrigger it.
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

      // One probe render tells us the page count and warms the server cache.
      const form = new FormData();
      form.set("pdf", file);
      form.set("settings", JSON.stringify({ ...settings, pageFrom: 1, pageTo: 1 }));
      form.set("time", "0");

      try {
        const res = await fetch("/api/preview", { method: "POST", body: form });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Could not read that PDF. It may be damaged or password protected." }));
          throw new Error(body.error ?? "Could not read that PDF. It may be damaged or password protected.");
        }
        const pages = Number(res.headers.get("X-Scrollcast-Pages") ?? 1);
        setSource({ file, name: file.name, documentPages: pages });
        setPreviewKey(null);
        setStatus("ready");
        setStatusText("Ready");
        setStatusMeta(`${pages} pages`);
      } catch (err) {
        setStatus("error");
        setStatusText("Could not open that file");
        setStatusMeta("");
        setError(err instanceof Error ? err.message : "Could not read that PDF. It may be damaged or password protected.");
      }
    },
    [settings, setSource, setPreviewKey],
  );

  /* ---------------- rendering ---------------- */

  const poll = useCallback((id: string) => {
    const tick = async () => {
      try {
        const res = await fetch(`/api/render/${id}`);
        if (!res.ok) throw new Error("Lost track of the video. Please try again.");
        const data = (await res.json()) as JobProgress & { result: Finished | null };
        setJob(data);

        if (data.status === "done" && data.result) {
          setFinished({ ...data.result, id });
          setStatus("ready");
          setStatusText("Your video is ready");
          setStatusMeta(`${data.result.encoder}`);
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
          data.etaSeconds !== null ? `about ${formatShort(data.etaSeconds)} left` : "working out how long",
        );
        setTimeout(tick, 500);
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Lost track of the video. Please try again.");
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start making the video.");
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
    <div className="flex h-full flex-col">
      <header className="flex flex-none flex-wrap items-center gap-3.5 border-b border-rule bg-panel px-[18px] py-2.5">
        <div className="mr-auto flex items-baseline gap-2.5">
          <h1 className="font-display text-[21px] font-bold tracking-[0.055em] uppercase">
            Scroll<span className="text-accent">cast</span>
          </h1>
          <em className="font-mono text-[11px] tracking-[0.09em] text-dim uppercase not-italic">
            PDF → Video
          </em>
        </div>
        <span className="rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] text-ok">
          STAYS ON YOUR COMPUTER
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_352px]">
        <Stage status={status} statusText={statusText} statusMeta={statusMeta} onFile={onFile} />

        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Rail disabled={rendering} />
          </div>

          <div className="flex flex-none flex-col gap-2.5 border-t border-rule bg-panel px-[18px] py-4">
            {stats && !rendering && !finished && (
              <p className="text-center font-mono text-[11px] text-dim tabular-nums">
                about {formatShort(stats.predictedSeconds)} to make
              </p>
            )}

            <button
              type="button"
              disabled={!source}
              onClick={rendering ? cancelRender : startRender}
              className={`flex w-full items-center justify-center gap-2 rounded-[5px] border px-3 py-3 font-display text-[15px] font-semibold tracking-[0.07em] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                rendering
                  ? "border-rec bg-rec text-white hover:bg-rec/90"
                  : "border-accent bg-accent text-accentink hover:border-accenthi hover:bg-accenthi"
              }`}
            >
              {rendering ? "Stop" : finished ? "Make it again" : "Make video"}
            </button>

            {rendering && (
              <>
                <div className="h-[3px] overflow-hidden rounded bg-rule">
                  <span
                    className="block h-full bg-accent transition-[width] duration-200"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
                <p className="text-center text-[11px] text-dim">
                  {Math.round(progress * 100)}% done ·{" "}
                  {job?.etaSeconds !== null && job?.etaSeconds !== undefined
                    ? `about ${formatShort(job.etaSeconds)} left`
                    : "working out how long"}
                </p>
              </>
            )}

            {error && (
              <p className="rounded border border-rec/30 bg-rec/10 px-2.5 py-2 text-[11.5px] text-rec">
                {error}
              </p>
            )}

            {finished && (
              <div className="flex flex-col gap-2.5 rounded-[5px] border border-ok/30 bg-ok/[0.06] p-2.5">
                <p className="text-xs text-ok">
                  Video ready — {(finished.sizeBytes / 1048576).toFixed(1)} MB
                </p>
                <span className="font-mono text-[10.5px] text-muted tabular-nums">
                  {finished.width}×{finished.height} · {finished.frames} frames ·{" "}
                  {finished.elapsedSeconds.toFixed(1)}s · {finished.encoder}
                </span>
                <a
                  href={`/api/render/${finished.id}/download`}
                  className="flex items-center justify-center gap-2 rounded border border-rule bg-panel2 px-3 py-2.5 text-[13px] transition-colors hover:border-rulehi hover:bg-rulehi/20"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                    <path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5v-2z" />
                  </svg>
                  Save video
                </a>
                <p className="text-center text-[10.5px] text-dim">
                  The video is removed from your computer after you save it.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
