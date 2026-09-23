"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTimecode } from "@/engine/layout";
import { useMusic, useSetTime, useSettingsValue, useSource, useTime } from "@/store/settings";

export type StageStatus = "idle" | "loading" | "ready" | "rendering" | "error";

export function Stage({
  status,
  statusText,
  statusMeta,
  progress,
  onFile,
}: {
  status: StageStatus;
  statusText: string;
  statusMeta: string;
  /** How far a render has got, 0..1. Ignored unless status is "rendering". */
  progress?: number;
  onFile: (file: File) => void;
}) {
  const settings = useSettingsValue();
  const source = useSource();
  const music = useMusic();
  const time = useTime();
  const setTime = useSetTime();
  const audio = useRef<HTMLAudioElement | null>(null);
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
    // Each step is a server-rendered frame, so this is deliberately coarse:
    // it shows the pacing, not smooth motion. Anything faster turns playback
    // into a request per tick.
    const STEP_MS = 1000;
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

  // The chosen song, playable in the browser. The preview itself is a
  // sequence of stills rendered on the server, so without this "play" showed
  // the pictures in silence and the music only existed in the final file.
  const musicUrl = useMemo(() => (music ? URL.createObjectURL(music) : null), [music]);
  useEffect(() => {
    return () => {
      if (musicUrl) URL.revokeObjectURL(musicUrl);
    };
  }, [musicUrl]);

  // Keep the song in step with the transport: the preview clock is the
  // scrubber, not the audio element.
  useEffect(() => {
    const el = audio.current;
    if (!el || !musicUrl) return;

    el.volume = Math.max(0, Math.min(1, settings.musicVolume));

    if (!isPlaying) {
      el.pause();
      return;
    }

    // Music starts when the pages do, after any opening card.
    const cardLead = settings.title ? settings.cardSeconds : 0;
    const into = time - cardLead;
    if (into < 0) {
      el.pause();
      return;
    }

    // Loop by hand: the track is usually shorter than the video.
    const wanted = settings.musicLoop && el.duration > 0 ? into % el.duration : into;
    if (wanted > (el.duration || Infinity)) {
      el.pause();
      return;
    }
    // Only correct when it has genuinely drifted, or playback stutters.
    if (Math.abs(el.currentTime - wanted) > 0.7) el.currentTime = wanted;
    if (el.paused) void el.play().catch(() => {});
  }, [isPlaying, time, musicUrl, settings.musicVolume, settings.musicLoop, settings.title, settings.cardSeconds]);

  // Each new frame revokes the one it replaces, so blob URLs do not pile up.
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

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onFileRef.current(file);
  }, []);

  return (
    <div className={`flex flex-col gap-3 ${source ? "lg:h-full lg:min-h-0" : ""}`}>
      <div
        className={`relative flex items-center justify-center overflow-hidden rounded-xl border border-rule bg-stage p-3 ${
          source
            ? "min-h-[220px] sm:min-h-[340px] lg:min-h-0 lg:flex-1"
            : "aspect-[4/3] sm:aspect-[16/10]"
        }`}
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
          // object-contain keeps the whole frame visible whatever the aspect
          // ratio, so switching to a tall format does not crop the preview.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={`What the video looks like at ${formatTimecode(time)}`}
            className="max-h-full max-w-full rounded-md object-contain shadow-[0_18px_50px_rgba(0,0,0,.6)]"
          />
        ) : null}

        {status === "rendering" ? (
          <div className="absolute inset-x-3 bottom-3 flex flex-col gap-2 rounded-lg bg-ground/85 p-3 backdrop-blur">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-ink">{statusText}</span>
              <span className="font-mono text-base font-semibold text-accent tabular-nums">
                {Math.round((progress ?? 0) * 100)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-rule">
              <span
                className="block h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${Math.max(2, Math.round((progress ?? 0) * 100))}%` }}
              />
            </div>
            {statusMeta ? <span className="text-xs text-dim">{statusMeta}</span> : null}
          </div>
        ) : null}

        {status === "loading" && !preview ? (
          <div className="absolute inset-3 flex flex-col items-center justify-center gap-3 rounded-lg bg-stage/80 text-center">
            <span
              aria-hidden
              className="h-8 w-8 animate-spin rounded-full border-2 border-rule border-t-accent"
            />
            <span className="text-sm font-medium text-ink">{statusText}</span>
            {statusMeta ? <span className="text-xs text-muted">{statusMeta}</span> : null}
            <span className="max-w-[32ch] text-xs text-dim">
              Long documents take a moment. Nothing is uploaded — this is happening on the server
              that hosts the site.
            </span>
          </div>
        ) : null}

        {!source && status !== "loading" ? (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className={`absolute inset-3 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-5 text-center transition-colors ${
              dragging ? "border-accent bg-accent/5" : "border-rule hover:border-rulehi"
            }`}
          >
            <span className="grid h-14 w-14 place-items-center rounded-full bg-accent/10">
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className="h-7 w-7 fill-none stroke-accent stroke-[1.5]"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M12 18v-6" />
                <path d="m9 15 3-3 3 3" />
              </svg>
            </span>
            <span className="text-lg font-semibold text-ink">Choose your PDF</span>
            <span className="max-w-[34ch] text-sm text-muted">
              Tap to pick a file, or drag one here.
            </span>
          </button>
        ) : null}

        {/* Change is handled by a native listener above, not onChange. */}
        <input
          ref={bindFileInput}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          tabIndex={-1}
        />

        {/* Driven by the effect above; never shows its own controls. */}
        {musicUrl ? <audio ref={audio} src={musicUrl} preload="auto" className="sr-only" /> : null}
      </div>

      {source ? (
        <div className="flex flex-col gap-2 rounded-xl border border-rule bg-panel px-3 py-2.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              aria-label={isPlaying ? "Pause" : "Play"}
              onClick={() => setPlaying((p) => !p)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-rule bg-panel2 transition-colors hover:enabled:border-accent disabled:cursor-not-allowed disabled:opacity-35"
            >
              <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 fill-ink">
                {isPlaying ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
              </svg>
            </button>
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round((time / Math.max(1, settings.duration)) * 1000)}
              disabled={busy}
              aria-label="Move through the video"
              onChange={(e) => {
                setPlaying(false);
                setTime((Number(e.target.value) / 1000) * settings.duration);
              }}
            />
            <span className="font-mono text-xs whitespace-nowrap text-muted tabular-nums">
              {formatTimecode(time)} / {formatTimecode(settings.duration)}
            </span>
          </div>

          {music ? (
            <p className="flex items-center gap-1.5 text-xs text-dim">
              <svg viewBox="0 0 24 24" aria-hidden className="h-3 w-3 shrink-0 fill-none stroke-current stroke-[1.8]" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
              Press play to hear {music.name} with it
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${
                status === "ready"
                  ? "bg-ok"
                  : status === "rendering"
                    ? "animate-pulse bg-rec"
                    : status === "error"
                      ? "bg-rec"
                      : "bg-dim"
              }`}
            />
            <span>{statusText}</span>
            {statusMeta ? <span className="text-muted">{statusMeta}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
