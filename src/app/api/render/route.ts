/**
 * POST /api/render — start a render.
 *
 * Takes the PDF, the optional music file and the settings as multipart form
 * data, kicks the render off in the background and returns a job id. The
 * client then polls /api/render/[id] for progress.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { DEFAULT_SETTINGS, type Settings } from "@/engine/types";
import { ffmpegAvailable } from "@/server/ffmpeg";
import { atCapacity, createJob, dropJob, ensureWorkDir, updateProgress } from "@/server/jobs";
import { renderVideo } from "@/server/render";

// The render uses native modules and a child process, so it cannot run on
// the edge runtime.
export const runtime = "nodejs";
export const maxDuration = 3600;

/** Caps, so one request cannot tie the machine up indefinitely. */
const LIMITS = {
  pdfBytes: 100 * 1024 * 1024,
  audioBytes: 50 * 1024 * 1024,
  durationSeconds: 3600,
  pages: 300,
};

export async function POST(request: Request) {
  if (!(await ffmpegAvailable())) {
    return NextResponse.json(
      {
        error:
          "The video tool (FFmpeg) is not installed. Install it, then restart the app.",
      },
      { status: 503 },
    );
  }

  if (atCapacity()) {
    return NextResponse.json(
      { error: "A video is already being made. Wait for it to finish, or stop it first." },
      { status: 429 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Could not read your file." }, { status: 400 });
  }

  const pdfFile = form.get("pdf");
  if (!(pdfFile instanceof File)) {
    return NextResponse.json({ error: "No PDF was chosen." }, { status: 400 });
  }
  if (pdfFile.size === 0) {
    return NextResponse.json({ error: "That PDF has nothing in it." }, { status: 400 });
  }
  if (pdfFile.size > LIMITS.pdfBytes) {
    return NextResponse.json(
      { error: `That PDF is larger than ${Math.round(LIMITS.pdfBytes / 1048576)} MB.` },
      { status: 413 },
    );
  }

  let settings: Settings;
  try {
    settings = parseSettings(form.get("settings"));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Those settings are not valid." },
      { status: 400 },
    );
  }

  // Music is written to disk because ffmpeg reads it as a second input.
  let audioPath: string | null = null;
  const audioFile = form.get("audio");
  if (audioFile instanceof File && audioFile.size > 0) {
    if (audioFile.size > LIMITS.audioBytes) {
      return NextResponse.json(
        { error: `That audio file is larger than ${Math.round(LIMITS.audioBytes / 1048576)} MB.` },
        { status: 413 },
      );
    }
    const dir = await ensureWorkDir();
    const ext = path.extname(audioFile.name) || ".mp3";
    audioPath = path.join(dir, `audio-${Date.now()}${ext}`);
    await fs.writeFile(audioPath, Buffer.from(await audioFile.arrayBuffer()));
  }

  const pdf = new Uint8Array(await pdfFile.arrayBuffer());
  const job = await createJob(settings, audioPath);

  // Fire and forget: the response returns immediately with the job id, and
  // progress is polled. An unhandled rejection here would take the server
  // down, so everything is caught.
  void renderVideo({
    pdf,
    settings,
    outputPath: job.outputPath,
    audioPath,
    signal: job.controller.signal,
    onProgress: (progress) => updateProgress(job.id, progress),
  })
    .then(async (result) => {
      const stat = await fs.stat(result.outputPath);
      job.result = {
        width: result.width,
        height: result.height,
        frames: result.frames,
        uniqueFrames: result.uniqueFrames,
        encoder: result.encoder,
        elapsedSeconds: result.elapsedSeconds,
        sizeBytes: stat.size,
      };
      updateProgress(job.id, {
        status: "done",
        progress: 1,
        framesDone: result.frames,
        framesTotal: result.frames,
        etaSeconds: 0,
        message: "Your video is ready",
      });
    })
    .catch(async (err: unknown) => {
      const cancelled =
        job.controller.signal.aborted ||
        (err instanceof Error && err.message.toLowerCase().includes("cancelled"));

      updateProgress(job.id, {
        status: cancelled ? "cancelled" : "failed",
        progress: job.progress.progress,
        framesDone: job.progress.framesDone,
        framesTotal: job.progress.framesTotal,
        etaSeconds: null,
        message: cancelled ? "Stopped" : "Something went wrong",
        error: cancelled ? undefined : describeError(err),
      });

      if (cancelled) await dropJob(job.id);
    });

  return NextResponse.json({ id: job.id, settings });
}

function parseSettings(raw: FormDataEntryValue | null): Settings {
  if (typeof raw !== "string") throw new Error("Some settings were missing.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Those settings are not valid.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Settings were not valid.");
  }

  const merged = { ...DEFAULT_SETTINGS, ...(parsed as Partial<Settings>) };

  if (!Number.isFinite(merged.duration) || merged.duration <= 0) {
    throw new Error("Please choose how long the video should be.");
  }
  if (merged.duration > LIMITS.durationSeconds) {
    throw new Error(`The video cannot be longer than ${LIMITS.durationSeconds / 60} minutes.`);
  }
  if (![24, 30, 60].includes(merged.fps)) {
    throw new Error("Frame rate must be 24, 30 or 60.");
  }
  if (![720, 1080, 1440].includes(merged.quality)) {
    throw new Error("Resolution must be 720, 1080 or 1440.");
  }
  if (merged.pageTo - merged.pageFrom + 1 > LIMITS.pages) {
    throw new Error(`You can render at most ${LIMITS.pages} pages at a time.`);
  }

  return merged;
}

/** Turn an ffmpeg or pdfjs failure into something a person can act on. */
function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/password/i.test(message)) return "That PDF is locked with a password.";
  if (/Invalid PDF|InvalidPDFException/i.test(message)) return "That file could not be opened as a PDF.";
  if (/ENOENT.*ffmpeg|ffmpeg.*ENOENT/i.test(message)) return "The video tool could not start.";
  if (/no pages/i.test(message)) return "No pages were selected.";
  return message.split("\n")[0].slice(0, 300);
}
