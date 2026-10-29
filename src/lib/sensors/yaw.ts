import { SENSOR_CONFIG } from "../config";
import type { OrientSample } from "./types";

export interface YawReport {
  status: "na" | "ok" | "warn" | "reject";
  /** largest rotation away from the start heading, degrees */
  maxAbsDeg: number | null;
  /** rotation at the end of the window */
  endDeg: number | null;
  /** scatter around the straight-line drift, degrees (the sway of a hand-held phone) */
  swayRmsDeg: number | null;
  samples: number;
}

const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * How far the phone turned about the vertical during the walk, from the orientation `alpha` (the heading of the top
 * edge while the phone is roughly flat). Relative only: alpha's zero is arbitrary, so the start heading is the reference.
 * Experimental: a person who deliberately turns also shows up here, which for this app is exactly the case to flag.
 */
export function relativeYaw(orientation: OrientSample[], fromMs: number, toMs: number, limits = SENSOR_CONFIG.yaw): YawReport {
  const s = orientation.filter((o) => o.t >= fromMs && o.t <= toMs && o.alpha !== null && Number.isFinite(o.alpha));
  if (s.length < 5) return { status: "na", maxAbsDeg: null, endDeg: null, swayRmsDeg: null, samples: s.length };
  const rel: number[] = [0];
  for (let i = 1; i < s.length; i++) rel.push(rel[i - 1] + wrap180((s[i].alpha as number) - (s[i - 1].alpha as number))); // unwrapped step by step
  const maxAbs = Math.max(...rel.map(Math.abs));
  // scatter around the best straight line through (time, heading)
  const n = rel.length;
  const ts = s.map((o) => (o.t - s[0].t) / 1000);
  const mt = ts.reduce((a, b) => a + b, 0) / n;
  const mr = rel.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (ts[i] - mt) ** 2;
    sxy += (ts[i] - mt) * (rel[i] - mr);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const sway = Math.sqrt(rel.reduce((a, r, i) => a + (r - (mr + slope * (ts[i] - mt))) ** 2, 0) / n);
  const status = maxAbs > limits.rejectDeg ? "reject" : maxAbs > limits.warnDeg ? "warn" : "ok";
  return { status, maxAbsDeg: maxAbs, endDeg: rel[n - 1], swayRmsDeg: sway, samples: n };
}
