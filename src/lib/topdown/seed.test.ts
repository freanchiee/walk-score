import { describe, expect, it } from "vitest";
import { analyzeTopDown, cardinalDirection } from "./analyze";
import {
  directionDeg,
  learnFootSeed,
  NOT_A_FOOT,
  SEED_DISAGREES_DEG,
  seededSegmentOptions,
  seedSummary,
  seedWarnings,
  type FootSeed,
  type SeedFound,
} from "./seed";
import { segmentFeet, type FootBlob } from "./segment";
import { generateBlobWalk, renderFeetFrame, simulateFeet, type FootState, type SceneOptions } from "./synthetic";

/**
 * A tap on the gap between the big toe and the next toe teaches the feet finder what this person's foot looks like.
 * Synthetic scenes with known angles: they show the idea works on clean rendered feet in colours the generic skin test cannot
 * see (socks), not how well it works on real footage.
 */

const W = 200;
const H = 356;
const angleOf = (b: FootBlob) => (Math.atan2(b.ux, -b.uy) * 180) / Math.PI; // clockwise from image-up

const feet = (leftAlpha: number, rightAlpha: number): FootState[] => [
  { isLeft: true, x: 80, y: 250, alphaUp: leftAlpha, lengthPx: 60, widthPx: 23 },
  { isLeft: false, x: 122, y: 252, alphaUp: rightAlpha, lengthPx: 60, widthPx: 23 },
];

/** a point `frac` foot-lengths ahead of the foot centre along its toes (0.42 is about the gap between the big toe and the next) */
const along = (s: FootState, frac = 0.42, across = 0) => {
  const a = (s.alphaUp * Math.PI) / 180;
  return { x: s.x + Math.sin(a) * frac * s.lengthPx + Math.cos(a) * across, y: s.y - Math.cos(a) * frac * s.lengthPx + Math.sin(a) * across };
};

const render = (states: FootState[], scene: SceneOptions = {}) => renderFeetFrame(states, W, H, scene);

function learn(states: FootState[], scene: SceneOptions, tap = along(states[0])): SeedFound {
  const res = learnFootSeed(render(states, scene), W, H, tap, 1.5);
  if ("error" in res) throw new Error(res.error);
  return res;
}

describe("learnFootSeed", () => {
  it("learns a foot from a tap between the toes, and points at the toes", () => {
    const states = feet(-8, 5);
    const r = learn(states, {});
    const a = (-8 * Math.PI) / 180;
    expect(r.seed.t).toBe(1.5);
    expect(r.seed.area).toBeGreaterThan(0.01);
    expect(r.seed.area).toBeLessThan(0.05);
    // toes point along (sin a, -cos a), the toe end is near the tip of the forefoot, the heel end back toward the ankle
    expect(r.seed.toeDir).not.toBeNull();
    const [dx, dy] = r.seed.toeDir as [number, number];
    expect(dx * Math.sin(a) + dy * -Math.cos(a)).toBeGreaterThan(0.99);
    const tip = along(states[0], 0.52);
    expect(Math.hypot(r.toe[0] - tip.x, r.toe[1] - tip.y)).toBeLessThan(6);
    expect(Math.hypot(r.heel[0] - r.toe[0], r.heel[1] - r.toe[1])).toBeGreaterThan(0.6 * 60);
    // the region covers the tapped foot and not the other one
    expect(r.region[Math.round(states[0].y) * W + Math.round(states[0].x)]).toBe(1);
    expect(r.region[Math.round(states[1].y) * W + Math.round(states[1].x)]).toBe(0);
  });

  it("does not claim a direction when the tap is in the middle of the foot", () => {
    const states = feet(-8, 5);
    const r = learn(states, {}, along(states[0], 0));
    expect(r.seed.toeDir).toBeNull();
  });

  it("copes with a tap a little off the exact spot", () => {
    const states = feet(-6, 9);
    for (const [frac, across] of [[0.36, 0], [0.46, 0], [0.42, 5], [0.42, -5], [0.3, 3]] as const) {
      const r = learn(states, {}, along(states[0], frac, across));
      expect(r.seed.area).toBeGreaterThan(0.01);
    }
  });

  it("says so when the tap is on the floor", () => {
    const res = learnFootSeed(render(feet(-8, 5)), W, H, { x: 30, y: 60 });
    expect(res).toEqual({ error: NOT_A_FOOT.floor });
  });

  it("does not take a striped rug for a foot", () => {
    const res = learnFootSeed(render(feet(-8, 5), { rug: true }), W, H, { x: 55, y: 190 });
    expect("error" in res).toBe(true);
  });

  it("accepts a foot that points toward the bottom of the picture, with the toes marked by the tap", () => {
    const states: FootState[] = [{ isLeft: true, x: 100, y: 180, alphaUp: 180, lengthPx: 60, widthPx: 23 }];
    const r = learn(states, {}, along(states[0]));
    expect(r.seed.toeDir).not.toBeNull();
    const [dx, dy] = r.seed.toeDir as [number, number];
    expect(dy).toBeGreaterThan(0.95); // toes point down the picture
    expect(Math.abs(dx)).toBeLessThan(0.2);
  });
});

