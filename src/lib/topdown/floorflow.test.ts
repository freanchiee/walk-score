import { describe, expect, it } from "vitest";
import type { TopDownFrame } from "./analyze";
import { floorFlowHeading, floorPatch, phaseCorrelate } from "./floorflow";

/** a smooth, floor-like texture: a sum of waves in different directions (sampled anywhere, so sub-pixel shifts are exact) */
const waves = Array.from({ length: 14 }, (_, k) => ({
  a: 0.12 + 0.07 * ((k * 7) % 5),
  b: 0.1 + 0.06 * ((k * 3) % 7),
  p: k * 1.7,
  s: k % 2 ? 1 : -1,
}));
const texture = (x: number, y: number) => 128 + waves.reduce((sum, w) => sum + 14 * Math.sin(w.a * x + w.s * w.b * y + w.p), 0);
const patch = (n: number, ox: number, oy: number) => {
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = texture(x - ox, y - oy);
  return out;
};

describe("phase correlation (floor flow)", () => {
  it.each([
    [0, 0],
    [7, -12],
    [3.4, 18.6],
    [-9.25, 5.5],
    [20, 0],
  ])("finds a shift of (%f, %f) pixels, sub-pixel", (dx, dy) => {
    const s = phaseCorrelate(patch(128, 0, 0), patch(128, dx, dy), 128);
    expect(s).not.toBeNull();
    expect(Math.abs((s as { dx: number }).dx - dx)).toBeLessThan(0.4);
    expect(Math.abs((s as { dy: number }).dy - dy)).toBeLessThan(0.4);
    expect((s as { confidence: number }).confidence).toBeGreaterThan(0.25);
  });

  it("works on a 64 px patch too, and withholds an answer for a flat floor", () => {
    const s = phaseCorrelate(patch(64, 0, 0), patch(64, 5, 9), 64);
    expect(Math.abs((s?.dx ?? 99) - 5)).toBeLessThan(0.5);
    expect(Math.abs((s?.dy ?? 99) - 9)).toBeLessThan(0.5);
    const flat = new Float32Array(128 * 128).fill(100);
    expect(phaseCorrelate(flat, patch(128, 3, 3), 128)).toBeNull();
  });

  it("has a weak peak when the two pictures are unrelated", () => {
    const other = new Float32Array(128 * 128);
    let a = 5;
    for (let i = 0; i < other.length; i++) other[i] = 128 + 40 * (((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5);
    const s = phaseCorrelate(patch(128, 0, 0), other, 128);
    expect(s?.confidence ?? 0).toBeLessThan(0.15);
  });
});

describe("floor patch", () => {
  const W = 240;
  const H = 426;
  const frame = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) frame.set([100, 100, 100, 255], p * 4);

  it("is a 128 px grey patch from the top of the picture, with masked pixels replaced by the mean", () => {
    const mask = new Uint8Array(W * H);
    const x0 = (W - 128) / 2;
    for (let y = 4; y < 40; y++) for (let x = x0; x < x0 + 30; x++) mask[y * W + x] = 1;
    const f = frame.slice();
    for (let y = 4; y < 40; y++) for (let x = x0; x < x0 + 30; x++) f.set([255, 255, 255, 255], (y * W + x) * 4); // a bright "foot"
    const p = floorPatch(f, W, H, mask);
    expect(p?.n).toBe(128);
    expect(p?.px[0]).toBeCloseTo(100, 3); // the masked bright block became the floor mean
    expect(p?.px[127 * 128 + 127]).toBeCloseTo(100, 3);
  });

  it("is smaller for a small picture and absent for a tiny one", () => {
    expect(floorPatch(new Uint8ClampedArray(100 * 100 * 4), 100, 100)?.n).toBe(64);
    expect(floorPatch(new Uint8ClampedArray(40 * 40 * 4), 40, 40)).toBeNull();
  });
});

describe("walking direction from the floor flow", () => {
  const frames = (dx: number, dy: number, confidence = 0.6, count = 20): TopDownFrame[] =>
    Array.from({ length: count }, (_, i) => ({ t: i / 15, blobs: [], ...(i > 0 ? { flow: { dx, dy, confidence } } : {}) }));

  it("is the opposite of the way the floor slides, clockwise from the top of the picture", () => {
    expect(floorFlowHeading(frames(0, 20))?.psiDeg).toBeCloseTo(0, 6); // floor slides down: walking up
    expect(floorFlowHeading(frames(3, 20))?.psiDeg).toBeCloseTo(-8.53, 1); // walking slightly left of up
    expect(floorFlowHeading(frames(-20, 0))?.psiDeg).toBeCloseTo(90, 6); // floor slides left: walking right
    expect(floorFlowHeading(frames(0, -20))?.psiDeg).toBeCloseTo(180, 6); // phone upside down
  });

  it("needs enough confident, moving frames", () => {
    expect(floorFlowHeading(frames(3, 20, 0.05))).toBeNull(); // not confident
    expect(floorFlowHeading(frames(0.5, 0.5))).toBeNull(); // barely moving
    expect(floorFlowHeading(frames(3, 20, 0.6, 5))).toBeNull(); // too few
    const r = floorFlowHeading(frames(3, 20, 0.6, 30));
    expect(r?.samples).toBe(29);
    expect(r?.confidence).toBeCloseTo(0.6, 6);
  });
});
