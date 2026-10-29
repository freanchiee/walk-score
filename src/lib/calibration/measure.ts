/**
 * Geometry for the calibration page: the foot angle a person marks by hand (heel centre -> the point between the big
 * toe and the next toe) against the walking direction, in exactly the convention the analysis uses: image coordinates
 * (x right, y down), toe-out positive, toe-in negative, the person's own left and right foot.
 */
export interface Pt {
  x: number;
  y: number;
}

export type Side = "left" | "right";

const DEG = 180 / Math.PI;

/** A hand-marked angle beyond this is a swapped heel/toe or a wrong direction, not a foot: it is flagged and ignored. */
export const MAX_PLAUSIBLE_ANGLE_DEG = 60;

export function unit(v: Pt): Pt {
  const l = Math.hypot(v.x, v.y);
  return l > 0 ? { x: v.x / l, y: v.y / l } : { x: 0, y: -1 };
}

/** The walking direction (unit vector) from the analysis' heading psi: degrees clockwise from the top of the picture. */
export function forwardFromPsi(psiDeg: number): Pt {
  const p = psiDeg / DEG;
  return { x: Math.sin(p), y: -Math.cos(p) };
}

export function psiFromForward(f: Pt): number {
  return Math.atan2(f.x, -f.y) * DEG;
}

/** Signed angle in degrees, clockwise on screen, from `from` to `to`. */
function clockwiseDeg(from: Pt, to: Pt): number {
  return Math.atan2(from.x * to.y - from.y * to.x, from.x * to.x + from.y * to.y) * DEG;
}

/** Foot progression angle of a foot whose toes point along `toeDir`: toe-out positive for either foot. */
export function footAngleDeg(toeDir: Pt, fwd: Pt, side: Side): number {
  return (side === "left" ? -1 : 1) * clockwiseDeg(fwd, toeDir);
}

/** Same for an axis with no sign (the principal axis of a silhouette): it is first turned to point along the walking direction. */
export function axisAngleDeg(axis: Pt, fwd: Pt, side: Side): number {
  const s = axis.x * fwd.x + axis.y * fwd.y >= 0 ? 1 : -1;
  return footAngleDeg({ x: s * axis.x, y: s * axis.y }, fwd, side);
}

/** The angle of the line a person marked from the heel centre to the toe gap (a directed line: no flipping). */
export function markedAngleDeg(heel: Pt, toe: Pt, fwd: Pt, side: Side): number {
  return footAngleDeg({ x: toe.x - heel.x, y: toe.y - heel.y }, fwd, side);
}

export function isPlausibleAngle(deg: number): boolean {
  return Number.isFinite(deg) && Math.abs(deg) <= MAX_PLAUSIBLE_ANGLE_DEG;
}

/** A walking direction drawn as a line on the picture: its two ends, turned to agree with `ref` (the line has no arrow head). */
export function directionFromLine(a: Pt, b: Pt, ref: Pt): Pt | null {
  const v = { x: b.x - a.x, y: b.y - a.y };
  if (Math.hypot(v.x, v.y) < 1e-6) return null;
  const u = unit(v);
  return u.x * ref.x + u.y * ref.y >= 0 ? u : { x: -u.x, y: -u.y };
}

export interface Summary {
  n: number;
  mean: number;
  /** sample standard deviation (0 for a single value) */
  sd: number;
}

export function summarize(values: number[]): Summary | null {
  const v = values.filter(Number.isFinite);
  if (!v.length) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { n: v.length, mean, sd };
}
