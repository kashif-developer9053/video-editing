"use client";

import { useEffect, useRef } from "react";
import { formatShort } from "@/engine/layout";
import { PLATFORMS, type MotionMode, type PlatformKey } from "@/engine/types";
import {
  useMusic,
  useSetMusic,
  useSetSetting,
  useSettingsValue,
  useSource,
} from "@/store/settings";
import {
  Check,
  ColorInput,
  Disclosure,
  Field,
  Hint,
  NumberInput,
  Range,
  Row,
  Select,
  TextInput,
} from "./controls";

/**
 * The mode list uses plainer names than the engine does, so "autopace"
 * appears as "Smart speed" without renaming it everywhere.
 */
const MODES: { key: MotionMode; name: string; blurb: string }[] = [
  {
    key: "slide",
    name: "One page at a time",
    blurb: "Shows a page, moves slowly down it, then goes to the next",
  },
  {
    key: "scroll",
    name: "Non-stop scroll",
    blurb: "All pages joined together, scrolling without stopping",
  },
  {
    key: "autopace",
    name: "Smart speed",
    blurb: "Scrolls slower on busy pages and faster on empty ones",
  },
  {
    key: "kenburns",
    name: "Slow zoom",
    blurb: "Shows each page while slowly zooming in",
  },
];

