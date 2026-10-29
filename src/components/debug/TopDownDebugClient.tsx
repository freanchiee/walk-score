"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VideoInfo } from "@/lib/analysis/types";
import { serializeLandmarkFile } from "@/lib/landmarkFile";
import { pickMimeType } from "@/lib/pose/recorder";
import { computeScore } from "@/lib/scoring/score";
import { DEFAULT_TOPDOWN_OPTIONS, analyzeTopDown, type TopDownFrame, type TopDownOptions } from "@/lib/topdown/analyze";
import { TOPDOWN_FPS, extractFeet } from "@/lib/topdown/extract";
import { floorFlowHeading } from "@/lib/topdown/floorflow";
import { DEFAULT_SEGMENT_OPTIONS, type SegmentOptions } from "@/lib/topdown/segment";
import { clipToLandmarkFile, readLandmarkJson } from "@/lib/validation/run";
import { Button, Card } from "../ui";
import { ResultScreen } from "../ResultScreen";
import { CanvasTimeline } from "./CanvasTimeline";
import { PlayerPanel } from "./PlayerPanel";
import { STATE_COLORS, drawMaskOverlay, drawTopDownOverlay } from "./overlay";
import { Field, download, f1, inputCls } from "./shared";
import { StepsTable } from "./StepsTable";
import { usePlayer } from "./usePlayer";

interface TdData {
  name: string;
  video: VideoInfo;
  frames: TopDownFrame[];
  /** object URL of the video for playback (null for saved data) */
  url: string | null;
  /** the file, so segmentation can be re-run with other settings */
  file: File | null;
  meta?: Record<string, string | number | boolean>;
  /** known angles (synthetic demo / self-test), shown next to the measurement */
  truth?: { leftDeg: number; rightDeg: number };
}

interface Progress {
  stage: string;
  done: number;
  total: number;
}

