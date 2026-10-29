"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyze } from "@/lib/analysis/analyze";
import { DEFAULT_ANALYSIS_OPTIONS } from "@/lib/analysis/options";
import type { AnalysisOptions, PoseFrame, VideoInfo } from "@/lib/analysis/types";
import { POSE_ASSETS, analysisFps, type ModelVariant } from "@/lib/config";
import { serializeLandmarkFile } from "@/lib/landmarkFile";
import { extractLandmarks, type DelegateChoice, type ExtractProgress } from "@/lib/pose/landmarker";
import { computeScore } from "@/lib/scoring/score";
import { clipToLandmarkFile, readLandmarkJson } from "@/lib/validation/run";
import { Button, Card } from "../ui";
import { ResultScreen } from "../ResultScreen";
import { CanvasTimeline } from "./CanvasTimeline";
import { PlayerPanel } from "./PlayerPanel";
import { STATE_COLORS, drawOverlay } from "./overlay";
import { Field, download, f1, inputCls } from "./shared";
import { StepsTable } from "./StepsTable";
import { usePlayer } from "./usePlayer";

interface DebugData {
  name: string;
  video: VideoInfo;
  frames: PoseFrame[];
  /** object URL of the video for playback (null for landmark-only data) */
  url: string | null;
  meta?: Record<string, string | number | boolean>;
}

