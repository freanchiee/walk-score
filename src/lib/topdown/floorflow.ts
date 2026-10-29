/**
 * Floor optical flow (experimental, off by default): the direction the floor texture slides through the picture between
 * two frames, by phase correlation of a patch of the floor (feet masked out). Walking direction = opposite of the flow.
 * An independent estimate of the walking direction to compare with the one the analysis takes from the feet's motion
 * and with the "top of the picture" assumption. Needs a textured floor: on a plain one the correlation has no peak and
 * the estimate is withheld.
 */
import type { TopDownFrame } from "./analyze";

export interface Shift {
  /** how far the content moved from the first picture to the second, pixels (x right, y down) */
  dx: number;
  dy: number;
  /** 0-1: how far the correlation peak stands out of the rest of the surface (peak-to-sidelobe ratio) */
  confidence: number;
}

function fft1(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((2 * Math.PI) / len) * (inverse ? 1 : -1);
    const wlr = Math.cos(ang);
    const wli = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const vr = re[b] * wr - im[b] * wi;
        const vi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const nwr = wr * wlr - wi * wli;
        wi = wr * wli + wi * wlr;
        wr = nwr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** 2-D FFT of an n x n image held row by row in `re` / `im`, in place. */
function fft2(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
  const r = new Float64Array(n);
  const i = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      r[x] = re[y * n + x];
      i[x] = im[y * n + x];
    }
    fft1(r, i, inverse);
    for (let x = 0; x < n; x++) {
      re[y * n + x] = r[x];
      im[y * n + x] = i[x];
    }
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      r[y] = re[y * n + x];
      i[y] = im[y * n + x];
    }
    fft1(r, i, inverse);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = r[y];
      im[y * n + x] = i[y];
    }
  }
}

/** Standard deviation below which a patch is too flat to track. */
const MIN_TEXTURE_STD = 2;

/**
 * The shift that carries picture `a` onto picture `b` (b(x, y) = a(x - dx, y - dy)), both n x n grey values (n a power of
 * two), by phase correlation with a Hann window and a parabolic peak. null when either patch is too flat.
 */
export function phaseCorrelate(a: ArrayLike<number>, b: ArrayLike<number>, n: number, whiten = 0.3): Shift | null {
  const prep = (src: ArrayLike<number>) => {
    let m = 0;
    for (let k = 0; k < n * n; k++) m += src[k];
    m /= n * n;
    const re = new Float64Array(n * n);
    let v = 0;
    for (let y = 0; y < n; y++) {
      const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / n);
      for (let x = 0; x < n; x++) {
        const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / n);
        const d = src[y * n + x] - m;
        v += d * d;
        re[y * n + x] = d * wx * wy;
      }
    }
    return { re, im: new Float64Array(n * n), std: Math.sqrt(v / (n * n)) };
  };
  const A = prep(a);
  const B = prep(b);
  if (A.std < MIN_TEXTURE_STD || B.std < MIN_TEXTURE_STD) return null;
  fft2(A.re, A.im, n, false);
  fft2(B.re, B.im, n, false);
  // cross-power spectrum B * conj(A), partly whitened (magnitude^-whiten: 1 = phase only, 0 = plain correlation): its
  // inverse transform peaks at the shift. Full whitening is the textbook choice but boosts bins that carry almost no
  // signal, which drowns a narrow-band floor texture in leakage noise; a light whitening (0.3) keeps the peak sharp and robust: on test textures it located a shift to about 0.2 px, where full whitening was off by up to 20 px on a narrow-band one.
  for (let k = 0; k < n * n; k++) {
    const cr = B.re[k] * A.re[k] + B.im[k] * A.im[k];
    const ci = B.im[k] * A.re[k] - B.re[k] * A.im[k];
    const mag = Math.hypot(cr, ci);
    const scale = mag > 0 ? Math.pow(mag, -whiten) : 0;
    A.re[k] = cr * scale;
    A.im[k] = ci * scale;
  }
  fft2(A.re, A.im, n, true);
  let best = -Infinity;
  let bx = 0;
  let by = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = A.re[y * n + x];
      if (v > best) {
        best = v;
        bx = x;
        by = y;
      }
    }
  }
  // confidence from the peak-to-sidelobe ratio: how far the peak stands out of the rest of the correlation surface
  let s1 = 0;
  let s2 = 0;
  let cnt = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx0 = Math.min(Math.abs(x - bx), n - Math.abs(x - bx));
      const dy0 = Math.min(Math.abs(y - by), n - Math.abs(y - by));
      if (dx0 <= 5 && dy0 <= 5) continue;
      const v = A.re[y * n + x];
      s1 += v;
      s2 += v * v;
      cnt++;
    }
  }
  const mean = s1 / cnt;
  const std = Math.sqrt(Math.max(1e-30, s2 / cnt - mean * mean));
  const psr = (best - mean) / std;
  const at = (x: number, y: number) => A.re[((y + n) % n) * n + ((x + n) % n)];
  const sub = (m1: number, c: number, p1: number) => {
    const den = m1 - 2 * c + p1;
    return Math.abs(den) < 1e-12 ? 0 : (0.5 * (m1 - p1)) / den;
  };
  let dx = bx + sub(at(bx - 1, by), best, at(bx + 1, by));
  let dy = by + sub(at(bx, by - 1), best, at(bx, by + 1));
  if (dx > n / 2) dx -= n;
  if (dy > n / 2) dy -= n;
  // unrelated pictures give a peak about 4-5 sidelobe deviations high by chance, so count only what is above that
  return { dx, dy, confidence: 1 - Math.exp(-Math.max(0, psr - 5) / 10) };
}