/** Top-down (phone held over the feet) debug view. */
export function TopDownDebugClient() {
  const [data, setData] = useState<TdData | null>(null);
  const [options, setOptions] = useState<Partial<TopDownOptions>>({});
  const [seg, setSeg] = useState<Partial<SegmentOptions>>({});
  const [fps, setFps] = useState(TOPDOWN_FPS);
  const [flowOn, setFlowOn] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMask, setShowMask] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const n = data?.frames.length ?? 0;
  const player = usePlayer(n, data?.video.fps ?? TOPDOWN_FPS);
  const { videoRef } = player;

  const opts: TopDownOptions = useMemo(() => ({ ...DEFAULT_TOPDOWN_OPTIONS, ...options }), [options]);
  const segOpts: SegmentOptions = useMemo(() => ({ ...DEFAULT_SEGMENT_OPTIONS, ...seg }), [seg]);
  const result = useMemo(() => (data ? analyzeTopDown(data.frames, data.video, options) : null), [data, options]);
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
  const flowHeading = useMemo(() => (data ? floorFlowHeading(data.frames) : null), [data]);
  const hasFlow = !!data?.frames.some((f) => f.flow);
  const setOpt = <K extends keyof TopDownOptions>(k: K, v: TopDownOptions[K]) => setOptions((o) => ({ ...o, [k]: v }));
  const setSegOpt = <K extends keyof SegmentOptions>(k: K, v: SegmentOptions[K]) => setSeg((o) => ({ ...o, [k]: v }));

  useEffect(() => {
    const url = data?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [data?.url]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, idx: number) => {
      ctx.clearRect(0, 0, w, h);
      if (showMask) drawMaskOverlay(ctx, w, h, videoRef.current, seg);
      drawTopDownOverlay(ctx, w, h, data?.frames[idx], idx, result, false);
    },
    [data, result, showMask, seg, videoRef],
  );

  // ---- loading ----------------------------------------------------------------------------------
  const analyseVideo = async (file: File, truth?: TdData["truth"], durationHint?: number) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    player.reset();
    setProgress({ stage: "Starting…", done: 0, total: 1 });
    try {
      const r = await extractFeet(file, {
        fps,
        flow: flowOn,
        segment: seg,
        maxSeconds: 60,
        durationHint,
        signal: ctrl.signal,
        onProgress: setProgress,
      });
      setData({
        name: file.name,
        video: r.video,
        frames: r.frames,
        url: URL.createObjectURL(file),
        file,
        truth,
        meta: {
          msPerFrame: Math.round(r.meta.msPerFrame),
          width: r.meta.sourceWidth,
          height: r.meta.sourceHeight,
          workWidth: r.meta.workWidth,
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
      if (clip.kind !== "topdown") {
        setError("That file is a front-view clip. Open it in the front-view tab.");
        return;
      }
      setData({ name: clip.name, video: clip.video, frames: clip.frames, url: null, file: null, meta: clip.meta });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadSynthetic = async () => {
    const { generateBlobWalk } = await import("@/lib/topdown/synthetic");
    const g = generateBlobWalk({ leftDeg: 12, rightDeg: 4, yawDeg: 6, swayDeg: 2, angleNoiseDeg: 1.5, posNoisePx: 0.6, seed: 5 });
    setError(null);
    player.reset();
    setData({
      name: "synthetic top-down walk (known angles: left 12°, right 4°)",
      video: g.video,
      frames: g.frames,
      url: null,
      file: null,
      truth: { leftDeg: 12, rightDeg: 4 },
      meta: { synthetic: true },
    });
  };

  /**
   * End-to-end check of THIS browser: render a synthetic top-down walk with known angles, record it to a video with
   * MediaRecorder, then analyse that video through the same decode + feet-finding path a real clip takes.
   */
  const runSelfTest = async () => {
    setError(null);
    try {
      if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot record video, so the self-test cannot run.");
      const { simulateFeet, renderFeetFrame } = await import("@/lib/topdown/synthetic");
      const W = 200;
      const H = 356;
      const rate = 15;
      const truth = { leftDeg: 12, rightDeg: 4 };
      const sim = simulateFeet({ ...truth, fps: rate, durationSec: 5, width: W, height: H, yawDeg: 6 });
      const frames: ImageData[] = [];
      for (let i = 0; i < sim.states.length; i++) {
        frames.push(new ImageData(renderFeetFrame(sim.states[i], W, H, { rug: true, shorts: true, seed: 300 + i }), W, H));
        if (i % 4 === 3) {
          setProgress({ stage: "Rendering synthetic feet…", done: i + 1, total: sim.states.length });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      setProgress({ stage: "Recording the synthetic video…", done: 0, total: frames.length });
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const g = canvas.getContext("2d");
      if (!g) throw new Error("Canvas is not available.");
      const mime = pickMimeType();
      const rec = new MediaRecorder(canvas.captureStream(rate), { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 4_000_000 });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.start(100);
      g.putImageData(frames[0], 0, 0);
      const t0 = performance.now();
      for (let i = 0; i < frames.length; i++) {
        while (performance.now() < t0 + (i * 1000) / rate) await new Promise((r) => setTimeout(r, 4));
        g.putImageData(frames[i], 0, 0);
      }
      await new Promise((r) => setTimeout(r, 200));
      const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
      rec.stop();
      await stopped;
      const blob = new Blob(chunks, { type: rec.mimeType || mime || "video/webm" });
      await analyseVideo(new File([blob], "self-test.webm", { type: blob.type }), truth, 5);
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const exportJson = () => {
    if (!data) return;
    const stem = data.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_");
    download(
      serializeLandmarkFile(clipToLandmarkFile({ kind: "topdown", name: data.name, video: data.video, frames: data.frames, meta: data.meta })),
      `${stem}.feet.json`,
      "application/json",
    );
  };

  const truthErr = (found: number | null, truth: number) => (found === null ? "—" : f1(found - truth, true));

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-muted">
        Top-down capture: phone held over the feet, analysed with a colour-based foot finder (no pose model; MediaPipe Pose cannot see
        a body from above). Load a clip to see which blobs were taken as feet, their axes, which frames count as planted, and the angle
        of every step. Everything is processed in this browser; nothing is uploaded.
      </p>

      <Card>
        <h2 className="text-lg font-bold">1 · Load a clip</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Video file" hint="Feet are found on this device; no model download needed.">
            <input
              id="td-video"
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
          <Field label="…or saved clip (.json)" hint="Instant: no video decoding.">
            <input
              id="td-json"
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
          <Field label="Frames/s">
            <input
              id="td-fps"
              type="number"
              min={5}
              max={30}
              className={inputCls}
              value={fps}
              onChange={(e) => setFps(Math.min(30, Math.max(5, Number(e.target.value) || TOPDOWN_FPS)))}
            />
          </Field>
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input id="td-flow" type="checkbox" checked={flowOn} onChange={(e) => setFlowOn(e.target.checked)} className="mt-1" />
          <span>
            Also estimate the walking direction from the floor texture&apos;s optical flow (experimental, a little slower; applies to the next video you load)
          </span>
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void loadSynthetic()} id="td-synthetic">
            Load a synthetic walk
          </Button>
          <Button variant="secondary" onClick={() => void runSelfTest()} id="td-selftest" disabled={progress !== null}>
            Run on-device self-test
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
                <div className="h-full bg-accent transition-[width]" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
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
          The synthetic walk and the self-test are generated maths with known angles (left 12°, right 4°), not a real person. The
          self-test renders feet, records them to a video in this browser and analyses that video, to check that decoding and the feet
          finder work on this device.
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
              <label className={`flex items-center gap-2 text-sm ${data.url ? "" : "opacity-50"}`}>
                <input type="checkbox" checked={showMask} disabled={!data.url} onChange={(e) => setShowMask(e.target.checked)} />
                Show what the feet finder sees (cyan = skin-like and not floor)
              </label>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
                {(
                  [
                    ["stance", "planted, used"],
                    ["discarded", "planted, step discarded"],
                    ["swing", "moving / shape changing"],
                    ["invalid", "not found"],
                  ] as const
                ).map(([k, label]) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block size-3 rounded-sm" style={{ background: STATE_COLORS[k] }} />
                    {label}
                  </li>
                ))}
                <li className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block size-3 rounded-sm border border-dashed border-white/70" />
                  ignored blob (low score / cut by the edge)
                </li>
              </ul>
            </PlayerPanel>

            <div className="flex min-w-0 flex-col gap-6">
              <Card>
                <h2 className="text-lg font-bold">2 · Result</h2>
                <p className="mt-1 break-words text-xs text-muted">
                  {data.name} · {data.video.width}×{data.video.height} · {n} frames @ {data.video.fps} fps
                  {data.meta?.msPerFrame ? ` · ${String(data.meta.msPerFrame)} ms/frame` : ""}
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
                    ["Quality", result.standing ? "standing" : result.quality],
                    ["Score", score ? `${score.score} · ${score.label.title}` : "—"],
                    ["Walking ψ", result.heading.fitted ? `${f1(result.heading.psiDeg, true)}°` : "standing"],
                    ["Frames with feet", `${result.stats.posedFrames}/${result.stats.frames}`],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl border border-line bg-surface p-2">
                      <dt className="text-xs uppercase tracking-wider text-muted">{k}</dt>
                      <dd className="mt-0.5 text-lg font-bold tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
                {data.truth && (
                  <p className="mt-3 rounded-xl border border-line bg-surface p-3 text-sm" role="status">
                    <strong>Known truth:</strong> left {data.truth.leftDeg}°, right {data.truth.rightDeg}° · measured error: left{" "}
                    {truthErr(result.leftDeg, data.truth.leftDeg)}°, right {truthErr(result.rightDeg, data.truth.rightDeg)}°
                  </p>
                )}
                <div className="mt-3 rounded-xl border border-line bg-surface p-3 text-sm" id="td-direction-check">
                  <p className="font-semibold">Walking direction check (experimental)</p>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 tabular-nums">
                    <dt className="text-muted">From the feet&apos;s motion (used)</dt>
                    <dd>{result.heading.fitted ? `${f1(result.heading.psiDeg, true)}°` : "standing: the top of the picture is assumed (0°)"}</dd>
                    <dt className="text-muted">From the floor&apos;s optical flow</dt>
                    <dd id="td-flow-heading">
                      {flowHeading
                        ? `${f1(flowHeading.psiDeg, true)}° (confidence ${flowHeading.confidence.toFixed(2)}, ${flowHeading.samples} frames)`
                        : hasFlow
                          ? "no reliable floor texture (a plain floor has nothing to track)"
                          : "off: tick the box above and load the clip again"}
                    </dd>
                    <dt className="text-muted">Top of the picture</dt>
                    <dd>0° (the assumption the phone points the way you walk)</dd>
                    {flowHeading && result.heading.fitted && (
                      <>
                        <dt className="text-muted">Floor flow − feet</dt>
                        <dd className="font-bold">{f1(flowHeading.psiDeg - result.heading.psiDeg, true)}°</dd>
                      </>
                    )}
                    {flowHeading && (
                      <>
                        <dt className="text-muted">Floor flow − top of picture</dt>
                        <dd className="font-bold">{f1(flowHeading.psiDeg, true)}°</dd>
                      </>
                    )}
                    {result.heading.fitted && (
                      <>
                        <dt className="text-muted">Feet − top of picture</dt>
                        <dd className="font-bold">{f1(result.heading.psiDeg, true)}°</dd>
                      </>
                    )}
                  </dl>
                </div>
                <p className="mt-3 text-xs text-muted">
                  Heading ψ = the walking direction found from the ground motion, as degrees clockwise from the top of the picture (a
                  wrong ψ moves the left and right angles in opposite directions). Angle = foot long axis relative to it; toe-out is positive.
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
                <h2 className="text-lg font-bold">3 · Tune the analysis (instant)</h2>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["plantedTolerance", "Planted tolerance (foot lengths/s)", 0.4, 4, 0.1],
                      ["shapeTolerance", "Shape tolerance (± fraction)", 0.1, 0.8, 0.05],
                      ["minBlobScore", "Min. blob score", 0.1, 0.95, 0.05],
                      ["minStanceSec", "Min. stance (s)", 0.1, 0.8, 0.05],
                      ["trimFraction", "Trim each stance end", 0, 0.4, 0.05],
                      ["maxStepSpreadDeg", "Max. step scatter (°)", 2, 20, 1],
                      ["smoothSigmaSec", "Smoothing σ (s)", 0, 0.3, 0.01],
                      ["angleOffsetLeftDeg", "Left offset (°)", -15, 15, 0.5],
                      ["angleOffsetRightDeg", "Right offset (°)", -15, 15, 0.5],
                    ] as const
                  ).map(([key, label, min, max, step]) => (
                    <Field key={key} label={`${label}: ${opts[key]}`}>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={opts[key]}
                        onChange={(e) => setOpt(key, Number(e.target.value))}
                        className="accent-[var(--accent)]"
                      />
                    </Field>
                  ))}
                  <div className="flex flex-col justify-end gap-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={opts.allowClipped} onChange={(e) => setOpt("allowClipped", e.target.checked)} />
                      Also use feet cut by the frame edge
                    </label>
                    <label className="flex items-center gap-2">
                      <input id="td-swap" type="checkbox" checked={opts.swapLeftRight} onChange={(e) => setOpt("swapLeftRight", e.target.checked)} />
                      Swap reported left/right
                    </label>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button variant="secondary" onClick={() => setOptions({})}>
                    Reset analysis settings
                  </Button>
                  <Button variant="secondary" onClick={exportJson}>
                    Save clip (.json)
                  </Button>
                </div>
              </Card>

              <Card>
                <h2 className="text-lg font-bold">4 · Tune the feet finder (re-runs the video)</h2>
                <p className="mt-1 text-xs text-muted">
                  Switch on the mask overlay to see the effect of each setting on the current frame, then re-run to apply it to the whole clip.
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["floorDistance", "Distance from floor colour", 2, 10, 0.5],
                      ["maxTextureStd", "Max. texture (smoothness)", 3, 20, 1],
                      ["minChroma", "Min. colour strength", 2, 20, 1],
                      ["hueMin", "Skin hue from (°)", 0, 40, 1],
                      ["hueMax", "Skin hue to (°)", 50, 100, 1],
                      ["minScore", "Min. blob shape score", 0.1, 0.8, 0.05],
                    ] as const
                  ).map(([key, label, min, max, step]) => (
                    <Field key={key} label={`${label}: ${segOpts[key]}`}>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={segOpts[key]}
                        onChange={(e) => setSegOpt(key, Number(e.target.value))}
                        className="accent-[var(--accent)]"
                      />
                    </Field>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button variant="secondary" disabled={!data.file || progress !== null} onClick={() => data.file && void analyseVideo(data.file, data.truth)}>
                    Re-run on this video
                  </Button>
                  <Button variant="secondary" onClick={() => setSeg({})}>
                    Reset feet-finder settings
                  </Button>
                </div>
              </Card>
            </div>
          </div>

          <Card>
            <h2 className="text-lg font-bold">Stance timeline</h2>
            <p className="mb-2 text-xs text-muted">
              Click to jump. Green = measured stance, amber = stance that was discarded, faint = foot moving. The blue lane shows ground motion was found
              (walking).
            </p>
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
