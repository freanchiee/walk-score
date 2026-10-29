/**
 * Capture quality gating: line the phone's sensor log up with the video frames, leave tilted frames out of the angle
 * averaging, count steps, and turn scans down with a plain reason when too little reliable footage is left.
 */
import { percentile } from "../analysis/math";
import type { AnalysisResult, FailureCode } from "../analysis/types";
import { SENSOR_CONFIG, type ExperimentFlags } from "../config";
import type { TopDownFrame } from "../topdown/analyze";
import type { CaptureInfo, CaptureReport } from "./capture";
import { GATE_FAILURE_MESSAGES } from "./messages";
import { captureQuality } from "./quality";
import { relativeYaw } from "./yaw";

/** Video time (s) -> the sensor clock (performance.now ms). */
export const sensorTimeMs = (cap: CaptureInfo, tSec: number, latencyMs: number = SENSOR_CONFIG.videoLatencyMs): number =>
  cap.recStartMs + tSec * 1000 + latencyMs;

/**
 * Copies of the frames with the phone's tilt at each one. Frames tilted past `maxFrameTiltDeg` are marked
 * `reliable: false`, which keeps them out of the foot-angle averaging (they still help find the walking direction).
 * Frames with no tilt reading stay as they are.
 */
export function annotateFrames(frames: TopDownFrame[], cap: CaptureInfo | null, maxTiltDeg: number = SENSOR_CONFIG.maxFrameTiltDeg): TopDownFrame[] {
  const log = cap?.sensors?.log;
  if (!cap || !log || !log.orientation.length) return frames;
  return frames.map((f) => {
    const tilt = log.tiltAt(sensorTimeMs(cap, f.t));
    return tilt === null ? f : { ...f, tiltDeg: tilt, reliable: tilt <= maxTiltDeg };
  });
}

/** Accelerometer step times in video seconds (only those inside the clip, give or take half a second). */
export function stepTimesSec(cap: CaptureInfo | null, durationSec: number): number[] {
  if (!cap?.sensors) return [];
  return cap.sensors.stepTimesMs.map((t) => (t - cap.recStartMs - SENSOR_CONFIG.videoLatencyMs) / 1000).filter((t) => t > -0.5 && t < durationSec + 0.5);
}

const share = (hit: number, total: number) => (total > 0 ? hit / total : null);

export function buildReport(a: {
  capture: CaptureInfo | null;
  /** the frames after annotateFrames */
  frames: TopDownFrame[];
  flags: ExperimentFlags;
  tiltCorrected?: boolean;
  floorFlow?: CaptureReport["floorFlow"];
}): CaptureReport {
  const cap = a.capture;
  const s = cap?.sensors ?? null;
  const sensors = s && s.hasOrientation && s.hasMotion ? "ok" : s && (s.hasOrientation || s.hasMotion) ? "partial" : "unavailable";

  const tilts = a.frames.map((f) => f.tiltDeg).filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  const tilt = {
    medianDeg: tilts.length ? percentile(tilts, 0.5) : null,
    p90Deg: tilts.length ? percentile(tilts, 0.9) : null,
    overShare: share(tilts.filter((t) => t > SENSOR_CONFIG.maxFrameTiltDeg).length, tilts.length),
  };
  const reliableShare = tilts.length ? share(a.frames.filter((f) => f.reliable !== false).length, a.frames.length) : null;
  const window = cap && s ? s.log.window(cap.recStartMs, cap.recEndMs) : null;
  const yaw =
    a.flags.yawCheck && cap && s && s.hasOrientation
      ? relativeYaw(s.log.orientation, cap.recStartMs, cap.recEndMs)
      : ({ status: "off", maxAbsDeg: null, swayRmsDeg: null } as const);
  const steps = s && s.hasMotion ? s.stepTimesMs.length : null;
  const rotation = window && window.rotationRmsDegPerSec !== null && Number.isFinite(window.rotationRmsDegPerSec) ? window.rotationRmsDegPerSec : null;

  const quality = captureQuality({
    sensors,
    tiltMedianDeg: tilt.medianDeg,
    tiltOverShare: tilt.overShare,
    rotationRmsDegPerSec: rotation,
    steps,
    lightOkShare: cap?.live.lightOkShare ?? null,
    feetShare: cap?.live.feetShare ?? null,
    forcedStart: cap?.forcedStart ?? false,
    yawStatus: yaw.status,
  });

  return {
    sensors,
    lowConfidence: quality.lowConfidence,
    steps,
    tilt,
    reliableShare,
    rotationRmsDegPerSec: rotation,
    light: { okShare: cap?.live.lightOkShare ?? null },
    feet: { share: cap?.live.feetShare ?? null },
    yaw: { status: yaw.status, maxAbsDeg: yaw.maxAbsDeg, swayRmsDeg: yaw.swayRmsDeg },
    forcedStart: cap?.forcedStart ?? false,
    tiltCorrected: a.tiltCorrected ?? false,
    lens: cap?.lens ?? null,
    quality,
    ...(a.floorFlow !== undefined ? { floorFlow: a.floorFlow } : {}),
  };
}

/** The reason to turn this scan down, or null. Checked in this order: too few steps, too little reliable footage, yaw (when switched on). */
export function rejectionFor(report: CaptureReport, result: AnalysisResult, flags: ExperimentFlags): { code: FailureCode; message: string } | null {
  const reject = (code: keyof typeof GATE_FAILURE_MESSAGES) => ({ code, message: GATE_FAILURE_MESSAGES[code] });
  if (report.steps !== null && report.steps < SENSOR_CONFIG.minSteps) return reject("too_few_steps");
  if (report.reliableShare !== null && report.reliableShare < SENSOR_CONFIG.minReliableFrameShare) return reject("too_tilted");
  // the measurement itself failed and a good part of the footage was tilted: that is the likelier culprit
  if (!result.ok && report.reliableShare !== null && report.reliableShare < 0.75) return reject("too_tilted");
  if (flags.yawReject && report.yaw.status === "reject") return reject("yaw_drift");
  return null;
}
