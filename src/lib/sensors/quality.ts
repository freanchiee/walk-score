import { SENSOR_CONFIG } from "../config";

/** What the capture tells us about how trustworthy the footage is, before the feet are even measured. */
export interface CaptureMetrics {
  /** ok = orientation and motion sensors both delivered; partial = one of them; unavailable = neither */
  sensors: "ok" | "partial" | "unavailable";
  tiltMedianDeg: number | null;
  /** share of the clip's frames tilted past SENSOR_CONFIG.maxFrameTiltDeg */
  tiltOverShare: number | null;
  rotationRmsDegPerSec: number | null;
  /** accelerometer steps; null = not counted */
  steps: number | null;
  lightOkShare: number | null;
  feetShare: number | null;
  forcedStart: boolean;
  yawStatus: "off" | "na" | "ok" | "warn" | "reject";
}

export interface CaptureQuality {
  /** 0-100 */
  score: number;
  category: "good" | "ok" | "poor";
  /** the sensors could not vouch for this capture (none, or only some, delivered): always "poor" */
  lowConfidence: boolean;
  reasons: string[];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const UNKNOWN = 0.6; // an unmeasured part counts as middling; lowConfidence caps the category anyway

/**
 * Capture quality 0-100 from tilt (35 %), steadiness (20 %), step count (20 %), lighting (10 %) and whether the feet
 * stayed in view (10 %), minus a penalty for starting before the checks were green and for yaw drift. These weights are
 * judgement, not measured: they are here so the number can be tuned once there are real scans to compare it with.
 */
export function captureQuality(m: CaptureMetrics, cfg = SENSOR_CONFIG): CaptureQuality {
  const reasons: string[] = [];
  const lowConfidence = m.sensors !== "ok";
  if (m.sensors === "unavailable") reasons.push("Your phone's motion sensors were not available, so tilt and steadiness could not be checked.");
  else if (m.sensors === "partial") reasons.push("Only some of your phone's motion sensors were available.");

  let tilt = UNKNOWN;
  if (m.tiltMedianDeg !== null) {
    tilt = 1 - clamp01((m.tiltMedianDeg - 3) / (cfg.tilt.warnDeg - 3));
    if (m.tiltOverShare !== null) tilt *= 1 - 0.8 * clamp01(m.tiltOverShare);
    if (m.tiltMedianDeg > cfg.tilt.goodDeg) reasons.push(`The phone was tilted about ${m.tiltMedianDeg.toFixed(0)}° on average (aim for under ${cfg.tilt.goodDeg}°).`);
    if (m.tiltOverShare !== null && m.tiltOverShare > 0.2) reasons.push(`${Math.round(m.tiltOverShare * 100)}% of the clip was tilted past ${cfg.maxFrameTiltDeg}°.`);
  }

  let steady = UNKNOWN;
  if (m.rotationRmsDegPerSec !== null) {
    steady = 1 - clamp01((m.rotationRmsDegPerSec - 20) / 60);
    if (m.rotationRmsDegPerSec > 45) reasons.push("The phone was moving or turning a lot while you walked.");
  }

  let steps = UNKNOWN;
  if (m.steps !== null) {
    steps = clamp01((m.steps - 3) / 9); // 6 steps = a third, 12 or more = full marks
    if (m.steps < cfg.minSteps + 3) reasons.push(`Only ${m.steps} step${m.steps === 1 ? "" : "s"} were counted: a longer walk gives a steadier read.`);
  }

  const light = m.lightOkShare ?? UNKNOWN;
  if (m.lightOkShare !== null && m.lightOkShare < 0.7) reasons.push("The light was too dark or too bright for much of the clip.");
  const feet = m.feetShare ?? UNKNOWN;
  if (m.feetShare !== null && m.feetShare < 0.7) reasons.push("Both feet were not in view for much of the clip.");

  let total = 0.35 * tilt + 0.2 * steady + 0.2 * steps + 0.1 * light + 0.1 * feet;
  if (m.forcedStart) {
    total -= 0.1;
    reasons.push("Recording started before the live checks were all green.");
  }
  if (m.yawStatus === "warn") {
    total -= 0.1;
    reasons.push("The phone turned relative to your walking direction.");
  } else if (m.yawStatus === "reject") {
    total -= 0.3;
    reasons.push("The phone turned a lot relative to your walking direction.");
  }

  const score = Math.round(100 * clamp01(total));
  const category = lowConfidence ? "poor" : score >= 75 ? "good" : score >= 50 ? "ok" : "poor";
  return { score, category, lowConfidence, reasons };
}

export type ReadQuality = "rough" | "ok" | "good";

/** The badge on the result screen: the worse of what the analysis found and what the capture could vouch for. */
export function mergeQuality(analysis: "none" | ReadQuality, capture: CaptureQuality | null | undefined): ReadQuality {
  const a: ReadQuality = analysis === "none" ? "rough" : analysis;
  if (!capture) return a;
  const c: ReadQuality = capture.lowConfidence || capture.category === "poor" ? "rough" : capture.category;
  const rank: Record<ReadQuality, number> = { rough: 0, ok: 1, good: 2 };
  return rank[c] < rank[a] ? c : a;
}
