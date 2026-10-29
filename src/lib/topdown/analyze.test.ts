import { describe, expect, it } from "vitest";
import { analyzeTopDown, denseMode, type TopDownFrame, type TopDownOptions } from "./analyze";
import type { FootBlob } from "./segment";
import { generateBlobWalk, type TopDownWalkConfig } from "./synthetic";

describe("denseMode", () => {
  it("finds the tight cluster even when it is only about half of the samples (the median would not)", () => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 10; i++) {
      xs.push(i % 3); // planted cluster near (1, 250)
      ys.push(250 + (i % 4) * 4);
    }
    for (let i = 0; i < 9; i++) {
      xs.push(-30 + i * 7); // spread-out swing samples
      ys.push(-650 + i * 95);
    }
    const [mx, my] = denseMode(xs, ys, 30);
    expect(Math.abs(mx - 1)).toBeLessThan(3);
    expect(Math.abs(my - 255)).toBeLessThan(8);
  });

  it("returns the origin cluster for a static scene", () => {
    const xs = Array.from({ length: 20 }, (_, i) => (i % 5) - 2);
    const ys = Array.from({ length: 20 }, (_, i) => (i % 3) - 1);
    const [mx, my] = denseMode(xs, ys, 20);
    expect(Math.hypot(mx, my)).toBeLessThan(2);
  });
});

/**
 * Blob-level synthetic walks with known angles: these prove the top-down geometry (side assignment, ground-flow
 * walking direction, planted detection, signs) is self-consistent. They do not measure real-footage accuracy.
 */

function expectNear(actual: number | null, expected: number, tol: number) {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(tol);
}

function run(cfg: TopDownWalkConfig, opts: Partial<TopDownOptions> = {}) {
  const { frames, video, truth } = generateBlobWalk(cfg);
  return { result: analyzeTopDown(frames, video, opts), truth, frames, video };
}

