/**
 * Finds bare feet in one top-down frame without any neural network.
 *
 * Why not MediaPipe Pose here: from straight above, only feet and shins are visible, and the pose model
 * (which anchors on head / torso) detects nothing (verified on a real top-down photo: 0 poses at the default
 * threshold, hallucinated low-visibility ones below it). The foot angle is, however, directly visible in 2D.
 *
 * Idea: the floor is the dominant colour of the frame, so feet are the compact, smooth, skin-hued regions that
 * differ from it. Steps:
 *   1. robust Gaussian colour model of the floor (Lab), distance map from it
 *   2. gate by skin hue / chroma and by smoothness (rugs, grain and stripes are busy; skin is smooth)
 *   3. morphological opening, connected components
 *   4. per component: principal axis with the ankle / shin trimmed off (foot length ~ 2.6 x width), shape score
 * It is a prototype heuristic: plain, evenly lit floors and bare feet work best (see README).
 */
import { allocLab, rgbaToLab, type LabPlanes } from "./color";
import { componentStats, labelComponents, open, type Component } from "./blobs";

export interface SegmentOptions {
  /** Mahalanobis distance from the floor colour model above which a pixel is "not floor". */
  floorDistance: number;
  minChroma: number;
  /** Lab hue window of skin, degrees (atan2(b, a)). */
  hueMin: number;
  hueMax: number;
  /** Max local standard deviation of L (5x5) for a pixel to count as smooth skin. */
  maxTextureStd: number;
  openIterations: number;
  /** Blob area limits as a fraction of the frame. */
  minAreaFrac: number;
  maxAreaFrac: number;
  /** foot length ~= footAspect x forefoot width; used to cut the ankle / shin off the blob. */
  footAspect: number;
  /** Blobs scoring below this are not feet. */
  minScore: number;
}

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = {
  floorDistance: 4,
  minChroma: 8,
  hueMin: 15,
  hueMax: 70,
  maxTextureStd: 9,
  openIterations: 1,
  minAreaFrac: 0.004,
  maxAreaFrac: 0.14,
  footAspect: 2.6,
  minScore: 0.3,
};

export interface FootBlob {
  /** centroid of the trimmed foot, normalised to the frame (x / width, y / height) */
  cx: number;
  cy: number;
  /** blob area as a fraction of the frame, before trimming */
  area: number;
  /** length / width of the trimmed foot, in frame heights */
  length: number;
  width: number;
  /** unit vector along the long axis, pointing toward the toes in the "up" half-plane (image coords, y down) */
  ux: number;
  uy: number;
  /** length / width ratio (sqrt of the variance ratio) */
  elongation: number;
  /** toe-end and heel-end of the trimmed foot, normalised */
  toeX: number;
  toeY: number;
  heelX: number;
  heelY: number;
  /** blob touches the frame border: its axis is biased by the crop */
  clipped: boolean;
  /** 0..1 shape plausibility */
  score: number;
  /** mean Lab colour of the blob (for colour-consistency checks) */
  L: number;
  a: number;
  b: number;
}

export interface FloorModel {
  mu: [number, number, number];
  /** inverse covariance, row-major 3x3 */
  inv: number[];
}

export interface FrameSegmentation {
  blobs: FootBlob[];
  floor: FloorModel;
  /** fraction of the frame that differs from the floor and passes the skin gates */
  candidateFrac: number;
  /** the candidate mask after opening (1 = looks like skin that is not floor), for the debug overlay */
  mask: Uint8Array;
  width: number;
  height: number;
}

// ---------- helpers ------------------------------------------------------------------------------------

const trap = (v: number, a: number, b: number, c: number, d: number) => {
  if (v <= a || v >= d) return 0;
  if (v < b) return (v - a) / (b - a);
  if (v <= c) return 1;
  return (d - v) / (d - c);
};

function medianOf(arr: Float32Array): number {
  const s = Float32Array.from(arr).sort();
  return s[s.length >> 1];
}

