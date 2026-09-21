"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatTimecode } from "@/engine/layout";
import { useSetTime, useSettingsValue, useSource, useTime } from "@/store/settings";

export type StageStatus = "idle" | "loading" | "ready" | "rendering" | "error";

export function Stage({
  status,
  statusText,
  statusMeta,
  onFile,
}: {
  status: StageStatus;
  statusText: string;
  statusMeta: string;
  onFile: (file: File) => void;
}) {
  const settings = useSettingsValue();
  const source = useSource();
  const time = useTime();
  const setTime = useSetTime();
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [playing, setPlaying] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Keep the latest callback in a ref so the change listener below can be
  // attached exactly once, without re-binding every time settings change.
  const onFileRef = useRef(onFile);
  useEffect(() => {
    onFileRef.current = onFile;
  }, [onFile]);

  // Bound natively rather than through React's onChange: the synthetic
  // change event does not reach this input reliably here, so a picked file
  // would silently do nothing.
  const bindFileInput = useCallback((el: HTMLInputElement | null) => {
    fileInput.current = el;
    if (!el || el.dataset.bound === "1") return;
    el.dataset.bound = "1";
    el.addEventListener("change", () => {
      const file = el.files?.[0];
      if (file) onFileRef.current(file);
    });
  }, []);

  const busy = status === "rendering" || status === "loading";
  // Rendering takes the transport over, so playback reads as stopped without
  // needing an effect to reset the flag.
  const isPlaying = playing && !busy;

  // Preview playback steps the scrub position, which the existing preview
  // pipeline already reacts to. It is deliberately coarse — a few frames a
  // second — because each step is a server render; it shows the pacing, not
  // the final motion.
  useEffect(() => {
    if (!playing || busy || !source) return;
    const STEP_MS = 400;
    const id = setInterval(() => {
      setTime((current) => {
        const next = current + STEP_MS / 1000;
        if (next >= settings.duration) {
          setPlaying(false);
          return settings.duration;
        }
        return next;
      });
    }, STEP_MS);
    return () => clearInterval(id);
  }, [playing, busy, source, settings.duration, setTime]);

  // Each new frame revokes the one it replaces, so blob URLs do not pile up.
  // The revoke happens in the setter rather than an effect cleanup: an effect
  // keyed on `preview` also runs when the component re-renders for unrelated
  // reasons, which would revoke the URL of the image still on screen.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setPreview((old) => {
        if (old && old !== detail) URL.revokeObjectURL(old);
        return detail;
      });
    };
    window.addEventListener("scrollcast:preview", handler);
    return () => window.removeEventListener("scrollcast:preview", handler);
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-stage">
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-5"
        style={{ backgroundImage: "radial-gradient(circle at 50% 40%, #12151C 0%, #07080B 72%)" }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.relatedTarget) setDragging(false);
        }}
        onDrop={onDrop}
      >
        {preview ? (
          // object-contain keeps the whole frame visible whatever the
          // aspect ratio, so switching to 9:16 does not crop the preview.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={`Preview at ${formatTimecode(time)}`}
            className="max-h-full max-w-full object-contain rounded-sm shadow-[0_0_0_1px_var(--rule),0_26px_70px_rgba(0,0,0,.72)]"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center rounded-md border border-dashed"
            style={{ borderColor: dragging ? "var(--accent)" : "var(--rule)" }}
          />
        )}

        {!source && (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className={`absolute inset-5 flex cursor-pointer flex-col items-center justify-center gap-3.5 rounded-md border border-dashed p-6 text-center transition-colors ${
              dragging ? "border-accent bg-accent/5" : "border-rule"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-10 w-10 fill-none stroke-dim stroke-[1.4]"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M12 18v-6" />
              <path d="m9 15 3-3 3 3" />
            </svg>
            <h2 className="font-display text-2xl font-semibold tracking-wide uppercase">Add your PDF</h2>
            <p className="max-w-[42ch] text-[13px] text-muted">
              Drag a PDF here, or click to choose one. Your file never leaves your computer.
            </p>
            <small className="font-mono text-[11px] text-dim">PDF files only</small>
          </button>
        )}

        {/*
          Positioned off-screen rather than `hidden`: a display:none input
          does not reliably accept a programmatic .click(), so the drop zone
          button would open nothing.
        */}
        {/* Change is handled by a native listener above, not onChange. */}
        <input ref={bindFileInput} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} />
      </div>

      <div className="flex flex-none flex-col gap-2.5 border-t border-rule bg-panel px-[18px] py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!source || busy}
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={() => setPlaying((p) => !p)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-rule bg-panel2 transition-colors hover:enabled:border-accent hover:enabled:bg-rulehi/30 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-ink">
              {isPlaying ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
            </svg>
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round((time / Math.max(1, settings.duration)) * 1000)}
            disabled={!source || busy}
            aria-label="Move through the video"
            onChange={(e) => {
              setPlaying(false);
              setTime((Number(e.target.value) / 1000) * settings.duration);
            }}
          />
          <span className="font-mono text-xs whitespace-nowrap text-muted tabular-nums">
            <b className="font-medium text-ink">{formatTimecode(time)}</b> /{" "}
            {formatTimecode(settings.duration)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pl-8 font-mono text-[11.5px] text-dim">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              status === "ready"
                ? "bg-ok shadow-[0_0_7px_rgba(74,222,128,.55)]"
                : status === "rendering"
                  ? "animate-pulse bg-rec"
                  : status === "error"
                    ? "bg-rec"
                    : "bg-dim"
            }`}
          />
          <span>{statusText}</span>
          <span>{statusMeta}</span>
        </div>
      </div>
    </div>
  );
}