describe("a tap lets the finder read feet the generic skin test cannot see", () => {
  it.each([
    ["blue socks", [40, 70, 150]],
    ["white socks", [235, 235, 235]],
    ["black socks", [30, 30, 34]],
    ["green socks", [60, 150, 80]],
  ] as const)("%s", (_name, skin) => {
    const states = feet(-8, 5);
    const scene: SceneOptions = { skin: [...skin] };
    expect(segmentFeet(render(states, scene), W, H).blobs).toHaveLength(0); // the generic test sees no feet at all

    const { seed } = learn(states, scene);
    const seg = segmentFeet(render(states, scene), W, H, seededSegmentOptions(seed));
    expect(seg.seeded).toBe(true);
    expect(seg.blobs).toHaveLength(2);
    expect(Math.abs(angleOf(seg.blobs[0]) - -8)).toBeLessThan(3);
    expect(Math.abs(angleOf(seg.blobs[1]) - 5)).toBeLessThan(3);
  });

  it("keeps a rug and light shorts out of the picture of blue socks", () => {
    const states = feet(-8, 5);
    const scene: SceneOptions = { skin: [40, 70, 150], rug: true, shorts: true };
    const { seed } = learn(states, scene);
    const seg = segmentFeet(render(states, scene), W, H, seededSegmentOptions(seed));
    expect(seg.blobs).toHaveLength(2);
    expect(Math.abs(angleOf(seg.blobs[0]) - -8)).toBeLessThan(3);
    expect(Math.abs(angleOf(seg.blobs[1]) - 5)).toBeLessThan(3);
  });

  it("falls back to the generic test in a frame where the learned colour finds nothing", () => {
    const states = feet(-8, 5);
    const { seed } = learn(states, { skin: [40, 70, 150] });
    const seg = segmentFeet(render(states), W, H, seededSegmentOptions(seed)); // normal skin in this frame
    expect(seg.seeded).toBe(false);
    expect(seg.blobs).toHaveLength(2);
  });

  it("only relaxes the generic size limits, never tightens them", () => {
    const { seed } = learn(feet(-8, 5), {});
    const o = seededSegmentOptions(seed);
    expect(o.minAreaFrac).toBeGreaterThanOrEqual(0.004);
    expect(o.maxAreaFrac).toBeGreaterThanOrEqual(0.14);
    expect(o.maxTextureStd).toBeGreaterThanOrEqual(9);
  });

  it("reads a whole walk in blue socks end to end, where the generic finder gives up", () => {
    const cfg = { leftDeg: 12, rightDeg: 4, fps: 10, durationSec: 4, width: W, height: H };
    const { times, states } = simulateFeet(cfg);
    const scene = (i: number): SceneOptions => ({ skin: [40, 70, 150], rug: true, shorts: true, seed: 100 + i });
    const video = { width: W, height: H, fps: 10, duration: 4 };

    const generic = times.map((t, i) => ({ t, blobs: segmentFeet(render(states[i], scene(i)), W, H).blobs }));
    expect(analyzeTopDown(generic, video).ok).toBe(false);

    const first = learnFootSeed(render(states[8], scene(8)), W, H, along(states[8].find((s) => s.isLeft) as FootState), times[8]);
    if ("error" in first) throw new Error(first.error);
    const opts = seededSegmentOptions(first.seed);
    const seeded = times.map((t, i) => ({ t, blobs: segmentFeet(render(states[i], scene(i)), W, H, opts).blobs }));
    expect(seeded.filter((f) => f.blobs.length > 0).length).toBeGreaterThan(seeded.length * 0.8);
    const r = analyzeTopDown(seeded, video);
    expect(r.ok).toBe(true);
    expect(Math.abs((r.leftDeg as number) - 12)).toBeLessThan(3);
    expect(Math.abs((r.rightDeg as number) - 4)).toBeLessThan(3);
  });
});

