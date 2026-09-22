/**
 * GET /api/preview/progress?key=... — how far along opening a PDF is.
 *
 * Polled by the browser while the preview request is still running, so a
 * long document can show "Reading page 12 of 100" instead of nothing.
 */

import { NextResponse } from "next/server";
import { readProgress } from "@/server/progress";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "No key given." }, { status: 400 });
  }

  const progress = readProgress(key);
  if (!progress) {
    // Either the work has not started yet or it finished long enough ago to
    // be swept; the client treats both as "nothing to report".
    return NextResponse.json({ done: 0, total: 0, finished: false });
  }

  return NextResponse.json(progress, {
    headers: { "Cache-Control": "no-store" },
  });
}
