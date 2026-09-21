# Scrollcast

Turn a PDF into a video — scrolling, sliding, or slowly zooming — with music,
platform aspect ratios and title cards.

Rendering happens on the machine running the server, using native FFmpeg. The
finished file is deleted as soon as it has been downloaded.

## Running it

You need [Node](https://nodejs.org) 20+ and FFmpeg on your PATH.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

Check FFmpeg is visible first — `ffmpeg -version` should print something. On
Windows, `winget install ffmpeg`; on macOS, `brew install ffmpeg`; on Debian or
Ubuntu, `sudo apt install ffmpeg`.

The app only works while the server is running, because that is where FFmpeg
lives. To use it from your phone on the same network, open the Network address
that `npm run dev` prints and add that IP to `allowedDevOrigins` in
`next.config.ts`.

## The four motion modes

| Mode | What it does | Speed |
| --- | --- | --- |
| **Slide** | Holds each page, pans down it, then moves on | Fastest — held frames are reused |
| **Continuous** | One long strip, scrolling without stopping | Slowest — every frame differs |
| **Slow zoom** | Holds each page with a gentle drift | Slow |
| **Auto pace** | Scrolls, but lingers on pages with more text | Slow |

Slide is the default because it is both the fastest to render and the easiest
to read.

## Why it is quick

The renderer avoids drawing frames it has already drawn. In slide mode a page
sits still for seconds, so those frames are identical and the encoder is handed
the same buffer again — typically 45–75% of frames in a slide video.

Two settings cost the most:

- **Continuous and slow-zoom modes** move every frame, so nothing is reusable.
- **The progress bar** advances constantly. It is quantised to 4-pixel steps,
  which keeps most of the reuse; without that it alone would drop slide-mode
  reuse from about 75% to 8%.

The encoder is picked per job. Hardware encoding (Quick Sync, NVENC, AMF) is
used at 1080p and above, where it wins; at 720p `libx264 -preset ultrafast` is
actually faster because hardware encoders pay a fixed setup cost.

## Layout

```
src/
  engine/      pure TypeScript — no React, no DOM beyond a canvas context
    compositor.ts   drawFrame(): the single source of truth for the picture
    layout.ts       page layout, timing, per-page weights
    framekey.ts     frame-reuse cache keys
    estimate.ts     measured time estimates
    types.ts        Settings and the shared shapes
  server/      Node-only: rasterizing, FFmpeg, job registry
  app/api/     render, progress, download, preview
  components/  the studio UI
```

The engine deliberately knows nothing about React or Next. The same
`drawFrame` runs in the API route today and could run in a browser worker or on
a different machine without changes.

## Scripts

```bash
npm run dev                      # start the studio
node scripts/make-test-pdf.js    # write a 6-page test PDF
npx tsx scripts/test-render.mjs slide 20   # render without the UI
npx tsx scripts/debug-reuse.mjs  # frame reuse per mode and setting
node scripts/e2e.mjs             # drive the whole flow in a browser
```

`scripts/test-render.mjs` takes a mode (`slide`, `scroll`, `kenburns`,
`autopace`) and a duration in seconds, and writes `test-out-<mode>.mp4`.

## Limits

Set in `src/app/api/render/route.ts`: 100 MB PDF, 50 MB audio, 60 minutes,
300 pages, one render at a time. The single-render limit exists because a
second concurrent encode on a low-core machine makes both slower.

There is no queue. `src/server/jobs.ts` is a Map with a sweeper, shaped like
the interface a real queue would expose, so BullMQ can replace it without
touching the callers.

## Deploying

This needs a Node server with FFmpeg installed — not a static host. Copy the
project to the machine, install FFmpeg, then:

```bash
npm ci
npm run build
npm start
```

Video encoding is CPU-bound and does not share well: each render occupies a
core for its duration. Before putting it in front of strangers, add a job
queue, per-IP rate limiting, and tighter caps than the defaults above.
