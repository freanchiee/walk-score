import { percentile } from "../analysis/math";
import { tiltDeg } from "./tilt";
import type { MotionSample, OrientSample } from "./types";

const lowerBound = (arr: Array<{ t: number }>, t: number): number => {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

export interface LogWindow {
  orientationN: number;
  motionN: number;
  tiltMedianDeg: number | null;
  tiltP90Deg: number | null;
  /** root mean square of the gyroscope magnitude, deg/s */
  rotationRmsDegPerSec: number | null;
}

/**
 * The sensor samples of one capture, kept in memory only (never written anywhere, never uploaded). Times are
 * performance.now() milliseconds, the same clock as the recording start, so samples can be lined up with video frames.
 */
export class SensorLog {
  orientation: OrientSample[] = [];
  motion: MotionSample[] = [];

  constructor(readonly maxSamples = 20000) {}

  addOrientation(s: OrientSample): void {
    this.orientation.push(s);
    if (this.orientation.length > this.maxSamples) this.orientation.splice(0, this.orientation.length - this.maxSamples);
  }

  addMotion(s: MotionSample): void {
    this.motion.push(s);
    if (this.motion.length > this.maxSamples) this.motion.splice(0, this.motion.length - this.maxSamples);
  }

  clear(): void {
    this.orientation = [];
    this.motion = [];
  }

  /** beta / gamma at `tMs`, linearly interpolated between the two nearest samples; null when none is within `maxGapMs`. */
  betaGammaAt(tMs: number, maxGapMs = 300): { beta: number; gamma: number } | null {
    const a = this.orientation;
    if (!a.length) return null;
    const i = lowerBound(a, tMs);
    const nearest = (s: OrientSample) => (Math.abs(s.t - tMs) <= maxGapMs ? { beta: s.beta, gamma: s.gamma } : null);
    if (i === 0) return nearest(a[0]);
    if (i === a.length) return nearest(a[i - 1]);
    const p = a[i - 1];
    const q = a[i];
    if (q.t - p.t > 2 * maxGapMs) return nearest(tMs - p.t <= q.t - tMs ? p : q);
    const f = q.t === p.t ? 0 : (tMs - p.t) / (q.t - p.t);
    return { beta: p.beta + f * (q.beta - p.beta), gamma: p.gamma + f * (q.gamma - p.gamma) };
  }

  tiltAt(tMs: number, maxGapMs = 300): number | null {
    const bg = this.betaGammaAt(tMs, maxGapMs);
    return bg ? tiltDeg(bg.beta, bg.gamma) : null;
  }

  window(fromMs: number, toMs: number): LogWindow {
    const o = this.orientation.slice(lowerBound(this.orientation, fromMs), lowerBound(this.orientation, toMs + 1e-6));
    const m = this.motion.slice(lowerBound(this.motion, fromMs), lowerBound(this.motion, toMs + 1e-6));
    const tilts = o.map((s) => tiltDeg(s.beta, s.gamma));
    const mags = m.map((s) => s.rx * s.rx + s.ry * s.ry + s.rz * s.rz);
    return {
      orientationN: o.length,
      motionN: m.length,
      tiltMedianDeg: tilts.length ? percentile(tilts, 0.5) : null,
      tiltP90Deg: tilts.length ? percentile(tilts, 0.9) : null,
      rotationRmsDegPerSec: mags.length ? Math.sqrt(mags.reduce((x, y) => x + y, 0) / mags.length) : null,
    };
  }
}
