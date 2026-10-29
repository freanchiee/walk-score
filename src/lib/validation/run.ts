import { analyze } from "../analysis/analyze";
import { ANALYSIS_PRESETS } from "../analysis/options";
import type { AnalysisOptions, AnalysisResult, PoseFrame, VideoInfo } from "../analysis/types";
import type { CaptureMode } from "../config";
import { parseLandmarkText, type LandmarkFile } from "../landmarkFile";
import { extractLandmarks, type ExtractOptions } from "../pose/landmarker";
import { TOPDOWN_PRESETS, analyzeTopDown, type TopDownFrame, type TopDownOptions } from "../topdown/analyze";
import { extractFeet } from "../topdown/extract";
import type { LabelRow } from "./csv";
import { computeMetrics, type ClipOutcome } from "./metrics";
import { buildVerdict, type ValidationReport } from "./report";

type Meta = Record<string, string | number | boolean>;

/**
 * Extraction results of one clip, from a video run through the on-device pipeline or from a saved export.
 * "pose" = MediaPipe landmarks (front view); "topdown" = the feet found per frame (top-down view).
 */
export type ClipData =
  | { kind: "pose"; name: string; video: VideoInfo; frames: PoseFrame[]; meta?: Meta }
  | { kind: "topdown"; name: string; video: VideoInfo; frames: TopDownFrame[]; meta?: Meta };

export const isLandmarkJson = (file: { name: string }) => /\.json$/i.test(file.name);

export interface ClipExtractOptions extends ExtractOptions {
  mode: CaptureMode;
}

export async function extractClip(file: File, opts: ClipExtractOptions): Promise<ClipData> {
  if (opts.mode === "topdown") {
    const r = await extractFeet(file, {
      fps: opts.fps,
      maxSeconds: opts.maxSeconds,
      durationHint: opts.durationHint,
      onProgress: opts.onProgress,
      signal: opts.signal,
    });
    return {
      kind: "topdown",
      name: file.name,
      video: r.video,
      frames: r.frames,
      meta: {
        msPerFrame: Math.round(r.meta.msPerFrame),
        width: r.meta.sourceWidth,
        height: r.meta.sourceHeight,
        workWidth: r.meta.workWidth,
      },
    };
  }
  const r = await extractLandmarks(file, opts);
  return {
    kind: "pose",
    name: file.name,
    video: r.video,
    frames: r.frames,
    meta: {
      model: r.meta.variant,
      delegate: r.meta.delegate,
      msPerFrame: Math.round(r.meta.msPerFrame),
      width: r.meta.sourceWidth,
      height: r.meta.sourceHeight,
    },
  };
}

/** A landmark JSON may hold one clip or a bundle of several. */
export async function readLandmarkJson(file: File): Promise<ClipData[]> {
  return parseLandmarkText(await file.text()).map((c): ClipData =>
    c.kind === "pose"
      ? { kind: "pose", name: c.name || file.name, video: c.video, frames: c.frames, meta: c.meta }
      : { kind: "topdown", name: c.name || file.name, video: c.video, frames: c.frames, meta: c.meta },
  );
}

export function clipToLandmarkFile(c: ClipData): LandmarkFile {
  const base = {
    format: "walkscore-landmarks" as const,
    version: 1 as const,
    name: c.name,
    createdAt: new Date().toISOString(),
    video: c.video,
    meta: c.meta,
  };
  return c.kind === "pose" ? { ...base, kind: "pose", frames: c.frames } : { ...base, kind: "topdown", frames: c.frames };
}

export interface ValidationEntry {
  row: LabelRow;
  /** null when the video could not be loaded */
  clip: ClipData | null;
  loadError?: string;
}

/** Options applied on top of every preset, per analyzer. */
export interface RunOptions {
  pose?: Partial<AnalysisOptions>;
  topdown?: Partial<TopDownOptions>;
}

function analyseClip(
  clip: ClipData,
  presetOptions: Partial<AnalysisOptions> | Partial<TopDownOptions>,
  base: RunOptions,
): AnalysisResult {
  return clip.kind === "pose"
    ? analyze(clip.frames, clip.video, { ...base.pose, ...(presetOptions as Partial<AnalysisOptions>) })
    : analyzeTopDown(clip.frames, clip.video, { ...base.topdown, ...(presetOptions as Partial<TopDownOptions>) });
}

function outcomeFor(
  entry: ValidationEntry,
  mode: CaptureMode,
  presetOptions: Partial<AnalysisOptions> | Partial<TopDownOptions>,
  base: RunOptions,
): ClipOutcome {
  const { row, clip } = entry;
  const fail = (failure: string): ClipOutcome => ({
    video: row.video,
    trueL: row.leftDeg,
    trueR: row.rightDeg,
    predL: null,
    predR: null,
    stepsL: 0,
    stepsR: 0,
    quality: "none",
    failure,
    warnings: [],
  });
  if (!clip) return fail(entry.loadError ?? "not loaded");
  const wanted = mode === "topdown" ? "topdown" : "pose";
  if (clip.kind !== wanted) {
    return fail(`this is a ${clip.kind === "pose" ? "front-view" : "top-down"} landmark file but the run is in ${mode === "topdown" ? "top-down" : "front-view"} mode`);
  }
  const r = analyseClip(clip, presetOptions, base);
  return {
    video: row.video,
    trueL: row.leftDeg,
    trueR: row.rightDeg,
    predL: r.ok ? r.leftDeg : null,
    predR: r.ok ? r.rightDeg : null,
    stepsL: r.leftSteps,
    stepsR: r.rightSteps,
    quality: r.standing ? "standing" : r.quality,
    failure: r.ok ? undefined : (r.failure?.code ?? "failed").replace(/_/g, " "),
    warnings: r.warnings,
  };
}

/** Runs every estimator preset over every clip and builds the report (pure; cheap enough to redo on every option change). */
export function buildReport(
  entries: ValidationEntry[],
  ctx: {
    mode: CaptureMode;
    options?: RunOptions;
    settings: Record<string, string | number | boolean>;
    notes: ValidationReport["notes"];
    generatedAt?: string;
    targetMae?: number;
  },
): ValidationReport {
  const list: ReadonlyArray<{ id: string; label: string; options: Partial<AnalysisOptions> | Partial<TopDownOptions> }> =
    ctx.mode === "topdown" ? TOPDOWN_PRESETS : ANALYSIS_PRESETS;
  const base = ctx.options ?? {};
  const presets = list.map((p) => {
    const outcomes = entries.map((e) => outcomeFor(e, ctx.mode, p.options, base));
    return { id: p.id, label: p.label, outcomes, metrics: computeMetrics(outcomes) };
  });
  return {
    generatedAt: ctx.generatedAt ?? new Date().toISOString(),
    settings: { "capture mode": ctx.mode === "topdown" ? "top-down feet" : "front view (pose model)", ...ctx.settings },
    presets,
    verdict: buildVerdict(presets, ctx.targetMae, ctx.mode),
    notes: ctx.notes,
  };
}
