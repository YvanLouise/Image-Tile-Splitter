import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, extname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "C:/Users/yvanl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
);

const root = process.cwd();
const materialDir = resolve(root, "Local material library");
const outputDir = resolve(root, "output", "bilibili-column");
const appUrl = process.env.APP_URL || "http://127.0.0.1:4173/";

mkdirSync(outputDir, { recursive: true });

if (!existsSync(materialDir)) {
  throw new Error(`Missing material directory: ${materialDir}`);
}

const pngs = readdirSync(materialDir)
  .filter((name) => extname(name).toLowerCase() === ".png")
  .map((name) => {
    const path = resolve(materialDir, name);
    return { path, name, size: statSync(path).size };
  })
  .sort((a, b) => a.size - b.size);

if (pngs.length < 2) {
  throw new Error("Expected at least two PNG files in Local material library.");
}

const tileAsset = pngs[0].path;
const comicAsset = pngs[pngs.length - 1].path;

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

async function uploadAndCapture(filePath, screenshotName, mode) {
  await page.goto(appUrl, { waitUntil: "networkidle" });

  if (mode === "comic") {
    await page.locator(".mode-switch button").nth(1).click();
    await page.waitForTimeout(800);
  }

  await page.locator('input[type="file"]').first().setInputFiles(filePath);
  await page.waitForTimeout(mode === "comic" ? 4500 : 1800);

  if (mode === "comic") {
    const autoDetect = page.locator(".left-panel button.primary.wide").first();
    if (await autoDetect.isEnabled()) {
      await autoDetect.click();
      await page.waitForTimeout(4500);
    }
  }

  await page.screenshot({
    path: resolve(outputDir, screenshotName),
    fullPage: true,
  });
}

await uploadAndCapture(tileAsset, "real-01-transparent-tiles.png", "transparent");
await uploadAndCapture(comicAsset, "real-02-comic-panels.png", "comic");

await browser.close();

console.log(`Saved screenshots to: ${outputDir}`);
console.log(`Tile asset: ${basename(tileAsset)}`);
console.log(`Comic asset: ${basename(comicAsset)}`);
