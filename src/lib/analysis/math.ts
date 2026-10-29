export const DEG = 180 / Math.PI;
export const RAD = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function finiteSorted(values: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) out.push(values[i]);
  return out.sort((a, b) => a - b);
}

/** Median of the finite values; NaN when there are none. */
export function median(values: ArrayLike<number>): number {
  const a = finiteSorted(values);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function mean(values: ArrayLike<number>): number {
  let s = 0;
  let c = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) {
      s += values[i];
      c++;
    }
  }
  return c ? s / c : NaN;
}

/** Median-absolute-deviation scaled to be comparable with a standard deviation. NaN when empty. */
export function robustSigma(values: ArrayLike<number>): number {
  const a = finiteSorted(values);
  if (!a.length) return NaN;
  const m = median(a);
  return 1.4826 * median(a.map((v) => Math.abs(v - m)));
}

/** Percentile (0..1) of the finite values using linear interpolation; NaN when empty. */
export function percentile(values: ArrayLike<number>, p: number): number {
  const a = finiteSorted(values);
  if (!a.length) return NaN;
  const pos = clamp(p, 0, 1) * (a.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

export function weightedMean(values: number[], weights: number[]): number {
  let sw = 0;
  let sv = 0;
  for (let i = 0; i < values.length; i++) {
    const w = Math.max(weights[i], 0);
    if (!Number.isFinite(values[i]) || !Number.isFinite(w)) continue;
    sw += w;
    sv += w * values[i];
  }
  if (sw > 0) return sv / sw;
  return mean(values);
}

/** Weighted median; falls back to the plain median when all weights are zero. */
export function weightedMedian(values: number[], weights: number[]): number {
  const pairs = values
    .map((v, i) => ({ v, w: Math.max(weights[i] ?? 0, 0) }))
    .filter((p) => Number.isFinite(p.v) && Number.isFinite(p.w))
    .sort((a, b) => a.v - b.v);
  if (!pairs.length) return NaN;
  const total = pairs.reduce((s, p) => s + p.w, 0);
  if (total <= 0) return median(values);
  let cum = 0;
  for (let i = 0; i < pairs.length; i++) {
    cum += pairs[i].w;
    if (cum > total / 2) return pairs[i].v;
    if (cum === total / 2) return (pairs[i].v + pairs[i + 1].v) / 2;
  }
  return pairs[pairs.length - 1].v;
}

/**
 * NaN-aware Gaussian smoothing. Runs of missing samples no longer than `maxGap` frames (and bounded by
 * data on both sides) are filled from their neighbours; longer gaps stay NaN so they break stance runs.
 */
export function gaussianSmooth(values: ArrayLike<number>, sigmaFrames: number, maxGap: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  if (n === 0) return out;

  // Which missing samples may be filled?
  const fillable = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    if (Number.isFinite(values[i])) {
      fillable[i] = 1;
      i++;
      continue;
    }
    let j = i;
    while (j < n && !Number.isFinite(values[j])) j++;
    const len = j - i;
    if (len <= maxGap && i > 0 && j < n) for (let k = i; k < j; k++) fillable[k] = 1;
    i = j;
  }

  if (sigmaFrames <= 0) {
    for (let k = 0; k < n; k++) out[k] = Number.isFinite(values[k]) ? values[k] : NaN;
    return out;
  }
  const radius = Math.max(1, Math.ceil(3 * sigmaFrames));
  const kernel = new Float64Array(2 * radius + 1);
  for (let k = -radius; k <= radius; k++) kernel[k + radius] = Math.exp(-0.5 * (k / sigmaFrames) ** 2);

  for (let c = 0; c < n; c++) {
    if (!fillable[c]) continue;
    let sw = 0;
    let sv = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = c + k;
      if (j < 0 || j >= n) continue;
      const v = values[j];
      if (!Number.isFinite(v)) continue;
      const w = kernel[k + radius];
      sw += w;
      sv += w * v;
    }
    if (sw > 1e-9) out[c] = sv / sw;
  }
  return out;
}

/** Least-squares slope (per index step) of y over [center-half, center+half], finite points only. NaN with < 3 points. */
export function localSlope(y: ArrayLike<number>, center: number, half: number): number {
  const lo = Math.max(0, center - half);
  const hi = Math.min(y.length - 1, center + half);
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = lo; i <= hi; i++) {
    const v = y[i];
    if (!Number.isFinite(v)) continue;
    n++;
    sx += i;
    sy += v;
    sxx += i * i;
    sxy += i * v;
  }
  if (n < 3) return NaN;
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-9) return NaN;
  return (n * sxy - sx * sy) / den;
}

/** Theil-Sen robust line fit (median of pairwise slopes). Subsamples to at most `maxPoints`. */
export function theilSen(xs: number[], ys: number[], maxPoints = 200): { slope: number; intercept: number } | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const step = Math.max(1, Math.ceil(n / maxPoints));
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < n; i += step) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      px.push(xs[i]);
      py.push(ys[i]);
    }
  }
  if (px.length < 3) return null;
  const slopes: number[] = [];
  for (let i = 0; i < px.length; i++) {
    for (let j = i + 1; j < px.length; j++) {
      const dx = px[j] - px[i];
      if (Math.abs(dx) > 1e-9) slopes.push((py[j] - py[i]) / dx);
    }
  }
  if (!slopes.length) return null;
  const slope = median(slopes);
  const intercept = median(px.map((x, i) => py[i] - slope * x));
  return { slope, intercept };
}

/**
 * Undo an image roll of `tau` radians (clockwise on screen, y pointing down):
 * rotates the vector by -tau so that a torso leaning `tau` clockwise becomes vertical.
 */
export function unroll(x: number, y: number, tau: number): [number, number] {
  const c = Math.cos(tau);
  const s = Math.sin(tau);
  return [x * c + y * s, -x * s + y * c];
}

/** Contiguous [start, end] (inclusive) runs where mask is truthy. */
export function findRuns(mask: ArrayLike<number | boolean>): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, mask.length - 1]);
  return runs;
}

/** Fill gaps of falsy values no longer than `maxGap` that sit between truthy values, where `allowed` is set. */
export function closeGaps(mask: Uint8Array, allowed: ArrayLike<number | boolean>, maxGap: number): Uint8Array {
  const out = Uint8Array.from(mask);
  let i = 0;
  while (i < mask.length) {
    if (mask[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < mask.length && !mask[j]) j++;
    if (i > 0 && j < mask.length && j - i <= maxGap) {
      for (let k = i; k < j; k++) if (allowed[k]) out[k] = 1;
    }
    i = j;
  }
  return out;
}
