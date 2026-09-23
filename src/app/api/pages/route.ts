/**
 * POST /api/pages — how many pages a PDF has.
 *
 * Opening a document used to send it twice: a probe request that rasterized
 * page one purely to learn the page count, then the real preview. This
 * answers the same question by parsing the document structure alone, which
 * is fast and keeps the upload down to one round trip for the preview.
 */

import { NextResponse } from "next/server";
import { countPages } from "@/server/raster";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Could not read your file." }, { status: 400 });
  }

  const file = form.get("pdf");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No PDF was chosen." }, { status: 400 });
  }

  try {
    const pages = await countPages(new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ pages }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    return NextResponse.json(
      {
        error: /password/i.test(message)
          ? "That PDF is locked with a password."
          : "Could not read that PDF. It may be damaged or password protected.",
      },
      { status: 400 },
    );
  }
}