export function Rail({ disabled }: { disabled: boolean }) {
  const settings = useSettingsValue();
  const set = useSetSetting();
  const source = useSource();
  const music = useMusic();
  const setMusic = useSetMusic();
  const musicInput = useRef<HTMLInputElement>(null);

  // Native listener rather than onChange: React's synthetic change does not
  // reach these inputs reliably here.
  useEffect(() => {
    const el = musicInput.current;
    if (!el || el.dataset.bound === "1") return;
    el.dataset.bound = "1";
    el.addEventListener("change", () => setMusic(el.files?.[0] ?? null));
  }, [setMusic]);

  const maxPage = source?.documentPages ?? 1;
  const platform = PLATFORMS[settings.platform];
  const shape =
    platform.w < platform.h
      ? "tall, for phones"
      : platform.w === platform.h
        ? "square"
        : "wide, like a TV";

  return (
    <div className="flex flex-col gap-4">
      {/* ---- 1. Style ---- */}
      <section className="flex flex-col gap-4 rounded-xl border border-rule bg-panel p-4">
        <h2 className="text-sm font-semibold text-ink">1. Choose a style</h2>

        <div className="flex flex-col gap-2">
          {MODES.map((mode) => {
            const active = settings.mode === mode.key;
            return (
              <button
                key={mode.key}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => set("mode", mode.key)}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-40 ${
                  active
                    ? "border-accent bg-accent/10"
                    : "border-rule bg-panel2 hover:border-rulehi"
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                    active ? "border-accent" : "border-rulehi"
                  }`}
                >
                  {active ? <span className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-sm font-semibold ${active ? "text-accent" : "text-ink"}`}
                  >
                    {mode.name}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-dim">{mode.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>

        <Field
          label="How long the video is"
          hint={formatShort(settings.duration)}
          htmlFor="duration"
          help="Longer means each page stays on screen for more time."
        >
          <Range
            id="duration"
            value={settings.duration}
            min={10}
            max={1800}
            step={5}
            disabled={disabled}
            onChange={(v) => set("duration", v)}
          />
        </Field>
      </section>

      {/* ---- 2. Platform ---- */}
      <section className="flex flex-col gap-4 rounded-xl border border-rule bg-panel p-4">
        <h2 className="text-sm font-semibold text-ink">2. Where will you post it?</h2>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(Object.keys(PLATFORMS) as PlatformKey[]).map((key) => {
            const p = PLATFORMS[key];
            const active = settings.platform === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => set("platform", key)}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 transition-colors disabled:opacity-40 ${
                  active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-rule bg-panel2 text-muted hover:border-rulehi hover:text-ink"
                }`}
              >
                <span className="text-sm font-medium">{p.label}</span>
                <span className="font-mono text-[10px] opacity-70">{p.ratio}</span>
              </button>
            );
          })}
        </div>

        <Hint>
          {platform.label} videos are {platform.ratio} — {shape}.
        </Hint>
      </section>

      {/* ---- 3. Everything optional, folded away ---- */}
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-sm font-semibold text-ink">3. Optional extras</h2>

        <Disclosure title="Add music" summary={music ? music.name : "No music yet"}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => musicInput.current?.click()}
            className="flex min-h-12 items-center justify-center gap-2.5 rounded-lg border border-dashed border-rule bg-panel2 px-3 text-sm text-muted transition-colors hover:border-accent hover:text-ink disabled:opacity-40"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden
              className="h-4 w-4 shrink-0 fill-none stroke-current stroke-[1.6]"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            <span className="truncate">{music ? "Choose a different song" : "Choose a song"}</span>
          </button>
          <input ref={musicInput} type="file" accept="audio/*" className="sr-only" tabIndex={-1} />

          {music ? (
            <>
              <Field
                label="Music volume"
                hint={`${Math.round(settings.musicVolume * 100)}%`}
                htmlFor="volume"
              >
                <Range
                  id="volume"
                  value={Math.round(settings.musicVolume * 100)}
                  min={0}
                  max={100}
                  disabled={disabled}
                  onChange={(v) => set("musicVolume", v / 100)}
                />
              </Field>
              <Check
                id="fadeAudio"
                checked={settings.musicFade}
                disabled={disabled}
                onChange={(v) => set("musicFade", v)}
              >
                Fade in at the start and out at the end
              </Check>
              <Check
                id="loopAudio"
                checked={settings.musicLoop}
                disabled={disabled}
                onChange={(v) => set("musicLoop", v)}
              >
                Repeat the song if it is shorter than the video
              </Check>
            </>
          ) : null}

          <Hint>
            Only use music you are allowed to use. Songs you do not own can get your video blocked
            or muted.
          </Hint>
        </Disclosure>

        <Disclosure
          title="Add text and your name"
          summary={settings.title || settings.watermark || "Nothing added"}
        >
          <Field label="Title at the start" htmlFor="titleText">
            <TextInput
              id="titleText"
              value={settings.title}
              placeholder="Code 413 — Assignment 1"
              disabled={disabled}
              onChange={(v) => set("title", v)}
            />
          </Field>
          <Field label="Smaller line under the title" htmlFor="subtitleText">
            <TextInput
              id="subtitleText"
              value={settings.subtitle}
              placeholder="Spring 2026 · BA & AD"
              disabled={disabled}
              onChange={(v) => set("subtitle", v)}
            />
          </Field>
          <Field label="Message at the end" htmlFor="outroText">
            <TextInput
              id="outroText"
              value={settings.outro}
              placeholder="Subscribe for more solved assignments"
              disabled={disabled}
              onChange={(v) => set("outro", v)}
            />
          </Field>
          <Field label="Your name in the corner" htmlFor="watermark">
            <TextInput
              id="watermark"
              value={settings.watermark}
              placeholder="@YourChannelName"
              disabled={disabled}
              onChange={(v) => set("watermark", v)}
            />
          </Field>
          <ColorInput
            id="accentColor"
            label="Title colour"
            value={settings.accent}
            disabled={disabled}
            onChange={(v) => set("accent", v)}
          />
          <Check
            id="showCounter"
            checked={settings.showCounter}
            disabled={disabled}
            onChange={(v) => set("showCounter", v)}
          >
            Show page numbers
          </Check>
          <Check
            id="showBar"
            checked={settings.showProgressBar}
            disabled={disabled}
            onChange={(v) => set("showProgressBar", v)}
          >
            Show a progress bar
          </Check>
        </Disclosure>

        <Disclosure
          title="More settings"
          summary={`Pages ${settings.pageFrom}–${settings.pageTo} · ${settings.quality}p`}
        >
          <Row>
            <Field label="Start at page" htmlFor="pageFrom">
              <NumberInput
                id="pageFrom"
                value={settings.pageFrom}
                min={1}
                max={maxPage}
                disabled={disabled || !source}
                onChange={(v) => set("pageFrom", Math.max(1, Math.min(maxPage, v)))}
              />
            </Field>
            <Field label="End at page" htmlFor="pageTo">
              <NumberInput
                id="pageTo"
                value={settings.pageTo}
                min={1}
                max={maxPage}
                disabled={disabled || !source}
                onChange={(v) => set("pageTo", Math.max(settings.pageFrom, Math.min(maxPage, v)))}
              />
            </Field>
          </Row>

          <Field
            label="Picture quality"
            htmlFor="quality"
            help="Higher looks sharper but takes longer to make."
          >
            <Select
              id="quality"
              value={settings.quality}
              disabled={disabled}
              onChange={(v) => set("quality", Number(v) as typeof settings.quality)}
              options={[
                { value: 720, label: "Normal — fastest" },
                { value: 1080, label: "High" },
                { value: 1440, label: "Very high — slowest" },
              ]}
            />
          </Field>

          <Field label="Page size on screen" htmlFor="fit">
            <Select
              id="fit"
              value={settings.fit}
              disabled={disabled}
              onChange={(v) => set("fit", v as typeof settings.fit)}
              options={[
                { value: "width", label: "Big — fills the screen, moves down" },
                { value: "contain", label: "Small — whole page always visible" },
              ]}
            />
          </Field>

          {settings.mode === "slide" ? (
            <Field label="How pages change" htmlFor="transition">
              <Select
                id="transition"
                value={settings.transition}
                disabled={disabled}
                onChange={(v) => set("transition", v as typeof settings.transition)}
                options={[
                  { value: "fade", label: "Fade into each other" },
                  { value: "cut", label: "Change instantly" },
                  { value: "push", label: "Push upward" },
                  { value: "slide", label: "Slide sideways" },
                ]}
              />
            </Field>
          ) : null}

          <Field label="Smoothness" htmlFor="fps">
            <Select
              id="fps"
              value={settings.fps}
              disabled={disabled}
              onChange={(v) => set("fps", Number(v))}
              options={[
                { value: 24, label: "Normal — fastest" },
                { value: 30, label: "Smooth" },
                { value: 60, label: "Very smooth — slowest" },
              ]}
            />
          </Field>

          <ColorInput
            id="bgColor"
            label="Background colour"
            value={settings.background}
            disabled={disabled}
            onChange={(v) => set("background", v)}
          />

          <Field label="Space around the page" hint={`${settings.margin}%`} htmlFor="margin">
            <Range
              id="margin"
              value={settings.margin}
              min={0}
              max={20}
              disabled={disabled}
              onChange={(v) => set("margin", v)}
            />
          </Field>
        </Disclosure>
      </section>
    </div>
  );
}
