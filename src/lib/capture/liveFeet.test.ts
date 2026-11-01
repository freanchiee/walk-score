import { describe, expect, it } from "vitest";
import { learnFootSeed } from "../topdown/seed";
import { renderFeetFrame, type FootState, type SceneOptions } from "../topdown/synthetic";
import { countWholeFeet } from "./liveFeet";

/**
 * The live "Feet visible" chip looks at a 160 px wide picture; the foot is learned from a tap at the analysis size (240 px).
 * Synthetic scenes: they show the learned colour carries over between the two sizes, not how real socks behave.
 */

const feetAt = (k: number): FootState[] => [
  { isLeft: true, x: 96 * k, y: 300 * k, alphaUp: -8, lengthPx: 72 * k, widthPx: 28 * k },
  { isLeft: false, x: 146 * k, y: 302 * k, alphaUp: 5, lengthPx: 72 * k, widthPx: 28 * k },
];
const scene = (k: number, extra: SceneOptions = {}) => renderFeetFrame(feetAt(k), Math.round(240 * k), Math.round(427 * k), extra);

/** the toe gap of the left foot at the 240 px size */
const tap = { x: 96 + Math.sin((-8 * Math.PI) / 180) * 0.42 * 72, y: 300 - Math.cos((-8 * Math.PI) / 180) * 0.42 * 72 };

function seedFrom(extra: SceneOptions) {
  const res = learnFootSeed(scene(1, extra), 240, 427, tap);
  if ("error" in res) throw new Error(res.error);
  return res.seed;
}

describe("countWholeFeet (the live Feet visible check)", () => {
  const W = 160;
  const H = Math.round((427 * 160) / 240);
  const small = (extra: SceneOptions = {}) => scene(160 / 240, extra);

  it.each([
    ["blue socks", [40, 70, 150]],
    ["white socks", [235, 235, 235]],
    ["black socks", [30, 30, 34]],
  ] as const)("sees both %s at the live size after a tap learned at the analysis size, where the skin test sees none", (_n, skin) => {
    const extra: SceneOptions = { skin: [...skin] };
    expect(countWholeFeet(small(extra), W, H)).toBe(0);
    expect(countWholeFeet(small(extra), W, H, seedFrom(extra))).toBe(2);
  });

  it("keeps finding bare feet when the learned colour is another one (a frame the seed cannot read falls back to the skin test)", () => {
    expect(countWholeFeet(small(), W, H, seedFrom({ skin: [40, 70, 150] }))).toBe(2);
  });

  it("still reports an empty floor as no feet", () => {
    const empty = renderFeetFrame([], W, H, {});
    expect(countWholeFeet(empty, W, H)).toBe(0);
    expect(countWholeFeet(empty, W, H, seedFrom({ skin: [40, 70, 150] }))).toBe(0);
  });

  it("counts one foot as one", () => {
    const one = renderFeetFrame([feetAt(160 / 240)[0]], W, H, { skin: [40, 70, 150] });
    expect(countWholeFeet(one, W, H, seedFrom({ skin: [40, 70, 150] }))).toBe(1);
  });
});
