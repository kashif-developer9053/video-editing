/**
 * GET /api/render/[id]/download — stream the finished video.
 *
 * The file is marked for deletion as soon as it has been served: nothing is
 * stored, which is the whole point of the design. The sweeper in jobs.ts
 * does the actual removal so a failed transfer can be retried within the
 * job's lifetime.
 */

import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getJob } from "@/server/jobs";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = getJob(id);

  if (!job) {
    return NextResponse.json({ error: "That video is no longer available." }, { status: 404 });
  }
  if (job.progress.status !== "done") {
    return NextResponse.json({ error: "That video is not finished yet." }, { status: 409 });
  }

  let size: number;
  try {
    const stat = await fs.stat(job.outputPath);
    size = stat.size;
  } catch {
    return NextResponse.json({ error: "That video file is no longer on this computer." }, { status: 410 });
  }

  const stream = Readable.toWeb(createReadStream(job.outputPath)) as ReadableStream<Uint8Array>;

  // Let the sweeper reclaim the file now that it has been handed over.
  job.downloaded = true;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${downloadName(job.settings.title, job.settings.platform)}"`,
      "Cache-Control": "no-store",
    },
  });
}

function downloadName(title: string, platform: string): string {
  const base =
    title
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase() || "scrollcast";
  return `${base}-${platform}.mp4`;
}