/**
 * A square grey patch of the floor from the top of a work-size RGBA frame (the floor ahead of the feet), with pixels the
 * feet finder flagged replaced by the patch mean so the feet's own motion does not pull the estimate. null when the
 * frame is too small.
 */
export function floorPatch(rgba: ArrayLike<number>, W: number, H: number, mask?: ArrayLike<number> | null): { px: Float32Array; n: number } | null {
  if (W < 64 || H < 64) return null;
  const n = W >= 140 && H >= 140 ? 128 : 64;
  const x0 = Math.floor((W - n) / 2);
  const y0 = 4;
  const px = new Float32Array(n * n);
  let sum = 0;
  let count = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const p = (y0 + y) * W + (x0 + x);
      const g = 0.299 * rgba[p * 4] + 0.587 * rgba[p * 4 + 1] + 0.114 * rgba[p * 4 + 2];
      px[y * n + x] = g;
      if (!mask || !mask[p]) {
        sum += g;
        count++;
      }
    }
  }
  if (mask) {
    const m = count ? sum / count : 128;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (mask[(y0 + y) * W + (x0 + x)]) px[y * n + x] = m;
  }
  return { px, n };
}

export interface FloorFlowSummary {
  /** the walking direction the floor's motion implies: degrees clockwise from the top of the picture (same as the analysis' heading) */
  psiDeg: number;
  /** mean confidence of the frames used */
  confidence: number;
  samples: number;
}

/** The walking direction from the frames' floor flow, or null when too few frames have a trustworthy flow. */
export function floorFlowHeading(frames: TopDownFrame[], minConfidence = 0.15, minSamples = 8, minPxPerFrame = 2): FloorFlowSummary | null {
  let sx = 0;
  let sy = 0;
  let sc = 0;
  let n = 0;
  for (const f of frames) {
    const fl = f.flow;
    if (!fl || fl.confidence < minConfidence || Math.hypot(fl.dx, fl.dy) < minPxPerFrame) continue;
    // the floor slides backwards, so walking is the opposite way; average the vectors (not the angles), weighted by confidence
    const len = Math.hypot(fl.dx, fl.dy);
    sx += (-fl.dx / len) * fl.confidence;
    sy += (-fl.dy / len) * fl.confidence;
    sc += fl.confidence;
    n++;
  }
  if (n < minSamples) return null;
  return { psiDeg: (Math.atan2(sx, -sy) * 180) / Math.PI, confidence: sc / n, samples: n };
}
