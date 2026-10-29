#!/usr/bin/env node
/**
 * Only needed for the FRONT-VIEW capture mode (CAPTURE_MODE = "front" in src/lib/config.ts, or the front-view
 * tab of /debug and /validate). The default top-down mode uses no model and needs none of this.
 *
 * Self-hosts everything MediaPipe Pose needs so the app never talks to a CDN at runtime:
 *   1. copies the WASM runtime from node_modules into public/mediapipe/wasm
 *   2. downloads the official Pose Landmarker model into public/models
 *
 * Usage:
 *   npm run setup                      # WASM + "full" model (default)
 *   npm run setup -- --model heavy     # also/instead fetch another variant (lite | full | heavy | all)
 *   npm run setup -- --force           # re-download even if the file exists
 *
 * Never throws: if you are offline it prints what to do and exits normally.
 */
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WASM_SRC = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const WASM_DST = path.join(root, "public", "mediapipe", "wasm");
const MODEL_DIR = path.join(root, "public", "models");

// FilesetResolver.forVisionTasks() loads the SIMD build when supported, otherwise the no-SIMD one.
const WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

const MODEL_BASE = "https://storage.googleapis.com/mediapipe-models/pose_landmarker";
const MODEL_VERSIONS = ["latest", "1"];
const MODEL_VARIANTS = ["lite", "full", "heavy"];

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const force = args.includes("--force");
const modelArgIdx = args.indexOf("--model");
const modelArg = modelArgIdx >= 0 ? args[modelArgIdx + 1] : "full";

const log = (...m) => {
  if (!quiet) console.log(...m);
};

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyWasm() {
  if (!(await exists(WASM_SRC))) {
    console.warn(`[setup] ${path.relative(root, WASM_SRC)} not found - run "npm install" first.`);
    return false;
  }
  await mkdir(WASM_DST, { recursive: true });
  for (const f of WASM_FILES) {
    const from = path.join(WASM_SRC, f);
    const to = path.join(WASM_DST, f);
    if (!(await exists(from))) {
      console.warn(`[setup] missing ${f} in @mediapipe/tasks-vision/wasm`);
      continue;
    }
    // Skip the copy when the destination is already identical in size.
    if (!force && (await exists(to)) && (await stat(to)).size === (await stat(from)).size) continue;
    await copyFile(from, to);
    log(`[setup] copied ${f}`);
  }
  return true;
}

async function downloadModel(variant) {
  const file = `pose_landmarker_${variant}.task`;
  const dest = path.join(MODEL_DIR, file);
  if (!force && (await exists(dest)) && (await stat(dest)).size > 1_000_000) {
    log(`[setup] ${file} already present`);
    return true;
  }
  await mkdir(MODEL_DIR, { recursive: true });
  for (const version of MODEL_VERSIONS) {
    const url = `${MODEL_BASE}/pose_landmarker_${variant}/float16/${version}/${file}`;
    try {
      log(`[setup] downloading ${url}`);
      const res = await fetch(url);
      if (!res.ok) {
        log(`[setup]   -> HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1_000_000) {
        log(`[setup]   -> suspiciously small (${buf.length} bytes), skipping`);
        continue;
      }
      const tmp = `${dest}.part`;
      await writeFile(tmp, buf);
      await rename(tmp, dest);
      const sha = createHash("sha256").update(await readFile(dest)).digest("hex");
      log(`[setup] saved ${file} (${(buf.length / 1e6).toFixed(1)} MB, sha256 ${sha.slice(0, 16)}...)`);
      return true;
    } catch (err) {
      log(`[setup]   -> ${err instanceof Error ? err.message : err}`);
    }
  }
  console.warn(
    `[setup] could not download ${file}. The app needs it at /models/${file}. ` +
      `Re-run "npm run setup" when online, or download it manually from ${MODEL_BASE}/pose_landmarker_${variant}/float16/1/${file}`,
  );
  return false;
}

async function main() {
  const wanted = modelArg === "all" ? MODEL_VARIANTS : [modelArg];
  for (const v of wanted) {
    if (!MODEL_VARIANTS.includes(v)) {
      console.warn(`[setup] unknown model "${v}" (use ${MODEL_VARIANTS.join(" | ")} | all)`);
      return;
    }
  }
  await copyWasm();
  for (const v of wanted) await downloadModel(v);
}

main().catch((err) => {
  // Never break `npm install`.
  console.warn("[setup] failed:", err instanceof Error ? err.message : err);
});