/** Front-view (MediaPipe pose) debug view. */
export function DebugClient() {
  const [data, setData] = useState<DebugData | null>(null);
  const [options, setOptions] = useState<Partial<AnalysisOptions>>({});
  const [cfg, setCfg] = useState<{ variant: ModelVariant; delegate: DelegateChoice; fps: number }>({
    variant: POSE_ASSETS.defaultVariant,
    delegate: "auto",
    fps: analysisFps("front"),
  });
  const [progress, setProgress] = useState<ExtractProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skeleton, setSkeleton] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const n = data?.frames.length ?? 0;
  const player = usePlayer(n, data?.video.fps ?? 30);

  const opts: AnalysisOptions = useMemo(() => ({ ...DEFAULT_ANALYSIS_OPTIONS, ...options }), [options]);
  const result = useMemo(() => (data ? analyze(data.frames, data.video, options) : null), [data, options]);
  const score = useMemo(
    () =>
      result?.ok && result.leftDeg !== null && result.rightDeg !== null
        ? computeScore({
            leftDeg: result.leftDeg,
            rightDeg: result.rightDeg,
            leftSteps: result.leftSteps,
            rightSteps: result.rightSteps,
            quality: result.quality === "none" ? "rough" : result.quality,
            standing: result.standing,
          })
        : null,
    [result],
  );

  const set = <K extends keyof AnalysisOptions>(k: K, v: AnalysisOptions[K]) => setOptions((o) => ({ ...o, [k]: v }));

  useEffect(() => {
    const url = data?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [data?.url]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, idx: number) => {
      drawOverlay(ctx, w, h, data?.frames[idx], idx, result, { skeleton });
    },
    [data, result, skeleton],
  );

  // ---- loading ----------------------------------------------------------------------------------
  const analyseVideo = async (file: File) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    player.reset();
    setProgress({ stage: "Starting…", done: 0, total: 1 });
    try {
      const r = await extractLandmarks(file, {
        fps: cfg.fps,
        variant: cfg.variant,
        delegate: cfg.delegate,
        maxSeconds: 60,
        signal: ctrl.signal,
        onProgress: setProgress,
      });
      setData({
        name: file.name,
        video: r.video,
        frames: r.frames,
        url: URL.createObjectURL(file),
        meta: {
          model: r.meta.variant,
          delegate: r.meta.delegate,
          msPerFrame: Math.round(r.meta.msPerFrame),
          width: r.meta.sourceWidth,
          height: r.meta.sourceHeight,
        },
      });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const loadJson = async (file: File) => {
    setError(null);
    player.reset();
    try {
      const [clip] = await readLandmarkJson(file);
      if (clip.kind !== "pose") {
        setError("That file is a top-down clip. Open it in the top-down view.");
        return;
      }
      setData({ name: clip.name, video: clip.video, frames: clip.frames, url: null, meta: clip.meta });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadSynthetic = async () => {
    const { generateSyntheticWalk } = await import("@/lib/analysis/synthetic");
    const g = generateSyntheticWalk({ leftDeg: 12, rightDeg: 4, noisePx: 2, noiseWorldM: 0.01, seed: 5, startX: 0.4 });
    setError(null);
    player.reset();
    setData({
      name: "synthetic demo (known angles: left 12°, right 4°)",
      video: g.video,
      frames: g.frames,
      url: null,
      meta: { synthetic: true },
    });
  };

  const exportJson = () => {
    if (!data) return;
    const stem = data.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_");
    download(
      serializeLandmarkFile(clipToLandmarkFile({ kind: "pose", name: data.name, video: data.video, frames: data.frames, meta: data.meta })),
      `${stem}.landmarks.json`,
      "application/json",
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-muted">
        Front-view capture (phone on the floor, person walking toward it), analysed with the MediaPipe pose model. Load a clip to
        see the detected landmarks, the stance phases and the angle of every step. Everything is processed in this browser; nothing
        is uploaded.
      </p>

      <Card>
        <h2 className="text-lg font-bold">1 · Load a clip</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Video file" hint="Runs the pose model on this device.">
            <input
              id="debug-video"
              type="file"
              accept="video/*"
              className={inputCls}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void analyseVideo(f);
                e.target.value = "";
              }}
            />
          </Field>
          <Field label="…or saved landmarks (.json)" hint="Instant: no video decoding.">
            <input
              id="debug-json"
              type="file"
              accept="application/json,.json"
              className={inputCls}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadJson(f);
                e.target.value = "";
              }}
            />
          </Field>
          <Field label="Pose model" hint="heavy = slower, may place feet better (npm run setup -- --model heavy)">
            <select
              id="debug-model"
              className={inputCls}
              value={cfg.variant}
              onChange={(e) => setCfg((c) => ({ ...c, variant: e.target.value as ModelVariant }))}
            >
              <option value="lite">lite</option>
              <option value="full">full</option>
              <option value="heavy">heavy</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Delegate">
              <select
                id="debug-delegate"
                className={inputCls}
                value={cfg.delegate}
                onChange={(e) => setCfg((c) => ({ ...c, delegate: e.target.value as DelegateChoice }))}
              >
                <option value="auto">auto</option>
                <option value="GPU">GPU</option>
                <option value="CPU">CPU</option>
              </select>
            </Field>
            <Field label="Frames/s">
              <input
                id="debug-fps"
                type="number"
                min={10}
                max={60}
                className={inputCls}
                value={cfg.fps}
                onChange={(e) => setCfg((c) => ({ ...c, fps: Math.min(60, Math.max(10, Number(e.target.value) || analysisFps("front"))) }))}
              />
            </Field>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void loadSynthetic()} id="debug-synthetic">
            Load a synthetic demo walk
          </Button>
          {progress && (
            <div className="flex min-w-60 flex-1 items-center gap-3" aria-live="polite">
              <div
                role="progressbar"
                aria-label="Analysis progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((progress.done / Math.max(1, progress.total)) * 100)}
                className="h-3 flex-1 overflow-hidden rounded-full bg-surface-strong"
              >
                <div
                  className="h-full bg-accent transition-[width]"
                  style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                />
              </div>
              <span className="text-sm text-muted">
                {progress.stage} {progress.done}/{progress.total}
              </span>
              <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
                Cancel
              </Button>
            </div>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          The synthetic walk is generated maths with known angles (left 12°, right 4°), not a real person. It only demonstrates this page.
        </p>
      </Card>

      {data && result && (
        <>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
            <PlayerPanel
              width={data.video.width}
              height={data.video.height}
              url={data.url}
              n={n}
              tAt={(i) => data.frames[i]?.t ?? 0}
              player={player}
              draw={draw}
            >
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={skeleton} onChange={(e) => setSkeleton(e.target.checked)} /> Show leg skeleton
              </label>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
                {(
                  [
                    ["stance", "planted, used"],
                    ["discarded", "planted, step discarded"],
                    ["swing", "moving / not flat"],
                    ["invalid", "low visibility / clipped"],
                    ["approach", "walking toward camera"],
                  ] as const
                ).map(([k, label]) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block size-3 rounded-sm" style={{ background: STATE_COLORS[k] }} />
                    {label}
                  </li>
                ))}
              </ul>
            </PlayerPanel>

            <div className="flex min-w-0 flex-col gap-6">
              <Card>
                <h2 className="text-lg font-bold">2 · Result</h2>
                <p className="mt-1 break-words text-xs text-muted">
                  {data.name} · {data.video.width}×{data.video.height} · {n} frames @ {data.video.fps} fps
                  {data.meta?.model ? ` · model ${String(data.meta.model)} (${String(data.meta.delegate)}, ${String(data.meta.msPerFrame)} ms/frame)` : ""}
                </p>
                <div
                  className={`mt-3 rounded-xl border p-3 text-sm ${result.ok ? "border-ok/40 bg-ok/10" : "border-danger/40 bg-danger/10"}`}
                  role="status"
                >
                  {result.ok ? (
                    <strong>Analysis OK</strong>
                  ) : (
                    <>
                      <strong>Analysis failed ({result.failure?.code})</strong>: {result.failure?.message}
                    </>
                  )}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  {[
                    ["Left", `${f1(result.leftDeg, true)}°`],
                    ["Right", `${f1(result.rightDeg, true)}°`],
                    ["Asymmetry", `${f1(result.asymmetryDeg)}°`],
                    ["Steps used L/R", `${result.leftSteps}/${result.rightSteps}`],
                    ["Quality", result.quality],
                    ["Score", score ? `${score.score} · ${score.label.title}` : "—"],
                    ["Heading ψ", `${f1(result.heading.psiDeg, true)}°${result.heading.fitted ? "" : " (not fitted)"}`],
                    ["Phone roll", `${f1(result.heading.rollDeg, true)}°`],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl border border-line bg-surface p-2">
                      <dt className="text-xs uppercase tracking-wider text-muted">{k}</dt>
                      <dd className="mt-0.5 text-lg font-bold tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs text-muted">
                  Calibration: left foot on image-{result.calibration.lateralSign > 0 ? "right" : "left"} · world axes x/y/z{" "}
                  {result.calibration.worldAxisSign.x}/{result.calibration.worldAxisSign.y}/{result.calibration.worldAxisSign.z} ·
                  torso:foot ratio {result.calibration.torsoToFootRatio.toFixed(2)} · focal ≈{Math.round(result.calibration.focalPx)} px ·{" "}
                  {result.stats.posedFrames}/{result.stats.frames} frames with a pose · {result.stats.approachFrames} approach frames
                </p>
                {result.warnings.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-warn">
                    {result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <h2 className="text-lg font-bold">3 · Tune (re-analyses instantly)</h2>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Field label="Angle estimator">
                    <select id="opt-method" className={inputCls} value={opts.method} onChange={(e) => set("method", e.target.value as AnalysisOptions["method"])}>
                      <option value="world">world landmarks</option>
                      <option value="image">image plane (assumed proportions)</option>
                    </select>
                  </Field>
                  <Field label="Walking direction">
                    <select id="opt-heading" className={inputCls} value={opts.heading} onChange={(e) => set("heading", e.target.value as AnalysisOptions["heading"])}>
                      <option value="path">fitted from the pelvis path</option>
                      <option value="camera">straight at the camera</option>
                    </select>
                  </Field>
                  <Field label="World landmark frame">
                    <select id="opt-frame" className={inputCls} value={opts.worldFrame} onChange={(e) => set("worldFrame", e.target.value as AnalysisOptions["worldFrame"])}>
                      <option value="los">line of sight (assumed)</option>
                      <option value="axis">camera axis</option>
                    </select>
                  </Field>
                  <div className="flex flex-col justify-end gap-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input id="opt-swap" type="checkbox" checked={opts.swapLeftRight} onChange={(e) => set("swapLeftRight", e.target.checked)} />
                      Mirrored video (swap L/R)
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={opts.rollCompensation} onChange={(e) => set("rollCompensation", e.target.checked)} />
                      Compensate phone roll
                    </label>
                  </div>
                  {(
                    [
                      ["minVisibility", "Min. landmark visibility", 0.05, 0.95, 0.05],
                      ["stationaryMaxRange", "Stationary threshold (× torso)", 0.01, 0.25, 0.01],
                      ["minStanceSec", "Min. stance (s)", 0.1, 0.8, 0.05],
                      ["trimFraction", "Trim each stance end", 0, 0.4, 0.05],
                      ["maxFootPitchDeg", "Max. foot pitch (°)", 10, 80, 5],
                      ["smoothSigmaSec", "Smoothing σ (s)", 0, 0.2, 0.01],
                    ] as const
                  ).map(([key, label, min, max, step]) => (
                    <Field key={key} label={`${label}: ${opts[key]}`}>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={opts[key]}
                        onChange={(e) => set(key, Number(e.target.value))}
                        className="accent-[var(--accent)]"
                      />
                    </Field>
                  ))}
                </div>
                <div className="mt-4 flex gap-3">
                  <Button variant="secondary" onClick={() => setOptions({})}>
                    Reset to defaults
                  </Button>
                  <Button variant="secondary" onClick={exportJson}>
                    Save landmarks (.json)
                  </Button>
                </div>
              </Card>
            </div>
          </div>

          <Card>
            <h2 className="text-lg font-bold">Stance timeline</h2>
            <p className="mb-2 text-xs text-muted">Click to jump. Green = measured stance, amber = stance that was discarded, faint = swing.</p>
            <CanvasTimeline result={result} n={n} idx={player.idx} onSeek={player.seek} />
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-bold">Steps</h2>
            <StepsTable result={result} onSeek={player.seek} />
          </Card>

          {score && (
            <details className="rounded-3xl border border-line bg-surface p-5">
              <summary className="cursor-pointer text-lg font-bold">Preview the screen a user would see</summary>
              <div className="mt-4">
                <ResultScreen score={score} preview onShareClick={() => undefined} onScanAgain={() => undefined} />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
