/**
 * Checks that every page gets comparable screen time, including pages that
 * are mostly picture and carry no text at all.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const { rasterizePdf } = await import("../src/server/raster.ts");
const { pageWeights, easeEnds, drawnPageWidth } = await import("../src/engine/layout.ts");
const { DEFAULT_SETTINGS } = await import("../src/engine/types.ts");

const file = process.argv[2] || path.join(root, "test-sample.pdf");
const last = Number(process.argv[3] || 6);

const base = { ...DEFAULT_SETTINGS, quality: 720, duration: 60, pageFrom: 1, pageTo: last };
const { pages } = await rasterizePdf({
  data: new Uint8Array(fs.readFileSync(file)),
  pageFrom: 1,
  pageTo: last,
  outputWidth: drawnPageWidth(base),
});

console.log(`\n${path.basename(file)} — ${pages.length} pages\n`);
console.log("page   chars   coverage   seconds (smart speed)");
for (const mode of ["autopace"]) {
  const w = pageWeights(pages, { ...base, mode });
  pages.forEach((p, i) => {
    console.log(
      `  ${String(p.num).padStart(2)}  ${String(p.chars).padStart(6)}   ` +
        `${(p.coverage * 100).toFixed(1).padStart(6)}%   ${(w[i] * base.duration).toFixed(1).padStart(6)}s`,
    );
  });
  const secs = w.map((v) => v * base.duration);
  const ratio = Math.max(...secs) / Math.min(...secs);
  console.log(`\n  slowest / fastest page = ${ratio.toFixed(2)}x  (was unbounded before)`);
}

// Constant-speed check for the non-stop scroll.
console.log("\nnon-stop scroll — distance covered per second of video:");
const samples = [0.1, 0.25, 0.5, 0.75, 0.9];
const speeds = samples.map((t) => (easeEnds(t + 0.001) - easeEnds(t)) * 1000);
samples.forEach((t, i) => console.log(`  at ${(t * 100).toFixed(0).padStart(3)}%  ${speeds[i].toFixed(4)}`));
const spread = Math.max(...speeds) / Math.min(...speeds);
console.log(`  fastest / slowest = ${spread.toFixed(4)}x  (1.0000 means perfectly even)\n`);
