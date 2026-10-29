import { describe, expect, it } from "vitest";
import { close, componentStats, dilate, erode, labelComponents, open, orientation } from "./blobs";

function rect(w: number, h: number, x0: number, y0: number, x1: number, y1: number, m = new Uint8Array(w * h)) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * w + x] = 1;
  return m;
}
const sum = (m: Uint8Array) => m.reduce((s, v) => s + v, 0);

describe("morphology", () => {
  const W = 20;
  const H = 20;
  it("erosion shrinks and dilation grows a block", () => {
    const m = rect(W, H, 5, 5, 14, 14);
    expect(sum(erode(m, W, H))).toBe(8 * 8);
    expect(sum(dilate(m, W, H))).toBe(12 * 12 - 4); // cross dilation: a 12x12 block without its 4 corners
  });

  it("opening removes thin lines but keeps blobs", () => {
    const m = rect(W, H, 3, 3, 12, 12);
    rect(W, H, 0, 17, 19, 17, m); // 1px line
    const o = open(m, W, H);
    expect(o[17 * W + 5]).toBe(0);
    expect(o[8 * W + 8]).toBe(1);
  });

  it("closing fills a 1px gap", () => {
    const m = rect(W, H, 3, 3, 16, 16);
    m[10 * W + 10] = 0;
    expect(close(m, W, H)[10 * W + 10]).toBe(1);
  });
});

describe("components", () => {
  it("labels separate blobs and merges U-shapes", () => {
    const W = 24;
    const H = 12;
    const m = rect(W, H, 1, 1, 4, 10);
    rect(W, H, 8, 1, 11, 10, m);
    rect(W, H, 4, 10, 8, 10, m); // bridge: makes one U-shaped component
    rect(W, H, 16, 2, 20, 5, m);
    const { labels, count } = labelComponents(m, W, H);
    expect(count).toBe(2);
    const comps = componentStats(labels, W, H, count);
    expect(comps.map((c) => c.area).sort((a, b) => b - a)).toEqual([sum(m) - 20, 20]);
  });

  it("reports border contact, centroid and orientation of a tilted bar", () => {
    const W = 60;
    const H = 60;
    const m = new Uint8Array(W * H);
    // bar of length ~30, width ~5, tilted 20 degrees clockwise from vertical (toward +x going up)
    const ang = (20 * Math.PI) / 180;
    for (let t = -15; t <= 15; t += 0.25) {
      for (let s = -2.5; s <= 2.5; s += 0.25) {
        const x = Math.round(30 + t * Math.sin(ang) + s * Math.cos(ang));
        const y = Math.round(30 - t * Math.cos(ang) + s * Math.sin(ang));
        m[y * W + x] = 1;
      }
    }
    const { labels, count } = labelComponents(m, W, H);
    const [c] = componentStats(labels, W, H, count);
    expect(c.cx).toBeCloseTo(30, 0);
    expect(c.cy).toBeCloseTo(30, 0);
    expect(c.touchesLeft || c.touchesTop || c.touchesBottom || c.touchesRight).toBe(false);
    const o = orientation(c.mu20, c.mu02, c.mu11);
    expect(o.elongation).toBeGreaterThan(3);
    const deg = (Math.atan2(o.ux, -o.uy) * 180) / Math.PI;
    const folded = ((deg % 180) + 180) % 180; // axis has no sign
    expect(Math.min(Math.abs(folded - 20), Math.abs(folded - 200))).toBeLessThan(2);
  });

  it("flags components that touch the frame edge", () => {
    const W = 10;
    const H = 10;
    const m = rect(W, H, 0, 3, 4, 6);
    const { labels, count } = labelComponents(m, W, H);
    const [c] = componentStats(labels, W, H, count);
    expect(c.touchesLeft).toBe(true);
    expect(c.touchesRight).toBe(false);
  });
});
