/** Loads the PDF, switches to a portrait platform, and screenshots. */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const platform = process.argv[2] || null;
const out = process.argv[3] || "shot.png";
const width = Number(process.argv[4] || 1440);
const height = Number(process.argv[5] || 900);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("WebSocket")) errors.push(m.text());
});

await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.setInputFiles('input[type="file"][accept*="pdf"]', path.join(root, "test-sample.pdf"));
await page.waitForSelector('img[alt^="Preview"]', { timeout: 60_000 });

if (platform) {
  await page.getByRole("button", { name: new RegExp(platform, "i") }).click();
  await page.waitForTimeout(3000);
}

// Scrub into the body of the video so a real page is on screen.
const scrub = page.locator('input[aria-label="Scrub the preview"]');
await scrub.fill("400");
await page.waitForTimeout(3000);

await page.screenshot({ path: path.join(root, out) });
console.log(`wrote ${out}${platform ? ` (${platform})` : ""}`);
if (errors.length) {
  console.log("errors:");
  for (const e of [...new Set(errors)].slice(0, 5)) console.log("  -", e.slice(0, 200));
}

await browser.close();
