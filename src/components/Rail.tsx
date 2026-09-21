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
  Field,
  Group,
  Hint,
  NumberInput,
  Range,
  Row,
  Select,
  TextInput,
} from "./controls";

const MODES: { key: MotionMode; name: string; blurb: string; art: React.ReactNode }[] = [
  {
    key: "slide",
    name: "One page at a time",
    blurb: "Shows a page, moves slowly down it, then goes to the next",
    art: (
      <>
        <rect x="3" y="3" width="24" height="16" rx="2" />
        <rect x="33" y="3" width="24" height="16" rx="2" />
      </>
    ),
  },
  {
    key: "scroll",
    name: "Non-stop scroll",
    blurb: "All pages joined together, scrolling down without stopping",
    art: (
      <>
        <path d="M8 4h44M8 11h44M8 18h30" />
        <path d="M4 2v18" strokeDasharray="2 3" />
      </>
    ),
  },
  {
    key: "kenburns",
    name: "Slow zoom",
    blurb: "Shows each page while slowly zooming in",
    art: (
      <>
        <rect x="3" y="3" width="54" height="16" rx="2" />
        <rect x="18" y="7" width="24" height="9" rx="1" strokeDasharray="3 2" />
      </>
    ),
  },
  {
    key: "autopace",
    name: "Smart speed",
    blurb: "Scrolls slower on busy pages and faster on empty ones",
    art: (
      <>
        <path d="M8 5h44M8 11h30M8 17h44" />
        <circle cx="52" cy="11" r="2.5" />
      </>
    ),
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
    if (!el) return;
    const handler = () => {
      setMusic(el.files?.[0] ?? null);
      el.value = "";
    };
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, [setMusic]);

  const maxPage = source?.documentPages ?? 1;

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto border-l border-rule bg-panel">
      <Group title="Your PDF">
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
      </Group>

      <Group title="How it moves">
        <div className="grid grid-cols-2 gap-2">
          {MODES.map((mode) => {
            const active = settings.mode === mode.key;
            return (
              <button
                key={mode.key}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => set("mode", mode.key)}
                className={`flex flex-col gap-1.5 rounded-[5px] border p-2.5 text-left transition-colors disabled:opacity-40 ${
                  active
                    ? "border-accent bg-accent/10"
                    : "border-rule bg-panel2 hover:border-rulehi"
                }`}
              >
                <svg
                  viewBox="0 0 60 22"
                  className={`h-[22px] w-full fill-none stroke-[1.5] ${active ? "stroke-accent" : "stroke-muted"}`}
                  strokeLinecap="round"
                >
                  {mode.art}
                </svg>
                <strong className={`text-xs font-semibold ${active ? "text-accent" : ""}`}>
                  {mode.name}
                </strong>
                <span className="text-[10.5px] leading-snug text-dim">{mode.blurb}</span>
              </button>
            );
          })}
        </div>

        <Field label="How long the video is" hint={formatShort(settings.duration)} htmlFor="duration">
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

        {settings.mode === "slide" && (
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
        )}

        {(settings.mode === "scroll" || settings.mode === "autopace") && (
          <Check
            id="easeEnds"
            checked={settings.ease}
            disabled={disabled}
            onChange={(v) => set("ease", v)}
          >
            Start and finish gently
          </Check>
        )}
      </Group>

      <Group title="Video size">
        <Field label="Where will you post it?">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(PLATFORMS) as PlatformKey[]).map((key) => {
              const platform = PLATFORMS[key];
              const active = settings.platform === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => set("platform", key)}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors disabled:opacity-40 ${
                    active
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-rule bg-panel2 text-muted hover:border-rulehi hover:text-ink"
                  }`}
                >
                  {platform.label}
                  <i className={`font-mono text-[9.5px] not-italic ${active ? "opacity-70" : "text-dim"}`}>
                    {platform.ratio}
                  </i>
                </button>
              );
            })}
          </div>
        </Field>

        <Row>
          <Field label="Picture quality" htmlFor="quality">
            <Select
              id="quality"
              value={settings.quality}
              disabled={disabled}
              onChange={(v) => set("quality", Number(v) as typeof settings.quality)}
              options={[
                { value: 720, label: "Normal (720p) — fastest" },
                { value: 1080, label: "High (1080p)" },
                { value: 1440, label: "Very high (1440p) — slowest" },
              ]}
            />
          </Field>
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
        </Row>

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

        <Row>
          <Field label="Background colour" htmlFor="bgColor">
            <ColorInput
              id="bgColor"
              value={settings.background}
              disabled={disabled}
              onChange={(v) => set("background", v)}
            />
          </Field>
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
        </Row>
      </Group>

      <Group title="Music">
        <button
          type="button"
          disabled={disabled}
          onClick={() => musicInput.current?.click()}
          className="flex items-center gap-2.5 rounded border border-dashed border-rule bg-panel2 p-2.5 text-xs text-muted transition-colors hover:border-accent hover:text-ink disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="h-[15px] w-[15px] shrink-0 fill-none stroke-current stroke-[1.6]" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          <span className="truncate">{music ? music.name : "Add music (optional)"}</span>
        </button>
        {/* Change is bound natively: see the note in Stage. */}
        <input ref={musicInput} type="file" accept="audio/*" className="sr-only" tabIndex={-1} />

        {music && (
          <>
            <Field label="Music volume" hint={`${Math.round(settings.musicVolume * 100)}%`} htmlFor="volume">
              <Range
                id="volume"
                value={Math.round(settings.musicVolume * 100)}
                min={0}
                max={100}
                disabled={disabled}
                onChange={(v) => set("musicVolume", v / 100)}
              />
            </Field>
            <Check id="fadeAudio" checked={settings.musicFade} disabled={disabled} onChange={(v) => set("musicFade", v)}>
              Fade music in at the start and out at the end
            </Check>
            <Check id="loopAudio" checked={settings.musicLoop} disabled={disabled} onChange={(v) => set("musicLoop", v)}>
              Repeat the music if it is shorter than the video
            </Check>
          </>
        )}

        <Hint>
          Only use music you are allowed to use. Songs you do not own can get your video blocked or muted.
        </Hint>
      </Group>

      <Group title="Text and logo">
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

        <Row>
          <Field label="How long the title shows" hint={`${settings.cardSeconds.toFixed(1)}s`} htmlFor="cardSecs">
            <Range
              id="cardSecs"
              value={settings.cardSeconds}
              min={1}
              max={8}
              step={0.5}
              disabled={disabled}
              onChange={(v) => set("cardSeconds", v)}
            />
          </Field>
          <Field label="Title text colour" htmlFor="accentColor">
            <ColorInput
              id="accentColor"
              value={settings.accent}
              disabled={disabled}
              onChange={(v) => set("accent", v)}
            />
          </Field>
        </Row>

        <Field label="Your name in the corner" htmlFor="watermark">
          <TextInput
            id="watermark"
            value={settings.watermark}
            placeholder="@YourChannelName"
            disabled={disabled}
            onChange={(v) => set("watermark", v)}
          />
        </Field>

        <Check id="showCounter" checked={settings.showCounter} disabled={disabled} onChange={(v) => set("showCounter", v)}>
          Show page numbers (like &ldquo;Page 3 / 10&rdquo;)
        </Check>
        <Check
          id="showBar"
          checked={settings.showProgressBar}
          disabled={disabled}
          onChange={(v) => set("showProgressBar", v)}
        >
          Show a progress bar at the bottom
        </Check>
      </Group>
    </div>
  );
}
