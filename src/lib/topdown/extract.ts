import type { VideoInfo } from "../analysis/types";
import { CAPTURE_CONFIG } from "../config";
import { loadVideo, seekTo } from "../pose/video";
import type { TopDownFrame } from "./analyze";
import { floorPatch, phaseCorrelate } from "./floorflow";
import { segmentFeet, type SegmentOptions } from "./segment";

export const TOPDOWN_FPS = 15;
/** Working width for segmentation. Feet are ~50 px long at this size: plenty for an axis estimate, cheap to compute. */
export const TOPDOWN_WORK_WIDTH = 240;

export interface TopDownExtractOptions {
  fps?: number;
  workWidth?: number;
  maxSeconds?: number;
  durationHint?: number;
  segment?: Partial<SegmentOptions>;
  /** experimental: also estimate how the floor texture slides between sampled frames (floorflow.ts) */
  flow?: boolean;
  onProgress?: (p: { stage: string; done: number; total: number }) => void;
  signal?: AbortSignal;
}

export interface TopDownExtraction {
  frames: TopDownFrame[];
  video: VideoInfo;
  meta: { elapsedMs: number; msPerFrame: number; workWidth: number; workHeight: number; sourceWidth: number; sourceHeight: number };
}

/**
 * Decodes the video on this device, downsamples every sampled frame on a canvas and finds the feet in it.
 * No model is loaded and nothing leaves the browser.
 */
export async function extractFeet(source: Blob, opts: TopDownExtractOptions = {}): Promise<TopDownExtraction> {
  const fps = opts.fps ?? TOPDOWN_FPS;
  const workW = opts.workWidth ?? TOPDOWN_WORK_WIDTH;
  const maxSeconds = opts.maxSeconds ?? CAPTURE_CONFIG.maxAnalyzeSec;
  const report = (stage: string, done: number, total: number) => opts.onProgress?.({ stage, done, total });
  const started = performance.now();

  report("Opening your video…", 0, 1);
  const clip = await loadVideo(source, { durationHint: opts.durationHint });
  try {
    const workH = Math.max(2, Math.round((workW * clip.height) / clip.width));
    const canvas = document.createElement("canvas");
    canvas.width = workW;
    canvas.height = workH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas is not available in this browser.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const duration = Math.min(clip.duration, maxSeconds);
    const dt = 1 / fps;
    const total = Math.max(1, Math.floor(duration / dt));
    const frames: TopDownFrame[] = [];
    const loopStart = performance.now();
    let prevPatch: ReturnType<typeof floorPatch> = null;

    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const t = i * dt;
      await seekTo(clip.video, t);
      ctx.drawImage(clip.video, 0, 0, workW, workH);
      const { data } = ctx.getImageData(0, 0, workW, workH);
      const seg = segmentFeet(data, workW, workH, opts.segment);
      const frame: TopDownFrame = { t, blobs: seg.blobs };
      if (opts.flow) {
        const patch = floorPatch(data, workW, workH, seg.mask);
        if (patch && prevPatch && patch.n === prevPatch.n) {
          const shift = phaseCorrelate(prevPatch.px, patch.px, patch.n);
          if (shift) frame.flow = shift;
        }
        prevPatch = patch;
      }
      frames.push(frame);
      if (i % 3 === 0 || i === total - 1) report("Finding your feet…", i + 1, total);
      if (i % 6 === 5) await new Promise((r) => setTimeout(r, 0));
    }

    return {
      frames,
      video: { width: clip.width, height: clip.height, fps, duration },
      meta: {
        elapsedMs: performance.now() - started,
        msPerFrame: (performance.now() - loopStart) / total,
        workWidth: workW,
        workHeight: workH,
        sourceWidth: clip.width,
        sourceHeight: clip.height,
      },
    };
  } finally {
    clip.dispose();
  }
}
