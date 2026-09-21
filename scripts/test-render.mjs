/**
 * End-to-end pipeline check: PDF in, MP4 out.
 *
 * Runs outside Next.js so a failure points at the engine rather than at the
 * framework. Uses tsx to load the TypeScript sources directly.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const { renderVideo } = await import("../src/server/render.ts");
const { DEFAULT_SETTINGS } = await import("../src/engine/types.ts");

const pdf = new Uint8Array(fs.readFileSync(path.join(root, "test-sample.pdf")));

const mode = process.argv[2] || "slide";
const duration = Number(process.argv[3] || 12);

const settings = {
  ...DEFAULT_SETTINGS,
  mode,
  duration,
  fps: 24,
  quality: 720,
  pageFrom: 1,
  pageTo: 6,
  title: "Code 413 Assignment 1",
  subtitle: "Spring 2026 - BA & AD",
  outro: "Subscribe for more solved assignments",
  watermark: "@AIOUMoonAcademy",
};

const outputPath = path.join(root, `test-out-${mode}.mp4`);
let lastMessage = "";

console.log(`\nRendering: mode=${mode} duration=${duration}s ${settings.quality}p@${settings.fps}\n`);
const started = Date.now();

try {
  const result = await renderVideo({
    pdf,
    settings,
    outputPath,
    onProgress: (p) => {
      if (p.message !== lastMessage) {
        lastMessage = p.message;
        const eta = p.etaSeconds === null ? "--" : `${p.etaSeconds.toFixed(1)}s`;
        process.stdout.write(`  [${(p.progress * 100).toFixed(0).padStart(3)}%] ${p.message} (eta ${eta})\n`);
      }
    },
  });

  const wall = (Date.now() - started) / 1000;
  const stat = fs.statSync(result.outputPath);
  const reuse = 1 - result.uniqueFrames / result.frames;

  console.log(`\n  OK  ${path.basename(result.outputPath)}`);
  console.log(`      ${result.width}x${result.height}  ${(stat.size / 1048576).toFixed(2)} MB`);
  console.log(`      encoder: ${result.encoder}`);
  console.log(`      frames: ${result.frames} total, ${result.uniqueFrames} drawn (${(reuse * 100).toFixed(1)}% reused)`);
  console.log(`      wall time: ${wall.toFixed(1)}s for ${duration}s of video (${(duration / wall).toFixed(2)}x realtime)\n`);
} catch (err) {
  console.error("\n  FAILED:", err?.message || err);
  if (err?.stack) console.error(err.stack.split("\n").slice(1, 5).join("\n"));
  process.exit(1);
}
