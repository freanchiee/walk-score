import { describe, expect, it } from "vitest";
import { TARGET_BAND } from "../config";
import { computeScore, describeAngle, distanceToBand, footScore, pickLabel, symmetryScore, type ScoreInput } from "./score";

const input = (l: number, r: number, over: Partial<ScoreInput> = {}): ScoreInput => ({
  leftDeg: l,
  rightDeg: r,
  leftSteps: 4,
  rightSteps: 4,
  quality: "good",
  ...over,
});

describe("target band", () => {
  it("is a 0-10 degree toe-out best guess kept in config", () => {
    expect(TARGET_BAND).toEqual({ minDeg: 0, maxDeg: 10 });
  });

  it("measures distance outside the band", () => {
    expect(distanceToBand(5)).toBe(0);
    expect(distanceToBand(0)).toBe(0);
    expect(distanceToBand(10)).toBe(0);
    expect(distanceToBand(14)).toBe(4);
    expect(distanceToBand(-3)).toBe(3);
  });
});

describe("score", () => {
  it("gives 100 for two identical feet inside the band", () => {
    expect(computeScore(input(5, 5)).score).toBe(100);
    // inside the band but 10° apart: full angle credit, little symmetry credit
    const apart = computeScore(input(0, 10)).score;
    expect(apart).toBeGreaterThan(60);
    expect(apart).toBeLessThan(90);
  });

  it("falls monotonically as a foot moves away from the band", () => {
    const scores = [10, 12, 15, 20, 30, 40].map((d) => computeScore(input(d, d)).score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]);
    // Scores are additive (angle + symmetry), so a perfectly symmetric but extreme walker keeps roughly the
    // symmetry weight (35 points). Documented in the README.
    expect(scores[scores.length - 1]).toBeLessThan(40);
    expect(scores[scores.length - 1]).toBeGreaterThanOrEqual(30);
  });

  it("falls monotonically for toe-in", () => {
    const scores = [0, -3, -6, -12, -20].map((d) => computeScore(input(d, d)).score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]);
  });

  it("penalises asymmetry even when both feet are in the band", () => {
    expect(computeScore(input(5, 5)).score).toBeGreaterThan(computeScore(input(1, 9)).score);
    expect(symmetryScore(0)).toBe(100);
    expect(symmetryScore(4)).toBeGreaterThan(85);
    expect(symmetryScore(15)).toBeLessThan(25);
  });

  it("is symmetric in left/right", () => {
    expect(computeScore(input(14, 3)).score).toBe(computeScore(input(3, 14)).score);
  });

  it("stays within 0..100", () => {
    for (const [l, r] of [[-60, 70], [90, 90], [0, 0], [5, 5]]) {
      const s = computeScore(input(l, r)).score;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
    expect(footScore(5)).toBe(100);
  });
});

describe("labels", () => {
  it("covers each tier", () => {
    expect(computeScore(input(5, 5)).label.id).toBe("runway");
    expect(computeScore(input(24, 22)).label.id).toBe("duck");
    expect(computeScore(input(16, 15)).label.id).toBe("chaplin");
    expect(computeScore(input(-8, -9)).label.id).toBe("pigeon");
    expect(computeScore(input(20, 3)).label.id).toBe("plot-twist");
    expect(pickLabel(80, 6, 4).id).toBe("smooth");
    expect(pickLabel(50, 8, 7).id).toBe("free-spirit");
  });
});

describe("cues", () => {
  it("returns 2-3 plain cues for every case", () => {
    for (const [l, r, q] of [[5, 5, "good"], [20, 4, "ok"], [-6, -8, "rough"], [30, -10, "good"], [12, 13, "ok"]] as const) {
      const cues = computeScore(input(l, r, { quality: q })).cues;
      expect(cues.length).toBeGreaterThanOrEqual(2);
      expect(cues.length).toBeLessThanOrEqual(3);
      cues.forEach((c) => expect(c.length).toBeGreaterThan(10));
    }
  });

  it("never uses medical or corrective language", () => {
    const banned = /diagnos|injur|pain|posture|correct|fix|treat|therap|disease|condition|doctor|risk/i;
    for (const [l, r] of [[5, 5], [20, 4], [-6, -8], [30, -10]]) {
      const s = computeScore(input(l, r));
      [...s.cues, s.label.title, s.label.tagline].forEach((t) => expect(t).not.toMatch(banned));
    }
  });

  it("mentions the sweet spot taken from config", () => {
    expect(computeScore(input(5, 5)).cues[0]).toContain("0–10°");
  });

  it("says plainly when the angles come from a standing stance instead of steps", () => {
    const s = computeScore(input(5, 5, { standing: true, leftSteps: 1, rightSteps: 1, quality: "rough" }));
    expect(s.standing).toBe(true);
    expect(s.cues.join(" ")).toMatch(/standing stance/);
    expect(s.cues.join(" ")).not.toMatch(/only 1 step/);
    expect(computeScore(input(5, 5)).standing).toBe(false);
  });

  it("states the left/right gap from the whole degrees shown, so the numbers on screen agree", () => {
    // 11.6 and 4.4 are shown as 12° and 4°; the true gap is 7.2°, but the cue has to say 8° like the screen does
    const cues = computeScore(input(11.6, 4.4)).cues.join(" ");
    expect(describeAngle(11.6).value - describeAngle(4.4).value).toBe(8);
    expect(cues).toContain("differ by 8°");
    expect(cues).not.toContain("differ by 7°");
  });
});

describe("describeAngle", () => {
  it("rounds to whole degrees and names the direction", () => {
    expect(describeAngle(7.6)).toMatchObject({ text: "8°", direction: "out" });
    expect(describeAngle(-2.2)).toMatchObject({ text: "2°", direction: "in" });
    expect(describeAngle(0.3)).toMatchObject({ text: "0°", direction: "straight" });
  });
});
