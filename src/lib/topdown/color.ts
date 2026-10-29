/**
 * sRGB -> CIE Lab (D65) for RGBA pixel buffers. Lab separates lightness (L) from colour (a: green-red,
 * b: blue-yellow), so "this pixel is the floor / this pixel is skin" can be judged on colour distance that
 * roughly matches what people see.
 */

const SRGB_TO_LINEAR = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export interface LabPlanes {
  L: Float32Array;
  a: Float32Array;
  b: Float32Array;
}

export function allocLab(n: number): LabPlanes {
  return { L: new Float32Array(n), a: new Float32Array(n), b: new Float32Array(n) };
}

/** Converts `n` RGBA pixels (alpha ignored) into the given Lab planes. */
export function rgbaToLab(rgba: ArrayLike<number>, n: number, out: LabPlanes): LabPlanes {
  for (let i = 0; i < n; i++) {
    const r = SRGB_TO_LINEAR[rgba[i * 4]];
    const g = SRGB_TO_LINEAR[rgba[i * 4 + 1]];
    const b = SRGB_TO_LINEAR[rgba[i * 4 + 2]];
    const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
    const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
    const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
    const fx = f(x);
    const fy = f(y);
    const fz = f(z);
    out.L[i] = 116 * fy - 16;
    out.a[i] = 500 * (fx - fy);
    out.b[i] = 200 * (fy - fz);
  }
  return out;
}
