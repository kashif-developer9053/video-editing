/** Rasterizes a PDF containing an embedded image, which pdfjs draws through
 *  a code path that needs browser globals node-canvas does not install. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { rasterizePdf } = await import("../src/server/raster.ts");

const file = process.argv[2] || path.join(root, "test-image.pdf");
try {
  const { pages } = await rasterizePdf({
    data: new Uint8Array(fs.readFileSync(file)),
    pageFrom: 1, pageTo: 1, outputWidth: 1200,
  });
  const p = pages[0];
  console.log(`OK — ${p.width}x${p.height}, coverage ${(p.coverage * 100).toFixed(1)}%`);
  // Coverage well above zero proves the image actually drew.
  console.log(p.coverage > 0.05 ? "image rendered" : "WARNING: page looks blank");
} catch (e) {
  console.log("FAILED:", e?.message ?? e);
  process.exit(1);
}
