import { describe, expect, it } from "vitest";
import { analyzeTopDown } from "./analyze";
import { fitFootAxis, localStd, segmentFeet, type FootBlob } from "./segment";
import { renderFeetFrame, simulateFeet, type FootState, type SceneOptions } from "./synthetic";

/**
 * Pixel-level synthetic scenes with known foot angles. They prove the feet finder and the axis maths work on
 * clean, rendered feet (including a rug, shorts, other floor / skin colours). Real footage is untested here.
 */

const W = 200;
const H = 356;
const angleOf = (b: FootBlob) => (Math.atan2(b.ux, -b.uy) * 180) / Math.PI; // clockwise from image-up

const feet = (leftAlpha: number, rightAlpha: number, extra: Partial<FootState> = {}): FootState[] => [
  { isLeft: true, x: 80, y: 250, alphaUp: leftAlpha, lengthPx: 60, widthPx: 23, ...extra },
  { isLeft: false, x: 122, y: 252, alphaUp: rightAlpha, lengthPx: 60, widthPx: 23, ...extra },
];

function find(states: FootState[], scene: SceneOptions = {}, opts = {}) {
  return segmentFeet(renderFeetFrame(states, W, H, scene), W, H, opts);
}

describe("segmentFeet on rendered feet", () => {
  it("finds both feet and their axes (left toe-out 8° = -8° from up, right toe-out 5° = +5°)", () => {
    const seg = find(feet(-8, 5));
    expect(seg.blobs).toHaveLength(2);
    const [l, r] = seg.blobs; // sorted by x
    expect(l.cx).toBeLessThan(r.cx);
    expect(Math.abs(angleOf(l) - -8)).toBeLessThan(2);
    expect(Math.abs(angleOf(r) - 5)).toBeLessThan(2);
    expect(l.clipped).toBe(false);
    expect(l.score).toBeGreaterThan(0.8);
  });

  it("still finds them with a striped rug and light shorts in the picture", () => {
    const seg = find(feet(-8, 5), { rug: true, shorts: true });
    expect(seg.blobs).toHaveLength(2);
    expect(Math.abs(angleOf(seg.blobs[0]) - -8)).toBeLessThan(3);
    expect(Math.abs(angleOf(seg.blobs[1]) - 5)).toBeLessThan(3);
  });

  it.each([
    ["tan wood, medium skin", [152, 128, 100], [98, 70, 58]],
    ["grey tile, medium skin", [128, 128, 134], [150, 105, 85]],
    ["dark wood, light skin", [62, 46, 36], [205, 155, 130]],
    ["pale floor, dark skin", [205, 195, 175], [78, 52, 40]],
  ] as const)("works on %s", (_name, floor, skin) => {
    const seg = find(feet(-6, 9), { floor: [...floor], skin: [...skin] });
    expect(seg.blobs).toHaveLength(2);
    expect(Math.abs(angleOf(seg.blobs[0]) - -6)).toBeLessThan(3);
    expect(Math.abs(angleOf(seg.blobs[1]) - 9)).toBeLessThan(3);
  });

  it("recovers a range of angles", () => {
    for (const [l, r] of [[0, 0], [-15, 15], [12, -10], [25, 3]]) {
      const seg = find(feet(l, r));
      expect(seg.blobs).toHaveLength(2);
      expect(Math.abs(angleOf(seg.blobs[0]) - l)).toBeLessThan(2.5);
      expect(Math.abs(angleOf(seg.blobs[1]) - r)).toBeLessThan(2.5);
    }
  });

  it("finds nothing on an empty floor", () => {
    expect(find([]).blobs).toHaveLength(0);
  });

  it("fails gracefully (no feet) when the floor has the same colour as skin", () => {
    const skin: [number, number, number] = [98, 70, 58];
    const seg = find(feet(0, 0), { floor: skin, skin });
    expect(seg.blobs).toHaveLength(0);
  });

  it("flags a foot cut by the frame edge as clipped", () => {
    const seg = find([{ isLeft: true, x: 100, y: H - 18, alphaUp: 0, lengthPx: 60, widthPx: 23 }]);
    expect(seg.blobs).toHaveLength(1);
    expect(seg.blobs[0].clipped).toBe(true);
  });

  it("trims a shin that leaves the ankle at a different angle than the foot", () => {
    const states = feet(-4, 6, { legDeg: 14, legLenFrac: 1.2 }); // an unusually long, tilted shin
    const trimmed = find(states);
    const untrimmed = find(states, {}, { footAspect: 100 });
    expect(trimmed.blobs).toHaveLength(2);
    const errTrimmed = Math.abs(angleOf(trimmed.blobs[0]) - -4) + Math.abs(angleOf(trimmed.blobs[1]) - 6);
    expect(errTrimmed).toBeLessThan(6);
    if (untrimmed.blobs.length === 2) {
      const errUntrimmed = Math.abs(angleOf(untrimmed.blobs[0]) - -4) + Math.abs(angleOf(untrimmed.blobs[1]) - 6);
      expect(errUntrimmed).toBeGreaterThan(errTrimmed);
    }
  });
});

describe("helpers", () => {
  it("fitFootAxis returns the long axis pointing up", () => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let y = 0; y < 40; y++) for (let x = -5; x <= 5; x++) { xs.push(50 + x + y * 0.1); ys.push(100 + y); }
    const fit = fitFootAxis(xs, ys, 2.6);
    expect(fit.uy).toBeLessThan(0);
    expect(Math.abs(Math.atan2(fit.ux, -fit.uy) * (180 / Math.PI) + 5.7)).toBeLessThan(1.5); // slope 0.1 -> tilt toward -x going up
  });

  it("localStd is zero on a flat plane and large on a checkerboard", () => {
    const w = 12;
    const h = 12;
    const flat = new Float32Array(w * h).fill(5);
    expect(Math.max(...localStd(flat, w, h, 2))).toBeCloseTo(0, 3);
    const checker = Float32Array.from({ length: w * h }, (_, i) => ((i % w) + Math.floor(i / w)) % 2 ? 100 : 0);
    expect(localStd(checker, w, h, 2)[6 * w + 6]).toBeGreaterThan(40);
  });
});

describe("rendered walk -> segmentation -> analysis", () => {
  it("recovers known angles end to end from synthetic pixels (rug and shorts in view)", () => {
    const cfg = { leftDeg: 12, rightDeg: 4, fps: 10, durationSec: 4, width: W, height: H };
    const { times, states } = simulateFeet(cfg);
    const frames = times.map((t, i) => ({
      t,
      blobs: segmentFeet(renderFeetFrame(states[i], W, H, { rug: true, shorts: true, seed: 100 + i }), W, H).blobs,
    }));
    const seen = frames.filter((f) => f.blobs.length > 0).length;
    expect(seen).toBeGreaterThan(frames.length * 0.8);
    const r = analyzeTopDown(frames, { width: W, height: H, fps: 10, duration: 4 });
    expect(r.ok).toBe(true);
    expect(Math.abs((r.leftDeg as number) - 12)).toBeLessThan(3);
    expect(Math.abs((r.rightDeg as number) - 4)).toBeLessThan(3);
  });
});
