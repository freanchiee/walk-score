/** Step-level post-processing shared by the front-view (pose) and top-down analyzers. */
import { mean, median, robustSigma, weightedMean, weightedMedian } from "./math";
import type { Foot, StepResult } from "./types";

const FEET: Foot[] = ["left", "right"];

/** Drops steps far from their foot's median (needs >= 3 used steps to be meaningful). Mutates `steps`. */
export function rejectOutliers(steps: StepResult[], floorDeg: number, madK: number): void {
  for (const f of FEET) {
    const idxs = steps.map((_, i) => i).filter((i) => steps[i].foot === f && steps[i].used);
    if (idxs.length < 3) continue;
    const vals = idxs.map((i) => steps[i].angleDeg);
    const m = median(vals);
    const thr = Math.max(floorDeg, madK * robustSigma(vals));
    for (const i of idxs) {
      if (Math.abs(steps[i].angleDeg - m) > thr) {
        steps[i].used = false;
        steps[i].discardReason = `outlier (${(steps[i].angleDeg - m).toFixed(0)}° from this foot's median)`;
      }
    }
  }
}

export interface FootAggregate {
  value: number | null;
  n: number;
}

/** Per foot: confidence-weighted mean for <= 2 steps, weighted median for >= 3. */
export function aggregateFoot(steps: StepResult[], foot: Foot): FootAggregate {
  const u = steps.filter((s) => s.foot === foot && s.used);
  if (!u.length) return { value: null, n: 0 };
  const vals = u.map((s) => s.angleDeg);
  const w = u.map((s) => s.confidence);
  return { value: u.length >= 3 ? weightedMedian(vals, w) : weightedMean(vals, w), n: u.length };
}

/** "good": >= 3 steps per foot and steady; "ok": >= 2; "rough": 1 step; "none": a foot is missing. */
export function qualityOf(steps: StepResult[], leftSteps: number, rightSteps: number, steadySpreadDeg = 12) {
  const minN = Math.min(leftSteps, rightSteps);
  const meanSpread = mean(steps.filter((s) => s.used).map((s) => s.spreadDeg));
  return minN === 0 ? "none" : minN >= 3 && meanSpread <= steadySpreadDeg ? "good" : minN >= 2 ? "ok" : "rough";
}
