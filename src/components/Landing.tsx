"use client";

/**
 * What someone sees before they have chosen a file.
 *
 * It does two jobs: explain in a few seconds what this makes, and give
 * search engines real text to read. Everything here is replaced by the
 * editor the moment a PDF is loaded, so it stays out of the way afterwards.
 */

import { PLATFORMS, type PlatformKey } from "@/engine/types";

const STEPS = [
  {
    title: "Add your PDF",
    body: "Notes, an assignment, a report, a menu — anything with pages.",
  },
  {
    title: "Pick how it moves",
    body: "Scroll smoothly through every page, or show one page at a time.",
  },
  {
    title: "Save the video",
    body: "An MP4 ready to upload, sized for wherever you are posting it.",
  },
];

const POINTS = [
  {
    title: "Nothing is uploaded",
    body: "Your PDF is turned into a video on this computer. It never goes to a server, and the video is removed once you save it.",
    icon: (
      <>
        <path d="M12 3 4 6v6c0 4.4 3.4 8.4 8 9 4.6-.6 8-4.6 8-9V6z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  },
  {
    title: "Made for every platform",
    body: "Wide for YouTube, tall for Shorts, TikTok and Reels, square for Facebook. Switch and the preview changes with it.",
    icon: (
      <>
        <rect x="2" y="6" width="13" height="12" rx="2" />
        <path d="M18 8v8" />
        <path d="M21 10v4" />
      </>
    ),
  },
  {
    title: "Your name on it",
    body: "Add a title card, a closing message, background music and your channel name in the corner.",
    icon: (
      <>
        <path d="M4 7V4h16v3" />
        <path d="M9 20h6" />
        <path d="M12 4v16" />
      </>
    ),
  },
  {
    title: "Free, with no sign-up",
    body: "No account, no watermark you did not ask for, and no limit on how many videos you make.",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3 2.4V14" />
        <path d="M12 17.5v.01" />
      </>
    ),
  },
];

const QUESTIONS = [
  {
    q: "Is my PDF safe?",
    a: "It never leaves your computer. The video is made here and deleted after you save it.",
  },
  {
    q: "How long does it take?",
    a: "Usually a minute or two. Longer videos and higher quality take more time, and the app tells you roughly how long before you start.",
  },
  {
    q: "What do I get?",
    a: "An MP4 file, which is what YouTube, TikTok, Instagram and Facebook all accept.",
  },
  {
    q: "Can I add music?",
    a: "Yes — choose a song from your device. Only use music you are allowed to use, or your video can be muted.",
  },
];

export function Landing() {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
          Free · No sign-up · Nothing uploaded
        </span>
        <h2 className="max-w-[20ch] font-display text-4xl leading-[1.05] font-bold tracking-tight text-balance uppercase sm:text-5xl">
          Turn a PDF into a <span className="text-accent">video</span>
        </h2>
        <p className="max-w-[52ch] text-base leading-relaxed text-muted">
          Drop in your notes or assignment and get a video that scrolls through every page —
          ready for YouTube, Shorts, TikTok, Reels, Instagram or Facebook.
        </p>

        <ol className="mt-2 flex flex-col gap-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">{step.title}</span>
                <span className="mt-0.5 block text-sm text-muted">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-ink">Sizes for every platform</h3>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PLATFORMS) as PlatformKey[]).map((key) => (
            <span
              key={key}
              className="flex items-center gap-2 rounded-full border border-rule bg-panel px-3 py-1.5 text-xs text-muted"
            >
              {PLATFORMS[key].label}
              <span className="font-mono text-[10px] text-dim">{PLATFORMS[key].ratio}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {POINTS.map((point) => (
          <div key={point.title} className="flex flex-col gap-2 rounded-xl border border-rule bg-panel p-4">
            <svg
              viewBox="0 0 24 24"
              aria-hidden
              className="h-5 w-5 fill-none stroke-accent stroke-[1.5]"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {point.icon}
            </svg>
            <h3 className="text-sm font-semibold text-ink">{point.title}</h3>
            <p className="text-sm leading-relaxed text-muted">{point.body}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-ink">Questions</h3>
        <dl className="flex flex-col gap-3">
          {QUESTIONS.map((item) => (
            <div key={item.q} className="rounded-xl border border-rule bg-panel p-4">
              <dt className="text-sm font-semibold text-ink">{item.q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
