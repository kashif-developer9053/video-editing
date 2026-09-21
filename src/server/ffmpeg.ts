/**
 * FFmpeg process wrapper.
 *
 * Frames are piped in as raw RGBA over stdin rather than written to disk —
 * on a 2-core laptop the disk round trip costs more than the encode does.
 * The encoder is picked once at startup: Intel Quick Sync where the hardware
 * has it, libx264 everywhere else.
 */

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type EncoderName = "h264_qsv" | "h264_nvenc" | "h264_amf" | "libx264";

export interface EncoderInfo {
  name: EncoderName;
  hardware: boolean;
  label: string;
}

let cachedEncoder: EncoderInfo | null = null;

/**
 * Below this pixel count, software encoding wins.
 *
 * Measured on an i5-6300U with HD 520: at 1280x720 libx264 ultrafast beat
 * Quick Sync (1.4s vs 2.3s for 240 frames) because QSV pays a fixed setup
 * cost per run. At 1920x1080 that reverses (15.9s vs 17.8s for 1440 frames),
 * and QSV leaves the CPU almost idle — which matters more than the raw
 * number here, since compositing needs those cores.
 */
const HARDWARE_PIXEL_THRESHOLD = 1280 * 720 * 1.5;

/**
 * Probe once for a working hardware encoder.
 *
 * FFmpeg lists every encoder it was *built* with, which says nothing about
 * the hardware present — this machine's build advertises nvenc while having
 * Intel graphics. So each candidate is actually run against one generated
 * frame, and only a clean exit counts.
 */
export async function detectEncoder(): Promise<EncoderInfo> {
  if (cachedEncoder) return cachedEncoder;

  const candidates: { name: EncoderName; label: string }[] = [
    { name: "h264_qsv", label: "Intel Quick Sync" },
    { name: "h264_nvenc", label: "NVIDIA NVENC" },
    { name: "h264_amf", label: "AMD AMF" },
  ];

  for (const candidate of candidates) {
    if (await probeEncoder(candidate.name)) {
      cachedEncoder = { ...candidate, hardware: true };
      return cachedEncoder;
    }
  }

  cachedEncoder = { name: "libx264", hardware: false, label: "libx264 (CPU)" };
  return cachedEncoder;
}

/**
 * Pick the encoder for one job. Hardware only earns its setup cost on larger
 * frames, so small outputs deliberately fall back to software.
 */
export async function encoderFor(width: number, height: number): Promise<EncoderInfo> {
  const detected = await detectEncoder();
  if (detected.hardware && width * height < HARDWARE_PIXEL_THRESHOLD) {
    return { name: "libx264", hardware: false, label: "libx264 (CPU, faster at this size)" };
  }
  return detected;
}

async function probeEncoder(name: EncoderName): Promise<boolean> {
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel", "error",
        "-f", "lavfi",
        "-i", "color=c=black:s=256x256:d=0.1",
        "-c:v", name,
        "-f", "null",
        "-",
      ],
      { timeout: 15_000 },
    );
    return true;
  } catch {
    return false;
  }
}

export interface EncodeOptions {
  width: number;
  height: number;
  fps: number;
  outputPath: string;
  /** Optional audio file mixed in and cut to the video length. */
  audioPath?: string | null;
  audioVolume?: number;
  audioFade?: boolean;
  audioLoop?: boolean;
  durationSeconds: number;
  encoder: EncoderInfo;
}

export interface FrameSink {
  /** Push one raw RGBA frame. Resolves when the pipe accepts more. */
  write(frame: Uint8Array): Promise<void>;
  /** Close stdin and wait for the file to be written. */
  finish(): Promise<void>;
  /** Kill the process and give up on the output. */
  abort(): void;
}

export function startEncoder(opts: EncodeOptions): FrameSink {
  const args = buildArgs(opts);
  const proc = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });

  let stderr = "";
  proc.stderr.on("data", (chunk: Buffer) => {
    // Keep only the tail: a failing encode says why in its last few lines,
    // and a long run would otherwise hold megabytes of progress output.
    stderr = (stderr + chunk.toString()).slice(-4000);
  });

  let exited = false;
  let exitError: Error | null = null;
  const exitPromise = new Promise<void>((resolve) => {
    proc.on("close", (code) => {
      exited = true;
      if (code !== 0) {
        exitError = new Error(`ffmpeg exited with code ${code}\n${stderr}`);
      }
      resolve();
    });
    proc.on("error", (err) => {
      exited = true;
      exitError = err;
      resolve();
    });
  });

  return {
    write(frame: Uint8Array): Promise<void> {
      if (exited) return Promise.reject(exitError ?? new Error("ffmpeg closed early"));
      return new Promise((resolve, reject) => {
        // Respect backpressure: without this, a fast compositor buries the
        // encoder and memory climbs until the process dies.
        const ok = proc.stdin.write(frame, (err) => {
          if (err) reject(err);
          else if (ok) resolve();
        });
        if (!ok) proc.stdin.once("drain", () => resolve());
      });
    },

    async finish(): Promise<void> {
      if (!exited) proc.stdin.end();
      await exitPromise;
      if (exitError) throw exitError;
    },

    abort(): void {
      if (!exited) proc.kill("SIGKILL");
    },
  };
}

function buildArgs(opts: EncodeOptions): string[] {
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    // Raw video in on stdin.
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-s", `${opts.width}x${opts.height}`,
    "-r", String(opts.fps),
    "-i", "pipe:0",
  ];

  if (opts.audioPath) {
    if (opts.audioLoop) args.push("-stream_loop", "-1");
    args.push("-i", opts.audioPath);
  }

  args.push("-c:v", opts.encoder.name);

  if (opts.encoder.hardware) {
    // Hardware encoders take a quality target rather than a speed preset.
    args.push("-global_quality", "26", "-look_ahead", "0");
  } else {
    // For flat text, ultrafast is visually indistinguishable from medium
    // and several times quicker on a low-power CPU.
    args.push("-preset", "ultrafast", "-crf", "23");
  }

  args.push("-pix_fmt", "yuv420p", "-movflags", "+faststart");

  if (opts.audioPath) {
    const filters: string[] = [];
    const volume = opts.audioVolume ?? 0.6;
    filters.push(`volume=${volume.toFixed(3)}`);
    if (opts.audioFade) {
      const fadeOutStart = Math.max(0, opts.durationSeconds - 2.5);
      filters.push(`afade=t=in:st=0:d=1.5`);
      filters.push(`afade=t=out:st=${fadeOutStart.toFixed(2)}:d=2.5`);
    }
    args.push("-af", filters.join(","), "-c:a", "aac", "-b:a", "160k", "-shortest");
  }

  // Never let the output run past the intended length, whatever the audio does.
  args.push("-t", opts.durationSeconds.toFixed(3));
  args.push(opts.outputPath);

  return args;
}

/** Whether ffmpeg is on PATH at all — checked before accepting a job. */
export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