describe("analyzeTopDown on blob-level synthetic walks", () => {
  it.each([
    [12, 5],
    [-4, 9],
    [0, 0],
    [20, 20],
    [-8, -8],
  ])("recovers left %i° / right %i° while walking (toe-out positive, toe-in negative)", (l, r) => {
    const { result } = run({ leftDeg: l, rightDeg: r });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("topdown");
    expectNear(result.leftDeg, l, 0.6);
    expectNear(result.rightDeg, r, 0.6);
    expectNear(result.asymmetryDeg, Math.abs(l - r), 1.2);
    expect(result.heading.fitted).toBe(true);
    expect(result.leftSteps).toBeGreaterThanOrEqual(2);
    expect(result.rightSteps).toBeGreaterThanOrEqual(2);
  });

  it("finds the walking direction from ground motion when the phone is rotated", () => {
    // (beyond ~30° the simulated feet leave the narrow frame sideways, so there is nothing to measure)
    for (const yaw of [-30, -15, 12]) {
      const { result } = run({ leftDeg: 10, rightDeg: 4, yawDeg: yaw });
      expect(result.ok).toBe(true);
      expectNear(result.heading.psiDeg, yaw, 1.5);
      expectNear(result.leftDeg, 10, 1);
      expectNear(result.rightDeg, 4, 1);
    }
  });

  it("keeps the left and right foot apart in every frame when the phone is rotated 10-20° and the steps are narrow", () => {
    // (the sides used to stay built for "up" unless the phone was rotated by more than about 20°, which swapped the feet in up to 40 % of the frames)
    for (const yaw of [10, 15, 20]) {
      const { result, frames } = run({ leftDeg: 12, rightDeg: 5, yawDeg: yaw, stepWidth: 0.1 });
      expect(result.ok).toBe(true);
      let checked = 0;
      frames.forEach((fr, i) => {
        for (const [side, expected] of [
          ["left", -12 + yaw],
          ["right", 5 + yaw],
        ] as const) {
          const bi = result.frames[i][side].blobIndex;
          if (bi === undefined || bi < 0) continue;
          const b = fr.blobs[bi];
          const alphaUp = (Math.atan2(b.ux, -b.uy) * 180) / Math.PI; // the blob's axis, degrees clockwise from the top of the picture
          expect(Math.abs(alphaUp - expected)).toBeLessThan(1);
          checked++;
        }
      });
      expect(checked).toBeGreaterThan(100);
    }
  });

  it.each([0.6, 1.1, 1.6])("works at a walking speed of %f m/s", (speed) => {
    const { result } = run({ leftDeg: 12, rightDeg: 5, speed, angleNoiseDeg: 1, seed: 5 });
    expect(result.ok).toBe(true);
    expectNear(result.leftDeg, 12, 2.5);
    expectNear(result.rightDeg, 5, 2.5);
  });

  it("copes with the phone held upside down (walking direction toward the bottom of the picture)", () => {
    const { result } = run({ leftDeg: 10, rightDeg: 4, yawDeg: 180 });
    expect(result.ok).toBe(true);
    expectNear(Math.abs(result.heading.psiDeg), 180, 2);
    expectNear(result.leftDeg, 10, 1);
    expectNear(result.rightDeg, 4, 1);
  });

  it("stays within a few degrees over 12 seeds with axis noise, centroid noise and phone sway (worst case: sway locked to the step)", () => {
    const errs: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const { result } = run({ leftDeg: 12, rightDeg: 5, angleNoiseDeg: 2, posNoisePx: 1, swayDeg: 3, yawDeg: 6, seed });
      expect(result.ok).toBe(true);
      errs.push(Math.abs((result.leftDeg as number) - 12), Math.abs((result.rightDeg as number) - 5));
    }
    const mae = errs.reduce((a, b) => a + b, 0) / errs.length;
    expect(mae).toBeLessThan(2);
    expect(Math.max(...errs)).toBeLessThan(4.5);
  });

  it("measures a standing stance when there is no ground motion, and says so", () => {
    const { result } = run({ leftDeg: -6, rightDeg: -3, speed: 0, angleNoiseDeg: 1, seed: 4 });
    expect(result.ok).toBe(true);
    expect(result.heading.fitted).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/standing/);
    expectNear(result.leftDeg, -6, 1.2);
    expectNear(result.rightDeg, -3, 1.2);
  });

  it("reports left/right according to the walking direction, and swapLeftRight flips them", () => {
    const base = run({ leftDeg: 14, rightDeg: 2 }).result;
    expectNear(base.leftDeg, 14, 0.8);
    expectNear(base.rightDeg, 2, 0.8);
    const swapped = run({ leftDeg: 14, rightDeg: 2 }, { swapLeftRight: true }).result;
    expectNear(swapped.leftDeg, 2, 0.8);
    expectNear(swapped.rightDeg, 14, 0.8);
  });

  it("applies per-foot calibration offsets", () => {
    const { result } = run({ leftDeg: 10, rightDeg: 10 }, { angleOffsetLeftDeg: -3, angleOffsetRightDeg: 2 });
    expectNear(result.leftDeg, 7, 0.8);
    expectNear(result.rightDeg, 12, 0.8);
  });

  it("ignores frames where a foot is cut by the frame edge unless allowed", () => {
    const cfg: TopDownWalkConfig = { leftDeg: 12, rightDeg: 5, coverage: 1.0 }; // zoomed in: feet get clipped
    const strict = run(cfg).result;
    const loose = run(cfg, { allowClipped: true }).result;
    const used = (r: typeof strict) => r.steps.filter((s) => s.used).length;
    expect(used(loose)).toBeGreaterThanOrEqual(used(strict));
  });

  it("keeps the step table consistent with the per-frame debug links", () => {
    const { result } = run({ leftDeg: 12, rightDeg: 5 });
    result.steps.forEach((s, idx) => {
      for (let i = s.startIdx; i <= s.endIdx; i++) expect(result.frames[i][s.foot].step).toBe(idx);
    });
  });

  it("is deterministic", () => {
    const a = run({ leftDeg: 9, rightDeg: 2, angleNoiseDeg: 2, posNoisePx: 1, seed: 11 }).result;
    const b = run({ leftDeg: 9, rightDeg: 2, angleNoiseDeg: 2, posNoisePx: 1, seed: 11 }).result;
    expect(a.leftDeg).toBe(b.leftDeg);
    expect(a.rightDeg).toBe(b.rightDeg);
  });
});