/** Robust Gaussian colour model of the dominant colour (the floor): median start, trimmed refits, ridge. */
export function estimateFloor(lab: LabPlanes, n: number, stride = 3): FloorModel {
  const m = Math.ceil(n / stride);
  const L = new Float32Array(m);
  const A = new Float32Array(m);
  const B = new Float32Array(m);
  for (let k = 0, i = 0; k < m; k++, i += stride) {
    L[k] = lab.L[i];
    A[k] = lab.a[i];
    B[k] = lab.b[i];
  }
  const mu: [number, number, number] = [medianOf(L), medianOf(A), medianOf(B)];
  const mad = (ch: Float32Array, c: number) => {
    const d = new Float32Array(m);
    for (let k = 0; k < m; k++) d[k] = Math.abs(ch[k] - c);
    return 1.4826 * medianOf(d);
  };
  let sd: [number, number, number] = [Math.max(mad(L, mu[0]), 2), Math.max(mad(A, mu[1]), 0.7), Math.max(mad(B, mu[2]), 0.7)];
  const cov = [25, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let it = 0; it < 3; it++) {
    let cnt = 0;
    const sum = [0, 0, 0];
    for (let k = 0; k < m; k++) {
      if (Math.abs(L[k] - mu[0]) < 2.5 * sd[0] && Math.abs(A[k] - mu[1]) < 2.5 * sd[1] && Math.abs(B[k] - mu[2]) < 2.5 * sd[2]) {
        cnt++;
        sum[0] += L[k];
        sum[1] += A[k];
        sum[2] += B[k];
      }
    }
    if (cnt < 10) break;
    mu[0] = sum[0] / cnt;
    mu[1] = sum[1] / cnt;
    mu[2] = sum[2] / cnt;
    cov.fill(0);
    for (let k = 0; k < m; k++) {
      if (Math.abs(L[k] - mu[0]) < 2.5 * sd[0] && Math.abs(A[k] - mu[1]) < 2.5 * sd[1] && Math.abs(B[k] - mu[2]) < 2.5 * sd[2]) {
        const d = [L[k] - mu[0], A[k] - mu[1], B[k] - mu[2]];
        for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) cov[r * 3 + q] += d[r] * d[q];
      }
    }
    for (let k = 0; k < 9; k++) cov[k] /= cnt;
    sd = [Math.sqrt(cov[0]), Math.sqrt(cov[4]), Math.sqrt(cov[8])];
  }
  // ridge: wood grain and sensor noise should not make the model hypersensitive
  cov[0] += 1;
  cov[4] += 1;
  cov[8] += 1;
  const [a, b, c, d, e, f, g, h, i] = cov;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const inv = [
    (e * i - f * h) / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
  return { mu, inv };
}

function distanceMap(lab: LabPlanes, floor: FloorModel, n: number): Float32Array {
  const D = new Float32Array(n);
  const { mu, inv } = floor;
  for (let i = 0; i < n; i++) {
    const d0 = lab.L[i] - mu[0];
    const d1 = lab.a[i] - mu[1];
    const d2 = lab.b[i] - mu[2];
    const q =
      d0 * (inv[0] * d0 + inv[1] * d1 + inv[2] * d2) +
      d1 * (inv[3] * d0 + inv[4] * d1 + inv[5] * d2) +
      d2 * (inv[6] * d0 + inv[7] * d1 + inv[8] * d2);
    D[i] = q > 0 ? Math.sqrt(q) : 0;
  }
  return D;
}

