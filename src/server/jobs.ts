/**
 * In-process job registry.
 *
 * Deliberately simple: a Map, a temp directory, and a sweeper. There is no
 * Redis and no worker process, because the app currently serves one person
 * on localhost. The shape here is the shape a real queue would expose, so
 * swapping BullMQ in later is a change of implementation rather than of
 * callers.
 *
 * Videos are never kept: each job's file is deleted once it has been
 * downloaded, and anything left behind is swept on a timer.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { JobProgress, Settings } from "@/engine/types";

/** How long a finished video survives if nobody downloads it. */
const JOB_TTL_MS = 30 * 60 * 1000;
/** How often to sweep for expired jobs. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
/** One render at a time: two concurrent encodes on two cores helps nobody. */
const MAX_ACTIVE = 1;

export interface Job {
  id: string;
  progress: JobProgress;
  settings: Settings;
  outputPath: string;
  audioPath: string | null;
  createdAt: number;
  finishedAt: number | null;
  controller: AbortController;
  /** Set once the file has been served, so the sweeper can drop it. */
  downloaded: boolean;
  result: {
    width: number;
    height: number;
    frames: number;
    uniqueFrames: number;
    encoder: string;
    elapsedSeconds: number;
    sizeBytes: number;
  } | null;
}

const jobs = new Map<string, Job>();
let sweeper: NodeJS.Timeout | null = null;

export function workDir(): string {
  return path.join(os.tmpdir(), "scrollcast");
}

export async function ensureWorkDir(): Promise<string> {
  const dir = workDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function activeCount(): number {
  let n = 0;
  for (const job of jobs.values()) {
    const s = job.progress.status;
    if (s === "queued" || s === "rasterizing" || s === "rendering" || s === "encoding") n++;
  }
  return n;
}

export function atCapacity(): boolean {
  return activeCount() >= MAX_ACTIVE;
}

export async function createJob(settings: Settings, audioPath: string | null): Promise<Job> {
  const dir = await ensureWorkDir();
  const id = randomUUID();

  const job: Job = {
    id,
    settings,
    audioPath,
    outputPath: path.join(dir, `${id}.mp4`),
    createdAt: Date.now(),
    finishedAt: null,
    controller: new AbortController(),
    downloaded: false,
    result: null,
    progress: {
      status: "queued",
      progress: 0,
      framesDone: 0,
      framesTotal: Math.round(settings.duration * settings.fps),
      etaSeconds: null,
      message: "Waiting to start",
    },
  };

  jobs.set(id, job);
  startSweeper();
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function updateProgress(id: string, progress: JobProgress): void {
  const job = jobs.get(id);
  if (!job) return;
  job.progress = progress;
  if (progress.status === "done" || progress.status === "failed" || progress.status === "cancelled") {
    job.finishedAt = Date.now();
  }
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  job.controller.abort();
  job.progress = { ...job.progress, status: "cancelled", message: "Stopped" };
  job.finishedAt = Date.now();
  return true;
}

/** Remove a job and its files. Safe to call more than once. */
export async function dropJob(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);

  await Promise.allSettled([
    fs.rm(job.outputPath, { force: true }),
    job.audioPath ? fs.rm(job.audioPath, { force: true }) : Promise.resolve(),
  ]);
}

function startSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const job of [...jobs.values()]) {
      const finished = job.finishedAt !== null;
      const expired = finished && now - job.finishedAt! > JOB_TTL_MS;
      // A downloaded file has done its job; an abandoned one ages out.
      if (job.downloaded || expired) void dropJob(job.id);
    }
    if (jobs.size === 0 && sweeper) {
      clearInterval(sweeper);
      sweeper = null;
    }
  }, SWEEP_INTERVAL_MS);

  // Do not hold the process open just to sweep an empty map.
  sweeper.unref?.();
}
