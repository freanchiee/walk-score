/**
 * The calibration page's working data: the hand marks on a clip and what they say next to what the app read.
 * Pure functions, so the page itself stays thin and this stays testable.
 */
import type { AnalysisResult } from "../analysis/types";
import type { TopDownFrame } from "../topdown/analyze";
import type { AxisPair } from "./fit";
import {
  axisAngleDeg,
  directionFromLine,
  forwardFromPsi,
  isPlausibleAngle,
  markedAngleDeg,
  summarize,
  type Pt,
  type Side,
  type Summary,
} from "./measure";

/** One foot marked on one frame: heel centre and the point between the big toe and the next toe, in video pixels. */
export interface Mark {
  id: number;
  side: Side;
  /** analysis frame index (the frame is at frames[idx].t) */
  idx: number;
  heel: Pt;
  toe: Pt;
}

/** A walking direction the person drew on the picture, in video pixels (its two ends; the line has no arrow head). */
export interface DirectionLine {
  a: Pt;
  b: Pt;
}

export interface MarkReading {
  mark: Mark;
  /** the person's angle for this mark, degrees, toe-out positive */
  userDeg: number;
  /** the app's per-frame reading of the same foot in the same frame against the same direction; null when it found no foot there */
  appDeg: number | null;
  /** false for a swapped heel/toe or a wrong direction: shown, but left out of every statistic */
  plausible: boolean;
}

/** The walking direction a clip is measured against: the person's own line when they use one, else the app's. */
export function clipForward(result: AnalysisResult, line: DirectionLine | null, useOwn: boolean): { fwd: Pt; own: boolean } {
  const app = forwardFromPsi(result.heading.psiDeg);
  if (useOwn && line) {
    const own = directionFromLine(line.a, line.b, app);
    if (own) return { fwd: own, own: true };
  }
  return { fwd: app, own: false };
}

/** The app's angle for `side` in frame `idx` (its blob's axis against `fwd`), or null when no foot was found there. */
export function appAngleAt(frames: TopDownFrame[], result: AnalysisResult, idx: number, side: Side, fwd: Pt): number | null {
  const bi = result.frames[idx]?.[side]?.blobIndex;
  if (bi === undefined || bi < 0) return null;
  const b = frames[idx]?.blobs[bi];
  return b ? axisAngleDeg({ x: b.ux, y: b.uy }, fwd, side) : null;
}

export function readMarks(marks: Mark[], frames: TopDownFrame[], result: AnalysisResult, fwd: Pt): MarkReading[] {
  return marks.map((mark) => {
    const userDeg = markedAngleDeg(mark.heel, mark.toe, fwd, mark.side);
    return { mark, userDeg, appDeg: appAngleAt(frames, result, mark.idx, mark.side, fwd), plausible: isPlausibleAngle(userDeg) };
  });
}

/** (yours, the app's) for every plausible mark where the app found the foot: what the offsets are fitted from. */
export function axisPairs(readings: MarkReading[]): AxisPair[] {
  return readings
    .filter((r): r is MarkReading & { appDeg: number } => r.plausible && r.appDeg !== null)
    .map((r) => ({ side: r.mark.side, user: r.userDeg, app: r.appDeg }));
}

/** The person's own reading of a clip: the mean of their plausible marks per foot (the numbers for labels.csv). */
export function clipMeans(readings: MarkReading[]): Record<Side, Summary | null> {
  const of = (side: Side) => summarize(readings.filter((r) => r.plausible && r.mark.side === side).map((r) => r.userDeg));
  return { left: of("left"), right: of("right") };
}

/** labels.csv for `npm run validate`: one row per clip with at least one mark on each foot. */
export function labelsCsv(rows: Array<{ name: string; left: number | null; right: number | null }>): string {
  const lines = ["video,left_deg,right_deg"];
  for (const r of rows) {
    if (r.left === null || r.right === null) continue;
    lines.push(`${r.name.replace(/[",\r\n]/g, "_")},${r.left.toFixed(1)},${r.right.toFixed(1)}`);
  }
  return lines.join("\n") + "\n";
}

/** The frames in the middle of each detected stance of `side`: where the foot is flat on the floor, the best frames to mark. */
export function stanceFrames(result: AnalysisResult, side: Side): number[] {
  const mids = (onlyUsed: boolean) =>
    result.steps
      .filter((s) => s.foot === side && (!onlyUsed || s.used))
      .map((s) => Math.round((s.usedStartIdx + s.usedEndIdx) / 2))
      .sort((a, b) => a - b);
  const used = mids(true);
  return used.length ? used : mids(false);
}