/** Local standard deviation over a (2r+1)^2 window using integral images. */
export function localStd(plane: Float32Array, w: number, h: number, r: number): Float32Array {
  const W = w + 1;
  const s1 = new Float64Array(W * (h + 1));
  const s2 = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let r1 = 0;
    let r2 = 0;
    for (let x = 0; x < w; x++) {
      const v = plane[y * w + x];
      r1 += v;
      r2 += v * v;
      s1[(y + 1) * W + x + 1] = s1[y * W + x + 1] + r1;
      s2[(y + 1) * W + x + 1] = s2[y * W + x + 1] + r2;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const cnt = (x1 - x0) * (y1 - y0);
      const a = s1[y1 * W + x1] - s1[y0 * W + x1] - s1[y1 * W + x0] + s1[y0 * W + x0];
      const b = s2[y1 * W + x1] - s2[y0 * W + x1] - s2[y1 * W + x0] + s2[y0 * W + x0];
      out[y * w + x] = Math.sqrt(Math.max(0, b / cnt - (a / cnt) ** 2));
    }
  }
  return out;
}

interface AxisFit {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  length: number;
  width: number;
  elongation: number;
  toeX: number;
  toeY: number;
  heelX: number;
  heelY: number;
  kept: number;
}

/**
 * Principal axis of a blob (pixel coordinates) with the ankle / shin cut off: after each fit the foot length is
 * estimated from the forefoot width (length ~ footAspect x width) and pixels farther than that from the toe end
 * are dropped. The axis points "up" (toward decreasing y) so it points at the toes in the usual framing.
 */
export function fitFootAxis(xs: number[], ys: number[], footAspect: number): AxisFit {
  let px = xs;
  let py = ys;
  let fit: AxisFit | null = null;
  for (let iter = 0; iter < 3; iter++) {
    const n = px.length;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < n; i++) {
      mx += px[i];
      my += py[i];
    }
    mx /= n;
    my /= n;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      const dx = px[i] - mx;
      const dy = py[i] - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    sxx /= n;
    syy /= n;
    sxy /= n;
    const common = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2);
    const major = (sxx + syy) / 2 + common;
    const minor = Math.max((sxx + syy) / 2 - common, 1e-6);
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let ux = Math.cos(theta);
    let uy = Math.sin(theta);
    if (uy > 0 || (uy === 0 && ux < 0)) {
      ux = -ux;
      uy = -uy;
    }
    // projections
    let sMax = -Infinity;
    let sMin = Infinity;
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      s[i] = (px[i] - mx) * ux + (py[i] - my) * uy;
      if (s[i] > sMax) sMax = s[i];
      if (s[i] < sMin) sMin = s[i];
    }
    const bins = Math.max(1, Math.ceil(sMax - sMin) + 1);
    const prof = new Float32Array(bins);
    for (let i = 0; i < n; i++) prof[Math.min(bins - 1, Math.floor(sMax - s[i]))]++;
    // smooth the width profile (3 bins) and take a robust maximum
    const sm = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      let acc = 0;
      let c = 0;
      for (let d = -1; d <= 1; d++) {
        if (k + d >= 0 && k + d < bins) {
          acc += prof[k + d];
          c++;
        }
      }
      sm[k] = acc / c;
    }
    const sorted = Float32Array.from(sm).sort();
    const width = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
    const footLen = footAspect * width;
    fit = {
      cx: mx,
      cy: my,
      ux,
      uy,
      length: sMax - sMin,
      width,
      elongation: Math.sqrt(major / minor),
      toeX: mx + ux * sMax,
      toeY: my + uy * sMax,
      heelX: mx + ux * sMin,
      heelY: my + uy * sMin,
      kept: n,
    };
    if (sMax - sMin <= footLen * 1.05 || iter === 2) break;
    const nx: number[] = [];
    const ny: number[] = [];
    for (let i = 0; i < n; i++) {
      if (s[i] >= sMax - footLen) {
        nx.push(px[i]);
        ny.push(py[i]);
      }
    }
    if (nx.length < 12) break;
    px = nx;
    py = ny;
  }
  return fit as AxisFit;
}

