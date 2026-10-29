import { describe, expect, it } from "vitest";
import {
  closeGaps,
  findRuns,
  gaussianSmooth,
  localSlope,
  median,
  percentile,
  robustSigma,
  theilSen,
  unroll,
  weightedMean,
  weightedMedian,
} from "./math";

describe("robust statistics", () => {
  it("median ignores non-finite values", () => {
    expect(median([3, NaN, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNaN();
  });

  it("robustSigma is insensitive to outliers", () => {
    const clean = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(robustSigma([...clean, 1000])).toBeLessThan(robustSigma(clean) * 1.5);
  });

  it("percentile interpolates", () => {
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6);
  });

  it("weightedMedian follows the weights", () => {
    expect(weightedMedian([1, 2, 10], [1, 1, 10])).toBe(10);
    expect(weightedMedian([1, 2, 10], [1, 1, 0])).toBe(1.5);
    expect(weightedMedian([1, 2, 3], [0, 0, 0])).toBe(2);
  });

  it("weightedMean weights and falls back to the mean", () => {
    expect(weightedMean([0, 10], [3, 1])).toBeCloseTo(2.5);
    expect(weightedMean([2, 4], [0, 0])).toBe(3);
  });

  it("theilSen recovers a line despite outliers", () => {
    const xs = Array.from({ length: 30 }, (_, i) => i);
    const ys = xs.map((x) => 2 * x + 1);
    ys[3] = 500;
    ys[20] = -300;
    const fit = theilSen(xs, ys);
    expect(fit?.slope).toBeCloseTo(2, 5);
    expect(fit?.intercept).toBeCloseTo(1, 5);
    expect(theilSen([1, 2], [1, 2])).toBeNull();
  });

  it("localSlope fits a straight ramp", () => {
    const y = Array.from({ length: 20 }, (_, i) => 3 * i);
    expect(localSlope(y, 10, 3)).toBeCloseTo(3);
    expect(localSlope([1, NaN, NaN, NaN, 5], 2, 2)).toBeNaN();
  });
});

describe("gaussianSmooth", () => {
  it("fills short gaps but leaves long gaps empty", () => {
    const v = [1, 1, NaN, 1, 1, NaN, NaN, NaN, NaN, NaN, 1, 1];
    const out = gaussianSmooth(v, 1, 2);
    expect(out[2]).toBeCloseTo(1);
    expect(Number.isNaN(out[7])).toBe(true);
  });

  it("smooths noise without shifting a constant", () => {
    const out = gaussianSmooth(new Array(30).fill(5), 2, 2);
    out.forEach((x) => expect(x).toBeCloseTo(5));
  });
});

describe("mask helpers", () => {
  it("findRuns returns inclusive ranges", () => {
    expect(findRuns([0, 1, 1, 0, 1, 0, 1, 1])).toEqual([[1, 2], [4, 4], [6, 7]]);
  });

  it("closeGaps bridges only short gaps between true values that are allowed", () => {
    const mask = Uint8Array.from([1, 1, 0, 1, 1, 0, 0, 0, 1]);
    const allowed = [1, 1, 1, 1, 1, 1, 1, 1, 1];
    expect(Array.from(closeGaps(mask, allowed, 1))).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 1]);
    const blocked = [1, 1, 0, 1, 1, 1, 1, 1, 1];
    expect(Array.from(closeGaps(mask, blocked, 1))).toEqual([1, 1, 0, 1, 1, 0, 0, 0, 1]);
  });
});

describe("unroll", () => {
  it("makes a clockwise-tilted vertical vector vertical again", () => {
    const tau = (10 * Math.PI) / 180;
    const up = [Math.sin(tau), -Math.cos(tau)]; // "up" tilted clockwise on screen (y down)
    const [x, y] = unroll(up[0], up[1], tau);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(-1);
  });
});
