#!/usr/bin/env node
/**
 * Validation script: runs the SAME analysis the app uses on your test videos and compares it with your
 * hand-measured angles. Output: mean absolute error (MAE), a per-video table, and a plain verdict.
 *
 * The pose model is a browser/WASM model, so this script drives the app's /validate page in a headless
 * Edge/Chrome (found on your machine; nothing is downloaded) and prints what the page reports.
 * Videos are decoded locally by that browser and never uploaded anywhere.
 *
 *   1. start the app in another terminal:   npm run dev      (or: npm run build && npm start)
 *   2. put videos in validation/videos/ and the labels in validation/labels.csv
 *   3. npm run validate
 *
 * Options
 *   --labels <csv>      default validation/labels.csv        (columns: video,left_deg,right_deg)
 *   --videos <dir>      default validation/videos            (videos and/or saved landmark .json files)
 *   --url <url>         default http://localhost:3000
 *   --browser <name>    msedge | chrome (default: whichever is installed, Edge first on Windows)
 *   --mode <name>       topdown | front: how the videos were recorded (default: the app's configured mode, top-down)
 *   --model <name>      front mode only: lite | full | heavy (default full)
 *   --delegate <name>   front mode only: CPU | GPU | auto (default CPU: headless browsers rarely have a real GPU)
 *   --fps <n>           analysis frames per second (default: 15 top-down, 30 front)
 *   --swap              swap the reported left/right feet (e.g. mirrored videos)
 *   --out <dir>         default validation/results           (writes report.md and results.csv)
 *   --headed            show the browser window
 *
 * Exit code: 0 = within the ~5 degree target, 2 = above target, 3 = too few readable videos, 1 = error.
 */
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

if (flag("help") || flag("h")) {
  console.log(
    "Usage: npm run validate -- [--labels csv] [--videos dir] [--url http://localhost:3000] [--browser msedge|chrome]\n" +
      "                          [--mode topdown|front] [--model lite|full|heavy] [--delegate CPU|GPU|auto] [--fps n]\n" +
      "                          [--swap] [--out dir] [--headed]\n" +
      "See the header of scripts/validate.mjs and the README.",
  );
  process.exit(0);
}

const labels = path.resolve(opt("labels", "validation/labels.csv"));
const videosDir = path.resolve(opt("videos", "validation/videos"));
const baseUrl = opt("url", "http://localhost:3000").replace(/\/$/, "");
const mode = opt("mode"); // undefined = leave the page's default (the app's configured mode)
const model = opt("model", "full");
const delegate = opt("delegate", "CPU");
const fps = opt("fps"); // undefined = the mode's own default
const outDir = path.resolve(opt("out", "validation/results"));
const EXT = /\.(mp4|mov|m4v|webm|mkv|json)$/i;

const die = (msg, code = 1) => {
  console.error(`\n${msg}`);
  process.exit(code);
};

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(labels))) {
  die(`Labels file not found: ${labels}\nCreate it with the columns video,left_deg,right_deg (see validation/labels.example.csv).`);
}
if (!(await exists(videosDir))) die(`Videos folder not found: ${videosDir}`);
const files = (await readdir(videosDir))
  .filter((f) => EXT.test(f))
  .sort()
  .map((f) => path.join(videosDir, f));
if (!files.length) die(`No videos (.mp4 .mov .m4v .webm .mkv) or landmark .json files in ${videosDir}`);

try {
  const res = await fetch(`${baseUrl}/validate`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (err) {
  die(
    `Could not reach the app at ${baseUrl}/validate (${err instanceof Error ? err.message : err}).\n` +
      "Start it in another terminal first:  npm run dev   (or: npm run build && npm start)",
  );
}

// Find a Chromium-family browser that is already installed.
const channels = opt("browser") ? [opt("browser")] : process.platform === "win32" ? ["msedge", "chrome"] : ["chrome", "msedge"];
let browser;
let lastErr;
for (const channel of channels) {
  try {
    browser = await chromium.launch({
      channel,
      headless: !flag("headed"),
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
    });
    console.log(`Browser: ${channel}${flag("headed") ? "" : " (headless)"}`);
    break;
  } catch (err) {
    lastErr = err;
  }
}
if (!browser) {
  die(`Could not start Edge or Chrome (${lastErr instanceof Error ? lastErr.message.split("\n")[0] : lastErr}).\nInstall one, or pass --browser msedge|chrome.`);
}

const exitWith = async (code) => {
  await browser.close().catch(() => undefined);
  process.exit(code);
};

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error(`[page error] ${e.message}`));
  await page.goto(`${baseUrl}/validate`, { waitUntil: "networkidle" });
  await page.waitForSelector("#run-validation", { state: "visible" });

  console.log(`Labels: ${labels}`);
  console.log(`Videos: ${files.length} file(s) in ${videosDir}`);

  await page.setInputFiles("#labels-input", labels);
  await page.setInputFiles("#clips-input", files);
  if (mode) await page.selectOption("#val-mode", mode);
  const activeMode = await page.inputValue("#val-mode");
  // The pose model and delegate only exist in front mode.
  if (activeMode === "front") {
    await page.selectOption("#val-model", model);
    await page.selectOption("#val-delegate", delegate);
  }
  if (fps) await page.fill("#val-fps", fps);
  if (flag("swap")) await page.check("#val-swap");
  console.log(
    `Mode ${activeMode}${activeMode === "front" ? `, model ${model}, delegate ${delegate}` : ""}, ${await page.inputValue("#val-fps")} fps${flag("swap") ? ", left/right swapped" : ""}`,
  );
  await page.click("#run-validation");

  // Report progress while waiting for the page to finish.
  let last = "";
  const ticker = setInterval(async () => {
    try {
      const p = await page.evaluate(() => window.__WALKSCORE_VALIDATION__?.progress);
      const line = p ? `  [${p.current}/${p.total}] ${p.name}` : "";
      if (line && line !== last) {
        console.log(line);
        last = line;
      }
    } catch {
      /* page is busy or closing */
    }
  }, 2000);

  await page.waitForFunction(() => ["done", "error"].includes(window.__WALKSCORE_VALIDATION__?.status), null, {
    timeout: 0,
    polling: 1000,
  });
  clearInterval(ticker);

  const out = await page.evaluate(() => window.__WALKSCORE_VALIDATION__);
  if (out.status === "error") die(`Validation failed: ${out.error}`);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "report.md"), out.markdown, "utf8");
  await writeFile(path.join(outDir, "results.csv"), out.csv, "utf8");

  console.log("\n" + out.table + "\n");
  console.log(`${out.verdict.level.toUpperCase()}: ${out.verdict.headline}`);
  out.verdict.details.forEach((d) => console.log(`  - ${d}`));
  if (out.verdict.proposals.length) {
    console.log("\nSuggested fixes:");
    out.verdict.proposals.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  }
  console.log(`\nWrote ${path.join(outDir, "report.md")} and ${path.join(outDir, "results.csv")}`);

  await exitWith(out.verdict.level === "pass" ? 0 : out.verdict.level === "fail" ? 2 : 3);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  await exitWith(1);
}
