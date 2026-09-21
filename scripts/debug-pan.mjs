/** Prints the pan maths for each page so the numbers can be checked directly. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const { rasterizePdf } = await import("../src/server/raster.ts");
const { DEFAULT_SETTINGS } = await import("../src/engine/types.ts");
const { outputSize } = await import("../src/engine/layout.ts");
const { panDistance } = await import("../src/engine/compositor.ts");

const settings = { ...DEFAULT_SETTINGS, quality: 720, pageFrom: 1, pageTo: 6 };
const out = outputSize(settings);
const pad = Math.round(out.width * (settings.margin / 100));

const { pages } = await rasterizePdf({
  data: new Uint8Array(fs.readFileSync(path.join(root, "test-sample.pdf"))),
  pageFrom: 1,
  pageTo: 6,
  outputWidth: out.width,
});

console.log(`frame ${out.width}x${out.height}  pad ${pad}  usable height ${out.height - pad * 2}\n`);

for (const page of pages) {
  const scaleWidth = (out.width - pad * 2) / page.width;
  const drawn = page.height * scaleWidth;
  const contentEnd = drawn * page.contentBottom;
  const dist = panDistance(page, drawn, out, pad);
  console.log(
    `page ${page.num}: raster ${page.width}x${page.height} ` +
      `contentBottom ${page.contentBottom.toFixed(3)}\n` +
      `   drawn height ${drawn.toFixed(0)}  content ends at ${contentEnd.toFixed(0)}px  ` +
      `pan ${dist.toFixed(0)}px`,
  );
}