/**
 * A hand-held phone also moves sideways with each stride (a few cm) and yaws a few degrees, so the left foot's planted
 * velocity leans one way and the right foot's the other. Synthetic phases are gait-like (camera over the stance foot
 * at mid-stance, yaw crossing zero there); the numbers come from this simulator, not from real footage.
 */
describe("walking direction under side-to-side phone sway", () => {
  const base: TopDownWalkConfig = { leftDeg: 12, rightDeg: 5, angleNoiseDeg: 1, posNoisePx: 0.7 };

  function mae(cfg: Partial<TopDownWalkConfig>, opts: Partial<TopDownOptions> = {}) {
    const errs: number[] = [];
    for (const seed of [1, 2, 3, 4]) {
      const { result } = run({ ...base, ...cfg, seed }, opts);
      expect(result.ok).toBe(true);
      errs.push(Math.abs((result.leftDeg as number) - base.leftDeg), Math.abs((result.rightDeg as number) - base.rightDeg));
    }
    return errs.reduce((a, b) => a + b, 0) / errs.length;
  }

  it("stays within about 1.5° with 3° of yaw sway and 2.5 cm of sideways sway", () => {
    const cfg = { swayDeg: 3, swayPerStride: true, swayPhaseDeg: 270, lateralM: 0.025, lateralPhaseDeg: 162 };
    expect(mae(cfg)).toBeLessThan(1.5);
  });

  it("averages the two feet's flow clusters instead of picking the single densest one", () => {
    // 4 cm of sideways sway splits the feet's planted velocities by about 15°; the densest cluster is only one of them
    const cfg = { lateralM: 0.04, lateralPhaseDeg: 45 };
    expect(mae(cfg)).toBeLessThan(1);
    expect(mae(cfg, { balanceFeet: false })).toBeGreaterThan(3);
  });

  it("can take part of the direction from each stance's own foot motion (opt-in) to cancel yaw sway", () => {
    const cfg = { swayDeg: 3, swayPerStride: true, swayPhaseDeg: 300, lateralM: 0.025, lateralPhaseDeg: 162 };
    expect(mae(cfg, { headingBlend: 0.5 })).toBeLessThan(mae(cfg));
    expect(mae({}, { headingBlend: 0.5 })).toBeLessThan(0.8); // and costs nothing when the phone is steady
  });
});

