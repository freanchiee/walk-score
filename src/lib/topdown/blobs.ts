/** Binary-mask helpers: morphology, connected components and shape statistics. Pure and DOM-free. */

export interface Component {
  label: number;
  area: number;
  /** bounding box, inclusive */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  /** central second moments (per pixel) */
  mu20: number;
  mu02: number;
  mu11: number;
  touchesLeft: boolean;
  touchesRight: boolean;
  touchesTop: boolean;
  touchesBottom: boolean;
}

/** 3x3 cross erosion, `iterations` times. Pixels outside the image count as 0. */
export function erode(mask: Uint8Array, w: number, h: number, iterations = 1): Uint8Array {
  let src = mask;
  for (let it = 0; it < iterations; it++) {
    const dst = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (src[i] && src[i - 1] && src[i + 1] && src[i - w] && src[i + w]) dst[i] = 1;
      }
    }
    src = dst;
  }
  return src === mask ? Uint8Array.from(mask) : src;
}

/** 3x3 cross dilation, `iterations` times. */
export function dilate(mask: Uint8Array, w: number, h: number, iterations = 1): Uint8Array {
  let src = mask;
  for (let it = 0; it < iterations; it++) {
    const dst = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (
          src[i] ||
          (x > 0 && src[i - 1]) ||
          (x < w - 1 && src[i + 1]) ||
          (y > 0 && src[i - w]) ||
          (y < h - 1 && src[i + w])
        ) {
          dst[i] = 1;
        }
      }
    }
    src = dst;
  }
  return src === mask ? Uint8Array.from(mask) : src;
}

/** Opening removes structures thinner than ~2*iterations pixels (stripes, grain, hair). */
export function open(mask: Uint8Array, w: number, h: number, iterations = 1): Uint8Array {
  return dilate(erode(mask, w, h, iterations), w, h, iterations);
}

/** Closing fills pinholes and thin gaps. */
export function close(mask: Uint8Array, w: number, h: number, iterations = 1): Uint8Array {
  return erode(dilate(mask, w, h, iterations), w, h, iterations);
}

/** 4-connected component labelling (labels start at 1; 0 = background). */
export function labelComponents(mask: Uint8Array, w: number, h: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(w * h);
  const parent: number[] = [0];
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  let next = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const left = x > 0 ? labels[i - 1] : 0;
      const up = y > 0 ? labels[i - w] : 0;
      if (!left && !up) {
        parent.push(next);
        labels[i] = next++;
      } else if (left && up) {
        const a = find(left);
        const b = find(up);
        labels[i] = Math.min(a, b);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      } else {
        labels[i] = left || up;
      }
    }
  }
  // compress labels to 1..count
  const remap = new Int32Array(next);
  let count = 0;
  for (let l = 1; l < next; l++) {
    const r = find(l);
    if (!remap[r]) remap[r] = ++count;
    remap[l] = remap[r];
  }
  for (let i = 0; i < labels.length; i++) if (labels[i]) labels[i] = remap[labels[i]];
  return { labels, count };
}

/** Area, bounding box, centroid and second moments of every labelled component. */
export function componentStats(labels: Int32Array, w: number, h: number, count: number): Component[] {
  const sx = new Float64Array(count + 1);
  const sy = new Float64Array(count + 1);
  const sxx = new Float64Array(count + 1);
  const syy = new Float64Array(count + 1);
  const sxy = new Float64Array(count + 1);
  const area = new Int32Array(count + 1);
  const x0 = new Int32Array(count + 1).fill(w);
  const y0 = new Int32Array(count + 1).fill(h);
  const x1 = new Int32Array(count + 1).fill(-1);
  const y1 = new Int32Array(count + 1).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = labels[y * w + x];
      if (!l) continue;
      area[l]++;
      sx[l] += x;
      sy[l] += y;
      sxx[l] += x * x;
      syy[l] += y * y;
      sxy[l] += x * y;
      if (x < x0[l]) x0[l] = x;
      if (x > x1[l]) x1[l] = x;
      if (y < y0[l]) y0[l] = y;
      if (y > y1[l]) y1[l] = y;
    }
  }
  const out: Component[] = [];
  for (let l = 1; l <= count; l++) {
    const n = area[l];
    if (!n) continue;
    const cx = sx[l] / n;
    const cy = sy[l] / n;
    out.push({
      label: l,
      area: n,
      x0: x0[l],
      y0: y0[l],
      x1: x1[l],
      y1: y1[l],
      cx,
      cy,
      mu20: sxx[l] / n - cx * cx,
      mu02: syy[l] / n - cy * cy,
      mu11: sxy[l] / n - cx * cy,
      touchesLeft: x0[l] <= 0,
      touchesRight: x1[l] >= w - 1,
      touchesTop: y0[l] <= 0,
      touchesBottom: y1[l] >= h - 1,
    });
  }
  return out;
}

export interface Orientation {
  /** unit major-axis direction (sign arbitrary) */
  ux: number;
  uy: number;
  /** variance along / across the major axis */
  major: number;
  minor: number;
  /** sqrt(major / minor) */
  elongation: number;
}

/** Principal axes from second moments. */
export function orientation(mu20: number, mu02: number, mu11: number): Orientation {
  const common = Math.sqrt(((mu20 - mu02) / 2) ** 2 + mu11 ** 2);
  const major = (mu20 + mu02) / 2 + common;
  const minor = Math.max((mu20 + mu02) / 2 - common, 1e-6);
  const theta = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
  return { ux: Math.cos(theta), uy: Math.sin(theta), major, minor, elongation: Math.sqrt(major / minor) };
}
