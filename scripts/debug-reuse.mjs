/** Reports frame reuse per mode, and what each setting costs. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const { rasterizePdf } = await import("../src/server/raster.ts");
const { DEFAULT_SETTINGS } = await import("../src/engine/types.ts");
const { layout, outputSize } = await import("../src/engine/layout.ts");
const { prepareFrameContext } = await import("../src/engine/compositor.ts");
const { estimateReuse } = await import("../src/engine/framekey.ts");

const base = { ...DEFAULT_SETTINGS, quality: 720, fps: 24, duration: 60, pageFrom: 1, pageTo: 6 };
const out = outputSize(base);

const { pages } = await rasterizePdf({
  data: new Uint8Array(fs.readFileSync(path.join(root, "test-sample.pdf"))),
  pageFrom: 1,
  pageTo: 6,
  outputWidth: out.width,
});

function check(label, patch) {
  const settings = { ...base, ...patch };
  const fc = prepareFrameContext(layout(pages, settings), pages, settings);
  const r = estimateReuse(settings.fps, settings.duration, fc);
  const pct = ((1 - r.ratio) * 100).toFixed(1);
  console.log(`${label.padEnd(42)} ${String(r.unique).padStart(5)} / ${r.total}  ${pct.padStart(5)}% reused`);
}

console.log("\n60s video, 6 pages, 720p @ 24fps = 1440 frames\n");
check("slide (current defaults)", { mode: "slide" });
check("slide, no progress bar", { mode: "slide", showProgressBar: false });
check("slide, no bar, cut transition", { mode: "slide", showProgressBar: false, transition: "cut" });
check("slide, no bar, no counter", { mode: "slide", showProgressBar: false, showCounter: false });
console.log("");
check("scroll", { mode: "scroll" });
check("autopace", { mode: "autopace" });
check("kenburns", { mode: "kenburns" });
console.log("");
check("slide, no bar, 30 pages of video", { mode: "slide", showProgressBar: false, duration: 300 });
