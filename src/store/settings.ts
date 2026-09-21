"use client";

import { create } from "zustand";
import { DEFAULT_SETTINGS, type Settings } from "@/engine/types";

export interface SourceInfo {
  file: File;
  name: string;
  /** Pages in the document, as reported by the first preview. */
  documentPages: number;
}

export interface RenderStats {
  frames: number;
  uniqueFrames: number;
  /** Rough seconds, replaced by measured numbers once a render starts. */
  predictedSeconds: number;
  encoder: string;
}

interface State {
  settings: Settings;
  source: SourceInfo | null;
  music: File | null;
  /** Server-side cache key for the rasterized pages. */
  previewKey: string | null;
  stats: RenderStats | null;
  /** Current position of the preview scrubber, in seconds. */
  time: number;

  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  patch: (values: Partial<Settings>) => void;
  setSource: (source: SourceInfo | null) => void;
  setMusic: (file: File | null) => void;
  setPreviewKey: (key: string | null) => void;
  setStats: (stats: RenderStats | null) => void;
  setTime: (time: number | ((current: number) => number)) => void;
}

/**
 * Zustand v5 removed the implicit shallow comparison, so calling the hook
 * with no selector hands back a new object every render and the component
 * never re-renders on a change. Every consumer selects the one field it
 * needs — the hooks below exist so that is the easy thing to do.
 */
export const useSettingsStore = create<State>((set) => ({
  settings: DEFAULT_SETTINGS,
  source: null,
  music: null,
  previewKey: null,
  stats: null,
  time: 0,

  set: (key, value) =>
    set((state) => ({ settings: { ...state.settings, [key]: value } })),

  patch: (values) => set((state) => ({ settings: { ...state.settings, ...values } })),

  setSource: (source) =>
    set((state) => {
      if (!source) {
        return { source: null, previewKey: null, stats: null, time: 0 };
      }
      // A new document invalidates the page range and the cached raster.
      const duration = suggestDuration(source.documentPages);
      return {
        source,
        previewKey: null,
        stats: null,
        // Open at the very start, showing the top of page one. Jumping a few
        // seconds in lands mid-pan, so the first thing someone sees is a page
        // already half scrolled — which reads as broken rather than as a
        // preview of the middle.
        time: 0,
        settings: {
          ...state.settings,
          pageFrom: 1,
          pageTo: source.documentPages,
          duration,
        },
      };
    }),

  setMusic: (music) => set({ music }),
  setPreviewKey: (previewKey) => set({ previewKey }),
  setStats: (stats) => set({ stats }),
  setTime: (time) =>
    set((state) => ({ time: typeof time === "function" ? time(state.time) : time })),
}));

/* Field selectors. Each subscribes to one slice, so a change to the preview
   time does not re-render the whole settings rail. */
export const useSettingsValue = () => useSettingsStore((s) => s.settings);
export const useSource = () => useSettingsStore((s) => s.source);
export const useMusic = () => useSettingsStore((s) => s.music);
export const usePreviewKey = () => useSettingsStore((s) => s.previewKey);
export const useStats = () => useSettingsStore((s) => s.stats);
export const useTime = () => useSettingsStore((s) => s.time);

/* Actions are stable references, so selecting them causes no re-renders. */
export const useSetSetting = () => useSettingsStore((s) => s.set);
export const useSetSource = () => useSettingsStore((s) => s.setSource);
export const useSetMusic = () => useSettingsStore((s) => s.setMusic);
export const useSetPreviewKey = () => useSettingsStore((s) => s.setPreviewKey);
export const useSetStats = () => useSettingsStore((s) => s.setStats);
export const useSetTime = () => useSettingsStore((s) => s.setTime);

/**
 * About six seconds a page: long enough to read a heading and the first
 * lines, short enough that a 50-page assignment does not become a
 * ten-minute video nobody waits for.
 */
export function suggestDuration(pages: number): number {
  const guess = Math.min(1800, Math.max(15, pages * 6));
  return Math.round(guess / 5) * 5;
}