function buildBlob(
  c: Component,
  labels: Int32Array,
  w: number,
  h: number,
  lab: LabPlanes,
  o: SegmentOptions,
): FootBlob | null {
  const xs: number[] = [];
  const ys: number[] = [];
  let sL = 0;
  let sa = 0;
  let sb = 0;
  for (let y = c.y0; y <= c.y1; y++) {
    for (let x = c.x0; x <= c.x1; x++) {
      const i = y * w + x;
      if (labels[i] === c.label) {
        xs.push(x);
        ys.push(y);
        sL += lab.L[i];
        sa += lab.a[i];
        sb += lab.b[i];
      }
    }
  }
  if (xs.length < 12) return null;
  const fit = fitFootAxis(xs, ys, o.footAspect);
  const n = xs.length;
  const areaFrac = c.area / (w * h);
  const clipped = c.touchesLeft || c.touchesRight || c.touchesTop || c.touchesBottom;
  const tiltDeg = (Math.atan2(Math.abs(fit.ux), -fit.uy) * 180) / Math.PI;
  const fill = fit.width > 0 ? fit.kept / (Math.PI * (fit.length / 2) * (fit.width / 2)) : 0;
  const score =
    trap(areaFrac, o.minAreaFrac * 0.5, o.minAreaFrac, o.maxAreaFrac, o.maxAreaFrac * 1.6) *
    trap(fit.elongation, 1.2, 1.6, 3.8, 5.8) *
    trap(tiltDeg, -1, 0, 40, 75) *
    trap(fill, 0.5, 0.75, 1.15, 1.4) *
    (clipped ? 0.6 : 1);
  return {
    cx: fit.cx / w,
    cy: fit.cy / h,
    area: areaFrac,
    length: fit.length / h,
    width: fit.width / h,
    ux: fit.ux,
    uy: fit.uy,
    elongation: fit.elongation,
    toeX: fit.toeX / w,
    toeY: fit.toeY / h,
    heelX: fit.heelX / w,
    heelY: fit.heelY / h,
    clipped,
    score,
    L: sL / n,
    a: sa / n,
    b: sb / n,
  };
}

/** Segments the feet in one RGBA frame (already downscaled to the working resolution). */
export function segmentFeet(
  rgba: ArrayLike<number>,
  w: number,
  h: number,
  partial: Partial<SegmentOptions> = {},
): FrameSegmentation {
  const o: SegmentOptions = { ...DEFAULT_SEGMENT_OPTIONS, ...partial };
  const n = w * h;
  const lab = rgbaToLab(rgba, n, allocLab(n));
  const floor = estimateFloor(lab, n);
  const D = distanceMap(lab, floor, n);
  const tex = localStd(lab.L, w, h, 2);

  const mask = new Uint8Array(n);
  let candidates = 0;
  for (let i = 0; i < n; i++) {
    if (D[i] <= o.floorDistance || tex[i] > o.maxTextureStd) continue;
    const C = Math.hypot(lab.a[i], lab.b[i]);
    if (C < o.minChroma) continue;
    const hue = (Math.atan2(lab.b[i], lab.a[i]) * 180) / Math.PI;
    if (hue < o.hueMin || hue > o.hueMax) continue;
    mask[i] = 1;
    candidates++;
  }
  const opened = open(mask, w, h, o.openIterations);
  const { labels, count } = labelComponents(opened, w, h);
  const comps = componentStats(labels, w, h, count).filter((c) => c.area >= o.minAreaFrac * n && c.area <= o.maxAreaFrac * n * 1.6);

  const blobs: FootBlob[] = [];
  for (const c of comps) {
    const b = buildBlob(c, labels, w, h, lab, o);
    if (b && b.score >= o.minScore) blobs.push(b);
  }
  blobs.sort((p, q) => q.score - p.score);

  // keep at most two feet, side by side
  const kept: FootBlob[] = [];
  for (const b of blobs) {
    if (kept.length === 0) kept.push(b);
    else if (kept.length === 1) {
      const a = kept[0];
      const sep = Math.abs(b.cx - a.cx) * (w / h); // in frame heights
      if (sep >= 0.6 * (a.width + b.width) * 0.5) kept.push(b);
    }
  }
  kept.sort((p, q) => p.cx - q.cx);
  return { blobs: kept, floor, candidateFrac: candidates / n, mask: opened, width: w, height: h };
}
