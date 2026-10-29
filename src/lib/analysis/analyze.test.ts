import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { generateSyntheticWalk, type SyntheticWalkConfig } from "./synthetic";
import type { AnalysisOptions, PoseFrame } from "./types";

/**
 * These tests use SYNTHETIC landmarks with known foot angles. They prove the geometry (signs, heading
 * correction, stance detection) is self-consistent. They say nothing about how accurate MediaPipe is on
 * real footage - that is what /validate is for.
 */

function expectNear(actual: number | null, expected: number, tol: number) {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(tol);
}

function run(cfg: SyntheticWalkConfig, opts: Partial<AnalysisOptions> = {}) {
  const { frames, video, truth } = generateSyntheticWalk(cfg);
  return { result: analyze(frames, video, opts), truth, frames, video };
}

describe.each(["world", "image"] as const)("analyze (%s estimator) on synthetic walks", (method) => {
  // The image-plane estimator is an approximation (assumed body proportions), so it gets a looser bound.
  const tol = method === "world" ? 0.5 : 1.5;

  it.each([
    [12, 5],
    [-4, 9],
    [0, 0],
    [20, 20],
  ])("recovers left %i° / right %i° on a centred walk (toe-out positive, toe-in negative)", (l, r) => {
    const { result } = run({ leftDeg: l, rightDeg: r }, { method });
    expect(result.ok).toBe(true);
    expectNear(result.leftDeg, l, tol);
    expectNear(result.rightDeg, r, tol);
    expectNear(result.asymmetryDeg, Math.abs(l - r), 2 * tol);
    expect(result.quality).toBe("good");
  });

  it("recovers angles for an off-centre walker aimed at the phone (heading fitted)", () => {
    const { result, truth } = run({ leftDeg: 12, rightDeg: 5, startX: 1 }, { method });
    expect(result.ok).toBe(true);
    expectNear(result.heading.psiDeg, truth.headingDeg, 1);
    expectNear(result.leftDeg, 12, tol);
    expectNear(result.rightDeg, 5, tol);
  });

  it("recovers angles for an off-centre walker walking parallel to the optical axis", () => {
    const { result } = run({ leftDeg: 12, rightDeg: 5, startX: 1, aim: "parallel" }, { method });
    expect(result.ok).toBe(true);
    expectNear(result.leftDeg, 12, tol);
    expectNear(result.rightDeg, 5, tol);
  });

  it("removes phone roll", () => {
    const { result } = run({ leftDeg: 12, rightDeg: 5, rollDeg: 8 }, { method });
    expect(result.ok).toBe(true);
    expectNear(result.heading.rollDeg, 8, 1);
    expectNear(result.leftDeg, 12, tol);
    expectNear(result.rightDeg, 5, tol);
  });

  it("stays within a few degrees at moderate white noise (3 px, 2 cm)", () => {
    const { result } = run({ leftDeg: 12, rightDeg: 5, noisePx: 3, noiseWorldM: 0.02, seed: 7 }, { method });
    expect(result.ok).toBe(true);
    expectNear(result.leftDeg, 12, 3);
    expectNear(result.rightDeg, 5, 3);
  });

  it("survives 15% of frames having no pose", () => {
    const { result } = run({ leftDeg: 12, rightDeg: 5, dropoutRate: 0.15, seed: 3 }, { method });
    expect(result.ok).toBe(true);
    expectNear(result.leftDeg, 12, 2 * tol);
    expectNear(result.rightDeg, 5, 2 * tol);
  });
});

