/** Loads the studio, drops in the test PDF, and screenshots the result. */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const width = Number(process.argv[2] || 1440);
const height = Number(process.argv[3] || 900);
const out = process.argv[4] || "shot.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle" });

// Load the sample document through the real file input.
await page.setInputFiles('input[type="file"][accept*="pdf"]', path.join(root, "test-sample.pdf"));

// Wait for the first rendered preview frame to arrive.
await page
  .waitForSelector('img[alt^="Preview"]', { timeout: 60_000 })
  .catch(() => console.log("  (no preview image appeared)"));
await page.waitForTimeout(2500);

await page.screenshot({ path: path.join(root, out) });
console.log(`wrote ${out} at ${width}x${height}`);
if (errors.length) {
  console.log("\nconsole errors:");
  for (const e of [...new Set(errors)].slice(0, 8)) console.log("  -", e);
}

await browser.close();
