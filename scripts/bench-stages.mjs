/** Times each stage so a slowdown can be attributed. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { rasterizePdf } = await import("../src/server/raster.ts");
const { prescalePages } = await import("../src/server/prescale.ts");
const { createCanvas, frameBytes } = await import("../src/server/canvas.ts");
const { drawFrame, prepareFrameContext } = await import("../src/engine/compositor.ts");
const { layout, outputSize, drawnPageWidth } = await import("../src/engine/layout.ts");
const { DEFAULT_SETTINGS } = await import("../src/engine/types.ts");

const file = process.argv[2] || path.join(root, "test-sample.pdf");
const last = Number(process.argv[3] || 6);
const s = { ...DEFAULT_SETTINGS, quality:720, fps:24, duration:20, pageFrom:1, pageTo:last };
const out = outputSize(s);

let t = Date.now();
const { pages } = await rasterizePdf({
  data: new Uint8Array(fs.readFileSync(file)),
  pageFrom:1, pageTo:last, outputWidth: drawnPageWidth(s),
});
console.log(`rasterize ${pages.length} pages : ${Date.now()-t}ms  (${((Date.now()-t)/pages.length).toFixed(0)}ms/page)`);
console.log(`  bitmap ${pages[0].width}x${pages[0].height}`);

t = Date.now();
const n = prescalePages(pages, s);
console.log(`prescale ${n} pages        : ${Date.now()-t}ms -> ${pages[0].width}x${pages[0].height}`);

const fc = prepareFrameContext(layout(pages, s), pages, s);
const c = createCanvas(out.width, out.height);
const ctx = c.getContext("2d");
drawFrame(ctx, 5, fc);
t = Date.now();
for (let i=0;i<30;i++) drawFrame(ctx, 5+i*0.04, fc);
const draw = (Date.now()-t)/30;
t = Date.now();
for (let i=0;i<30;i++) frameBytes(c);
const buf = (Date.now()-t)/30;
console.log(`drawFrame                 : ${draw.toFixed(1)}ms/frame`);
console.log(`frameBytes                : ${buf.toFixed(1)}ms/frame`);
console.log(`=> 480 frames compositing : ~${((draw+buf)*480/1000).toFixed(0)}s`);