describe("what the phone's sensors add to the analysis", () => {
  const turn = (b: FootBlob, deg: number): FootBlob => {
    const t = (deg * Math.PI) / 180; // clockwise on screen
    return { ...b, ux: b.ux * Math.cos(t) - b.uy * Math.sin(t), uy: b.ux * Math.sin(t) + b.uy * Math.cos(t) };
  };

  it("leaves frames marked unreliable (phone tilted) out of the angle averaging", () => {
    const { frames, video } = generateBlobWalk({ leftDeg: 12, rightDeg: 5 });
    // from frame 20 on, every foot axis reads 15° off (a tilted phone), and the sensors say so
    const tilted = frames.map((f, i) => (i >= 20 ? { ...f, blobs: f.blobs.map((b) => turn(b, 15)) } : f));
    const flagged = tilted.map((f, i) => (i >= 20 ? { ...f, tiltDeg: 20, reliable: false } : f));
    const raw = analyzeTopDown(tilted, video);
    const gated = analyzeTopDown(flagged, video);
    expect(raw.ok).toBe(true);
    expectNear(raw.leftDeg, 12 - 15, 1.5); // believed: a 15° error
    expect(gated.ok).toBe(true);
    expectNear(gated.leftDeg, 12, 0.6);
    expectNear(gated.rightDeg, 5, 0.6);
    expect(gated.leftSteps).toBeLessThan(raw.leftSteps);
    // the walking direction still comes from every frame: unreliable ones are only kept out of the angles
    expectNear(gated.heading.psiDeg, raw.heading.psiDeg, 0.5);
  });

  it("with every frame unreliable there is nothing to measure", () => {
    const { frames, video } = generateBlobWalk({ leftDeg: 12, rightDeg: 5 });
    const r = analyzeTopDown(frames.map((f) => ({ ...f, reliable: false })), video);
    expect(r.ok).toBe(false);
  });

  // heel strikes of the simulator: the left foot lands at k * period, the right at period / 2 + k * period, period = 1.3 m / 1.1 m/s
  const strikes = Array.from({ length: 9 }, (_, k) => (k * 1.3) / 1.1 / 2);

  it("accelerometer step timing keeps the angles and trusts a stance a step explains over one nothing explains", () => {
    const { frames, video } = generateBlobWalk({ leftDeg: 12, rightDeg: 5, angleNoiseDeg: 1, seed: 3 });
    const base = analyzeTopDown(frames, video);
    const timed = analyzeTopDown(frames, video, { stepTimesSec: strikes });
    const offBeat = analyzeTopDown(frames, video, { stepTimesSec: strikes.map((t) => t + 0.3) }); // half a step out: no strike near any stance start
    expect(timed.ok).toBe(true);
    expectNear(timed.leftDeg, base.leftDeg as number, 0.6);
    expectNear(timed.rightDeg, base.rightDeg as number, 0.6);
    const conf = (r: typeof base) => r.steps.reduce((s, x) => s + x.confidence, 0) / r.steps.length;
    expect(conf(timed)).toBeGreaterThan(conf(offBeat));
    expect(conf(offBeat)).toBeLessThan(conf(base) * 0.9); // the 15 % penalty
    expect(analyzeTopDown(frames, video, { stepTimesSec: [] }).leftDeg).toBe(base.leftDeg); // no timing: nothing changes
  });
});

describe("analyzeTopDown failure modes", () => {
  it("fails with too_short for a tiny clip", () => {
    const { frames, video } = generateBlobWalk({ leftDeg: 10, rightDeg: 5 });
    const r = analyzeTopDown(frames.slice(0, 6), video);
    expect(r.ok).toBe(false);
    expect(r.failure?.code).toBe("too_short");
  });

  it("fails with no_feet when feet are almost never found", () => {
    const { frames, video } = generateBlobWalk({ leftDeg: 10, rightDeg: 5 });
    const sparse: TopDownFrame[] = frames.map((f, i) => (i % 8 === 0 ? f : { t: f.t, blobs: [] }));
    const r = analyzeTopDown(sparse, video);
    expect(r.ok).toBe(false);
    expect(r.failure?.code).toBe("no_feet");
    expect(r.failure?.message).toMatch(/bare feet/);
  });

  it("fails per foot when one foot is never seen", () => {
    const { frames, video } = generateBlobWalk({ leftDeg: 10, rightDeg: 5 });
    const leftOnly: TopDownFrame[] = frames.map((f) => ({
      t: f.t,
      // keep only the blob that is on the left of the picture centre
      blobs: f.blobs.filter((b) => b.cx < 0.5),
    }));
    const r = analyzeTopDown(leftOnly, video);
    expect(r.ok).toBe(false);
    expect(["no_steps_right", "no_steps"]).toContain(r.failure?.code);
  });

  it("rejects blobs below the score threshold", () => {
    const { frames, video } = generateBlobWalk({ leftDeg: 10, rightDeg: 5 });
    const weak: TopDownFrame[] = frames.map((f) => ({ t: f.t, blobs: f.blobs.map((b) => ({ ...b, score: 0.2 })) }));
    const r = analyzeTopDown(weak, video);
    expect(r.ok).toBe(false);
    expect(r.failure?.code).toBe("no_feet");
  });
});