describe("analyze: options and failure modes", () => {
  it("heading 'camera' is biased for an off-centre walker who is not aiming at the phone (why the path fit exists)", () => {
    const cfg: SyntheticWalkConfig = { leftDeg: 12, rightDeg: 5, startX: 1, aim: "parallel" };
    const withPath = run(cfg, { heading: "path" }).result;
    const withCamera = run(cfg, { heading: "camera" }).result;
    expectNear(withPath.leftDeg, 12, 0.5);
    expect(Math.abs((withCamera.leftDeg as number) - 12)).toBeGreaterThan(4);
  });

  it("supports world landmarks expressed in the camera-axis frame", () => {
    const { result } = run({ leftDeg: 12, rightDeg: 5, startX: 1, worldFrame: "axis" }, { worldFrame: "axis" });
    expect(result.ok).toBe(true);
    expectNear(result.leftDeg, 12, 0.5);
    expectNear(result.rightDeg, 5, 0.5);
  });

  it("swapLeftRight reports the mirrored assignment", () => {
    const { result } = run({ leftDeg: 12, rightDeg: 5 }, { swapLeftRight: true });
    expectNear(result.leftDeg, 5, 0.5);
    expectNear(result.rightDeg, 12, 0.5);
    expect(result.steps.every((s) => s.foot === "left" || s.foot === "right")).toBe(true);
  });

  it("keeps the step table consistent with per-frame debug links", () => {
    const { result } = run({ leftDeg: 12, rightDeg: 5 });
    result.steps.forEach((s, idx) => {
      for (let i = s.startIdx; i <= s.endIdx; i++) expect(result.frames[i][s.foot].step).toBe(idx);
    });
  });

  it("fails with no_approach when the person stands still", () => {
    const { result } = run({ leftDeg: 12, rightDeg: 5, standStill: true });
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe("no_approach");
  });

  it("fails with no_approach when the clip is played backwards (walking away)", () => {
    const { frames, video } = generateSyntheticWalk({ leftDeg: 12, rightDeg: 5 });
    const reversed: PoseFrame[] = frames
      .slice()
      .reverse()
      .map((f, i) => ({ ...f, t: i / video.fps }));
    const result = analyze(reversed, video);
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe("no_approach");
  });

  it("fails with too_short for a tiny clip", () => {
    const { frames, video } = generateSyntheticWalk({ leftDeg: 12, rightDeg: 5 });
    const result = analyze(frames.slice(0, 8), video);
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe("too_short");
  });

  it("fails with no_pose when a person is rarely detected", () => {
    const { frames, video } = generateSyntheticWalk({ leftDeg: 12, rightDeg: 5 });
    const sparse = frames.map((f, i) => (i % 10 === 0 ? f : { ...f, ok: false, img: null, world: null }));
    const result = analyze(sparse, video);
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe("no_pose");
  });

  it("fails per foot when one foot is never visible", () => {
    const { frames, video } = generateSyntheticWalk({ leftDeg: 12, rightDeg: 5 });
    const hidden = frames.map((f) => {
      if (!f.img) return f;
      const img = f.img.map((p, i) => (i === 30 || i === 32 ? { ...p, v: 0.05 } : p));
      return { ...f, img };
    });
    const result = analyze(hidden, video);
    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe("no_steps_right");
    expect(result.leftDeg).not.toBeNull();
  });

  it("warns when the model's left foot is on the image-left (not facing the camera)", () => {
    const { frames, video } = generateSyntheticWalk({ leftDeg: 12, rightDeg: 5 });
    // swap left/right landmark labels in every frame
    const swapPairs: Array<[number, number]> = [[11, 12], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
    const swapped = frames.map((f) => {
      if (!f.img || !f.world) return f;
      const img = f.img.slice();
      const world = f.world.slice();
      for (const [a, b] of swapPairs) {
        [img[a], img[b]] = [img[b], img[a]];
        [world[a], world[b]] = [world[b], world[a]];
      }
      return { ...f, img, world };
    });
    const result = analyze(swapped, video);
    expect(result.calibration.lateralSign).toBe(-1);
    expect(result.warnings.join(" ")).toMatch(/facing the camera/);
  });

  it("is deterministic", () => {
    const a = run({ leftDeg: 9, rightDeg: 2, noisePx: 2, noiseWorldM: 0.01, seed: 11 }).result;
    const b = run({ leftDeg: 9, rightDeg: 2, noisePx: 2, noiseWorldM: 0.01, seed: 11 }).result;
    expect(a.leftDeg).toBe(b.leftDeg);
    expect(a.rightDeg).toBe(b.rightDeg);
  });
});