describe("using the tapped toes in the analysis", () => {
  it("cardinalDirection snaps to the nearest edge of the picture, and means 'up' without a direction", () => {
    expect(cardinalDirection(null)).toEqual([0, -1]);
    expect(cardinalDirection([0, 0])).toEqual([0, -1]);
    expect(cardinalDirection([0.17, -0.98])).toEqual([0, -1]);
    expect(cardinalDirection([-0.3, 0.95])).toEqual([0, 1]);
    expect(cardinalDirection([0.9, 0.2])).toEqual([1, 0]);
    expect(cardinalDirection([-0.8, -0.3])).toEqual([-1, 0]);
  });

  it("reads a standing clip taken with the phone upside down once the tapped toes say which way is forward", () => {
    // standing still, the whole picture turned half way round: left foot toe-out 12°, right foot toe-out 4°
    const { frames, video } = generateBlobWalk({ leftDeg: 12, rightDeg: 4, speed: 0, yawDeg: 180, durationSec: 4, fps: 10 });
    const assumedUp = analyzeTopDown(frames, video);
    expect(assumedUp.standing).toBe(true);
    // without the hint the top edge is taken as forward: the feet swap sides and both read as toe-in (the failure the hint fixes)
    expect(Math.abs((assumedUp.leftDeg as number) - -4)).toBeLessThan(2);
    expect(Math.abs((assumedUp.rightDeg as number) - -12)).toBeLessThan(2);

    const hinted = analyzeTopDown(frames, video, { seedToeDir: [0.05, 0.99] }); // toes point down the picture
    expect(hinted.standing).toBe(true);
    expect(Math.abs((hinted.leftDeg as number) - 12)).toBeLessThan(2);
    expect(Math.abs((hinted.rightDeg as number) - 4)).toBeLessThan(2);
    expect(hinted.warnings.join(" ")).toContain("toes you marked");
  });

  it("leaves a normal standing clip alone when the tapped toes point up", () => {
    const { frames, video } = generateBlobWalk({ leftDeg: 12, rightDeg: 4, speed: 0, durationSec: 4, fps: 10 });
    const plain = analyzeTopDown(frames, video);
    const hinted = analyzeTopDown(frames, video, { seedToeDir: [0.1, -0.99] });
    expect(hinted.leftDeg).toBeCloseTo(plain.leftDeg as number, 6);
    expect(hinted.rightDeg).toBeCloseTo(plain.rightDeg as number, 6);
    expect(hinted.warnings.join(" ")).toContain("assuming the top of the phone points forward");
  });

  it("never changes a walking clip: the ground flow decides, even if the tapped toes point elsewhere", () => {
    const { frames, video } = generateBlobWalk({ leftDeg: 12, rightDeg: 4, durationSec: 5, fps: 10 });
    const plain = analyzeTopDown(frames, video);
    expect(plain.standing).toBe(false);
    const hinted = analyzeTopDown(frames, video, { seedToeDir: [0, 1] }); // a heel tap, say
    expect(hinted.leftDeg).toBeCloseTo(plain.leftDeg as number, 6);
    expect(hinted.rightDeg).toBeCloseTo(plain.rightDeg as number, 6);
  });
});

describe("what a tap reports", () => {
  const seedAt = (toeAngle: number | null): FootSeed => ({
    tap: { x: 0.4, y: 0.6 },
    t: 1,
    colour: { mean: [30, 12, 14], sd: [8, 3, 3] },
    area: 0.02,
    length: 0.17,
    width: 0.07,
    toeDir: toeAngle === null ? null : [Math.sin((toeAngle * Math.PI) / 180), -Math.cos((toeAngle * Math.PI) / 180)],
  });

  it("measures the toes against the walking direction", () => {
    expect(directionDeg([0, -1])).toBeCloseTo(0, 6);
    expect(directionDeg([1, 0])).toBeCloseTo(90, 6);
    expect(directionDeg([0, 1])).toBeCloseTo(180, 6);
    const s = seedSummary(seedAt(12), { seededFrames: 40, fallbackFrames: 2 }, { psiDeg: 5, fitted: true });
    expect(s.toeAngleDeg).toBeCloseTo(12, 6);
    expect(s.vsWalkingDeg).toBeCloseTo(7, 6);
    expect(s.setDirection).toBe(false);
    expect(seedWarnings(s)).toEqual([]);
    // across the 180° wrap
    const wrap = seedSummary(seedAt(170), { seededFrames: 40, fallbackFrames: 0 }, { psiDeg: -170, fitted: true });
    expect(wrap.vsWalkingDeg).toBeCloseTo(20, 6);
  });

  it("warns when the toes you marked point somewhere very different from where you walked", () => {
    const s = seedSummary(seedAt(170), { seededFrames: 40, fallbackFrames: 0 }, { psiDeg: 4, fitted: true });
    expect(s.vsWalkingDeg).toBeGreaterThan(SEED_DISAGREES_DEG);
    const w = seedWarnings(s);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("166°");
  });

  it("warns when the learned colour found the feet in only a few frames", () => {
    const w = seedWarnings(seedSummary(seedAt(0), { seededFrames: 10, fallbackFrames: 30 }, { psiDeg: 0, fitted: true }));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("25%");
  });

  it("has no angle to compare for a standing clip or a tap away from the toes, and notes when the toes set the direction", () => {
    expect(seedSummary(seedAt(null), { seededFrames: 5, fallbackFrames: 0 }, { psiDeg: 0, fitted: true }).vsWalkingDeg).toBeNull();
    const standing = seedSummary(seedAt(178), { seededFrames: 5, fallbackFrames: 0 }, { psiDeg: 180, fitted: false }, [0, 1]);
    expect(standing.vsWalkingDeg).toBeNull();
    expect(standing.setDirection).toBe(true);
    expect(seedSummary(seedAt(3), { seededFrames: 5, fallbackFrames: 0 }, { psiDeg: 0, fitted: false }, [0, -1]).setDirection).toBe(false);
  });
});
