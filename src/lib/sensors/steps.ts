import type { MotionSample } from "./types";

export interface StepOptions {
  /** shortest time between two steps, ms (about 210 steps a minute) */
  minIntervalMs: number;
  /** smallest swing of the acceleration magnitude (m/s²) that counts as a step */
  minPeak: number;
  /** the slow baseline (gravity, posture) is a moving average over about this long */
  baselineTauMs: number;
  /** light smoothing before the peak search */
  smoothTauMs: number;
}

export const DEFAULT_STEP_OPTIONS: StepOptions = { minIntervalMs: 280, minPeak: 0.7, baselineTauMs: 900, smoothTauMs: 40 };

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Step counter from the accelerometer: peaks in the swing of the acceleration magnitude (gravity removed by a slow
 * baseline, so any phone orientation works and units are m/s²). Streaming, so the live counter and the after-the-fact
 * count are the same code. Feed it every motion sample; it returns the time of a step when one is confirmed.
 */
export class StepDetector {
  readonly steps: number[] = [];
  private readonly opts: StepOptions;
  private base = 0;
  private smooth = 0;
  private energy = 0;
  private lastT = Number.NaN;
  private p2 = 0;
  private p1 = 0;
  private tP1 = 0;
  private primed = false;
  private lastStep = -Infinity;
  private intervals: number[] = [];

  constructor(opts: Partial<StepOptions> = {}) {
    this.opts = { ...DEFAULT_STEP_OPTIONS, ...opts };
  }

  push(tMs: number, ax: number, ay: number, az: number): number | null {
    const m = Math.hypot(ax, ay, az);
    if (Number.isNaN(this.lastT)) {
      this.base = m;
      this.lastT = tMs;
      this.tP1 = tMs;
      return null;
    }
    const dt = Math.max(1, tMs - this.lastT);
    this.lastT = tMs;
    this.base += (dt / (this.opts.baselineTauMs + dt)) * (m - this.base);
    this.smooth += (dt / (this.opts.smoothTauMs + dt)) * (m - this.base - this.smooth);
    const s = this.smooth;
    this.energy += (dt / (2000 + dt)) * (s * s - this.energy);
    const thr = Math.max(this.opts.minPeak, 0.55 * Math.sqrt(this.energy));
    // a step bounces about once per cadence period: ignore a second bump inside 60 % of the recent period
    const recent = this.intervals.length >= 3 ? median(this.intervals.slice(-5)) : 0;
    const minGap = Math.max(this.opts.minIntervalMs, 0.6 * recent);

    let found: number | null = null;
    if (this.primed && this.p1 > thr && this.p1 >= this.p2 && this.p1 >= s && this.tP1 - this.lastStep >= minGap) {
      found = this.tP1;
      if (Number.isFinite(this.lastStep)) this.intervals.push(found - this.lastStep);
      this.lastStep = found;
      this.steps.push(found);
    }
    this.p2 = this.p1;
    this.p1 = s;
    this.tP1 = tMs;
    this.primed = true;
    return found;
  }
}

/** Step times (ms, same clock as the samples) found in a recorded motion log. */
export function detectSteps(samples: MotionSample[], opts: Partial<StepOptions> = {}): number[] {
  const d = new StepDetector(opts);
  for (const s of samples) d.push(s.t, s.ax, s.ay, s.az);
  return d.steps;
}
