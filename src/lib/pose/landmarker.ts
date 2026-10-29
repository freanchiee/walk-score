import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import type { PoseFrame, VideoInfo } from "../analysis/types";
import { ANALYSIS_FPS, CAPTURE_CONFIG, POSE_ASSETS, type ModelVariant } from "../config";
import { resultToFrame } from "./mapping";
import { loadVideo, seekTo } from "./video";

export type DelegateChoice = "auto" | "GPU" | "CPU";

export interface ExtractProgress {
  stage: string;
  done: number;
  total: number;
}

export interface ExtractOptions {
  fps?: number;
  variant?: ModelVariant;
  /** "auto" tries the GPU first and falls back to the CPU */
  delegate?: DelegateChoice;
  /** only the first N seconds of long videos are analysed */
  maxSeconds?: number;
  /** MediaRecorder duration, used when the container does not store one */
  durationHint?: number;
  onProgress?: (p: ExtractProgress) => void;
  signal?: AbortSignal;
}

export interface ExtractionResult {
  frames: PoseFrame[];
  video: VideoInfo;
  meta: {
    delegate: "GPU" | "CPU";
    variant: ModelVariant;
    elapsedMs: number;
    msPerFrame: number;
    sourceWidth: number;
    sourceHeight: number;
  };
}

async function assertReachable(url: string, hint: string) {
  let ok = false;
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    ok = res.ok;
  } catch {
    ok = false;
  }
  if (!ok) throw new Error(`${url} is missing. ${hint}`);
}

async function createLandmarker(variant: ModelVariant, delegate: DelegateChoice) {
  const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
  await assertReachable(`${POSE_ASSETS.wasmBase}/vision_wasm_internal.js`, 'Run "npm run setup" to copy the MediaPipe WASM files.');
  const modelUrl = POSE_ASSETS.modelPath(variant);
  await assertReachable(modelUrl, `Run "npm run setup -- --model ${variant}" to download the pose model.`);
  const fileset = await FilesetResolver.forVisionTasks(POSE_ASSETS.wasmBase);

  const make = (d: "GPU" | "CPU") =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelUrl, delegate: d },
      canvas: document.createElement("canvas"),
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  if (delegate === "CPU") return { landmarker: await make("CPU"), used: "CPU" as const };
  if (delegate === "GPU") return { landmarker: await make("GPU"), used: "GPU" as const };
  try {
    return { landmarker: await make("GPU"), used: "GPU" as const };
  } catch {
    return { landmarker: await make("CPU"), used: "CPU" as const };
  }
}

const abortError = () => new DOMException("Cancelled", "AbortError");

/**
 * Runs the Pose Landmarker over a video, frame by frame, entirely on this device.
 * The video is decoded by an off-screen <video> element and never leaves the browser.
 */
export async function extractLandmarks(source: Blob, opts: ExtractOptions = {}): Promise<ExtractionResult> {
  const fps = opts.fps ?? ANALYSIS_FPS;
  const variant = opts.variant ?? POSE_ASSETS.defaultVariant;
  const maxSeconds = opts.maxSeconds ?? CAPTURE_CONFIG.maxAnalyzeSec;
  const report = (stage: string, done: number, total: number) => opts.onProgress?.({ stage, done, total });
  const started = performance.now();

  report("Loading the pose model…", 0, 1);
  const { landmarker, used } = await createLandmarker(variant, opts.delegate ?? "auto");
  let clip: Awaited<ReturnType<typeof loadVideo>> | null = null;
  try {
    if (opts.signal?.aborted) throw abortError();
    report("Opening your video…", 0, 1);
    clip = await loadVideo(source, { durationHint: opts.durationHint });

    const duration = Math.min(clip.duration, maxSeconds);
    const dt = 1 / fps;
    const total = Math.max(1, Math.floor(duration / dt));
    const frames: PoseFrame[] = [];
    let consecutiveErrors = 0;
    const loopStart = performance.now();

    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw abortError();
      const t = i * dt;
      await seekTo(clip.video, t);
      let frame: PoseFrame;
      try {
        const res = landmarker.detectForVideo(clip.video, Math.round(t * 1000));
        frame = resultToFrame(t, res);
        res.close?.();
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors > 20) {
          throw new Error(`The pose model could not read this video (${err instanceof Error ? err.message : "unknown error"}).`);
        }
        frame = { t, ok: false, img: null, world: null };
      }
      frames.push(frame);
      if (i % 3 === 0 || i === total - 1) report("Tracking your feet…", i + 1, total);
      if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
    }

    const elapsedMs = performance.now() - started;
    return {
      frames,
      video: { width: clip.width, height: clip.height, fps, duration },
      meta: {
        delegate: used,
        variant,
        elapsedMs,
        msPerFrame: (performance.now() - loopStart) / total,
        sourceWidth: clip.width,
        sourceHeight: clip.height,
      },
    };
  } finally {
    clip?.dispose();
    (landmarker as PoseLandmarker).close();
  }
}
