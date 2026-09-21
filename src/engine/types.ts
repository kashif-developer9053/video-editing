/**
 * Shared types for the render engine.
 *
 * Nothing in engine/ imports React or touches the DOM beyond a canvas
 * context, so the same code runs in the browser, in a worker, and on the
 * server under node-canvas.
 */

export type MotionMode = "scroll" | "slide" | "kenburns" | "autopace";
export type Transition = "cut" | "fade" | "push" | "slide";
export type PageFit = "width" | "contain";

/** Aspect ratios we offer, keyed by the platform people actually name. */
export const PLATFORMS = {
  youtube: { label: "YouTube", ratio: "16:9", w: 16, h: 9 },
  shorts: { label: "Shorts", ratio: "9:16", w: 9, h: 16 },
  tiktok: { label: "TikTok", ratio: "9:16", w: 9, h: 16 },
  reels: { label: "Reels", ratio: "9:16", w: 9, h: 16 },
  facebook: { label: "Facebook", ratio: "1:1", w: 1, h: 1 },
  instagram: { label: "Instagram", ratio: "4:5", w: 4, h: 5 },
} as const;

export type PlatformKey = keyof typeof PLATFORMS;

export interface Settings {
  mode: MotionMode;
  platform: PlatformKey;
  /** Total video length in seconds, including intro and outro cards. */
  duration: number;
  fps: number;
  /** Long edge of the output frame: 720, 1080 or 1440. */
  quality: 720 | 1080 | 1440;
  fit: PageFit;
  /** Side margin as a percentage of frame width. */
  margin: number;
  background: string;
  accent: string;
  transition: Transition;
  ease: boolean;

  title: string;
  subtitle: string;
  outro: string;
  /** Seconds each title card holds. */
  cardSeconds: number;
  watermark: string;
  showCounter: boolean;
  showProgressBar: boolean;

  /** Audio is referenced by upload id; the engine never reads the file. */
  musicId: string | null;
  musicVolume: number;
  musicFade: boolean;
  musicLoop: boolean;

  pageFrom: number;
  pageTo: number;
}

export const DEFAULT_SETTINGS: Settings = {
  // Defaults chosen for render speed as much as for looks: slide mode lets
  // held frames be reused, and 720p/24 keeps a long PDF tolerable.
  mode: "slide",
  platform: "youtube",
  duration: 180,
  fps: 24,
  quality: 720,
  fit: "width",
  margin: 4,
  background: "#0F1115",
  accent: "#F0A830",
  transition: "fade",
  ease: true,

  title: "",
  subtitle: "",
  outro: "",
  cardSeconds: 3,
  watermark: "",
  showCounter: true,
  showProgressBar: true,

  musicId: null,
  musicVolume: 0.6,
  musicFade: true,
  musicLoop: true,

  pageFrom: 1,
  pageTo: 1,
};

/** One rasterized page, plus the text volume used by auto-pace. */
export interface RasterPage {
  /** 1-based page number in the source PDF. */
  num: number;
  width: number;
  height: number;
  /** Character count, from the PDF's text layer. */
  chars: number;
  /**
   * Share of the page covered by anything at all — text, images, tables
   * (0..1). Text characters alone cannot weight screen time: a full-page
   * photograph has no characters and would otherwise be rushed past.
   */
  coverage: number;
  /**
   * Where the page's content actually ends, as a fraction of its height
   * (0..1). A page with text only in the top third reports ~0.35, so panning
   * can stop there instead of drifting across blank paper.
   */
  contentBottom: number;
}

/** A page whose pixels are available to draw (browser or server side). */
export interface DrawablePage extends RasterPage {
  bitmap: CanvasImageSource;
}

export interface OutputSize {
  width: number;
  height: number;
}

/** Where one page sits on the virtual strip the camera moves down. */
export interface LayoutBox {
  page: DrawablePage;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  out: OutputSize;
  boxes: LayoutBox[];
  /** Full height of the strip, used to work out camera travel. */
  totalHeight: number;
  /** Side margin in pixels, derived from settings.margin. */
  pad: number;
}

/** Split of the timeline between the cards and the pages themselves. */
export interface CardTiming {
  intro: number;
  outro: number;
  body: number;
}

export type JobStatus =
  | "queued"
  | "rasterizing"
  | "rendering"
  | "encoding"
  | "done"
  | "failed"
  | "cancelled";

export interface JobProgress {
  status: JobStatus;
  /** 0..1 across the whole job. */
  progress: number;
  /** Frames drawn so far, for the measured time estimate. */
  framesDone: number;
  framesTotal: number;
  /** Seconds remaining, measured from real frame times — null until known. */
  etaSeconds: number | null;
  message: string;
  error?: string;
}
