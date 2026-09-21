/**
 * GET    /api/render/[id] — poll progress
 * DELETE /api/render/[id] — cancel a running render
 */

import { NextResponse } from "next/server";
import { cancelJob, dropJob, getJob } from "@/server/jobs";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = getJob(id);

  if (!job) {
    // Either it never existed or it has been swept; the client treats both
    // the same way, so there is nothing to distinguish.
    return NextResponse.json({ error: "That video is no longer available." }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    ...job.progress,
    result: job.result,
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "That video is no longer available." }, { status: 404 });
  }

  const running =
    job.progress.status === "queued" ||
    job.progress.status === "rasterizing" ||
    job.progress.status === "rendering" ||
    job.progress.status === "encoding";

  if (running) {
    cancelJob(id);
  } else {
    await dropJob(id);
  }

  return NextResponse.json({ ok: true });
}
