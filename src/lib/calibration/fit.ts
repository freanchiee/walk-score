/**
 * Fitting the per-foot angle offsets from hand marks. For every marked frame we have the angle the person measured
 * (heel centre -> toe gap) and the angle the app's foot finder reads in the same frame, against the SAME walking
 * direction, so their difference isolates the axis definition (the app reads the principal axis of the silhouette)
 * from everything else the full pipeline does.
 */
import { summarize, type Side } from "./measure";

export interface AxisPair {
  side: Side;
  /** the person's angle for this frame, degrees, toe-out positive */
  user: number;
  /** the app's per-frame angle for the same foot and frame, same direction */
  app: number;
}

export interface FootFit {
  n: number;
  /** mean of (user - app): add this to the app's readings */
  offsetDeg: number;
  /** scatter of the individual differences (clicking precision + foot-finder jitter + step-to-step change) */
  sdDeg: number;
  /** standard error of the offset; NaN with fewer than two marks */
  seDeg: number;
}

export interface OffsetFit {
  left: FootFit;
  right: FootFit;
}

/** An offset larger than this is a mistake (wrong foot, swapped points), never a definition difference. */
export const MAX_OFFSET_DEG = 15;
/** Fewer marks than this per foot is not enough to trust an offset. */
export const MIN_MARKS_PER_FOOT = 3;
/** Individual differences scattering more than this means the marks (or the feet finder) are not consistent. */
export const MAX_RELIABLE_SD_DEG = 4;

const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

export function fitOffsets(pairs: AxisPair[]): OffsetFit {
  const one = (side: Side): FootFit => {
    const diffs = pairs.filter((p) => p.side === side && Number.isFinite(p.user) && Number.isFinite(p.app)).map((p) => p.user - p.app);
    const s = summarize(diffs);
    if (!s) return { n: 0, offsetDeg: 0, sdDeg: 0, seDeg: NaN };
    return {
      n: s.n,
      offsetDeg: clamp(s.mean, MAX_OFFSET_DEG),
      sdDeg: s.sd,
      seDeg: s.n > 1 ? s.sd / Math.sqrt(s.n) : NaN,
    };
  };
  return { left: one("left"), right: one("right") };
}

/** Plain-language reasons not to trust a fitted offset yet (empty when it is fine). */
export function fitWarnings(fit: OffsetFit): string[] {
  const out: string[] = [];
  for (const side of ["left", "right"] as const) {
    const f = fit[side];
    if (f.n === 0) out.push(`No ${side}-foot marks yet.`);
    else if (f.n < MIN_MARKS_PER_FOOT) out.push(`Only ${f.n} ${side}-foot mark${f.n === 1 ? "" : "s"}: mark at least ${MIN_MARKS_PER_FOOT}, from different steps.`);
    else if (f.sdDeg > MAX_RELIABLE_SD_DEG)
      out.push(`The ${side}-foot marks disagree with the app by ±${f.sdDeg.toFixed(1)}° from frame to frame: delete the odd ones or re-mark them.`);
  }
  return out;
}
