/** Drives the whole flow in a browser: load, render, download. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("WebSocket")) errors.push(m.text());
});

await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
console.log("1. loaded studio");

await page.setInputFiles('input[type="file"][accept*="pdf"]', path.join(root, "test-sample.pdf"));
await page.waitForSelector('img[alt^="What the video"]', { timeout: 60_000 });
console.log("2. PDF loaded, preview showing");

// Branding lives behind a disclosure now, so open it first.
await page.getByRole("button", { name: /Add text and your name/i }).click();
await page.locator("#titleText").fill("Code 413 Assignment 1");
await page.locator("#subtitleText").fill("Spring 2026 - BA & AD");
await page.locator("#outroText").fill("Subscribe for more");
await page.locator("#watermark").fill("@AIOUMoonAcademy");
await page.locator("#duration").fill("20");
await page.waitForTimeout(1500);
console.log("3. settings filled");

await page.getByRole("button", { name: /^Make video$/i }).click();
console.log("4. render started");

// Watch the progress line until the download button appears.
const downloadLink = page.getByRole("link", { name: /Save video/i });
const started = Date.now();
await downloadLink.waitFor({ timeout: 180_000 });
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`5. render finished in ${elapsed}s`);

const resultText = await page.locator("text=/Video ready/").textContent().catch(() => "");
const metaText = await page.locator("text=/fps|frames|×/").last().textContent().catch(() => "");
console.log(`   ${resultText.trim()}`);
console.log(`   ${metaText.trim()}`);

const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
await downloadLink.click();
const download = await downloadPromise;
const saved = path.join(root, "e2e-out.mp4");
await download.saveAs(saved);
const size = fs.statSync(saved).size;
console.log(`6. downloaded ${download.suggestedFilename()} (${(size / 1048576).toFixed(2)} MB)`);

await page.screenshot({ path: path.join(root, "shot-finished.png") });

if (errors.length) {
  console.log("\nconsole errors:");
  for (const e of [...new Set(errors)].slice(0, 6)) console.log("  -", e.slice(0, 200));
} else {
  console.log("\nno console errors");
}

await browser.close();
