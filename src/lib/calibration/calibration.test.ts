import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisResult } from "../analysis/types";
import { analyzeTopDown, type TopDownFrame } from "../topdown/analyze";
import { generateBlobWalk } from "../topdown/synthetic";
import { MAX_OFFSET_DEG, fitOffsets, fitWarnings } from "./fit";
import {
  axisAngleDeg,
  directionFromLine,
  footAngleDeg,
  forwardFromPsi,
  isPlausibleAngle,
  markedAngleDeg,
  psiFromForward,
  summarize,
  type Side,
} from "./measure";
import { axisPairs, clipForward, clipMeans, labelsCsv, readMarks, stanceFrames, type Mark } from "./session";
import {
  NO_CALIBRATION,
  calibrationOptions,
  clearCalibration,
  configSnippet,
  describeCalibration,
  loadCalibration,
  loadSavedCalibration,
  parseCalibration,
  saveCalibration,
} from "./settings";

const rad = (d: number) => (d * Math.PI) / 180;
const UP = { x: 0, y: -1 };

describe("walking direction vectors", () => {
  it("psi is degrees clockwise from the top of the picture", () => {
    expect(forwardFromPsi(0).x).toBeCloseTo(0);
    expect(forwardFromPsi(0).y).toBeCloseTo(-1);
    expect(forwardFromPsi(90).x).toBeCloseTo(1);
    expect(forwardFromPsi(90).y).toBeCloseTo(0);
    for (const psi of [-170, -40, 0, 25, 90, 179]) expect(psiFromForward(forwardFromPsi(psi))).toBeCloseTo(psi, 6);
  });
});

describe("foot angle convention (toe-out positive, own left and right)", () => {
  // a foot pointing `deg` to the left (counter-clockwise) of the way the person walks, as a direction in the picture
  const leftOfUp = (deg: number) => ({ x: -Math.sin(rad(deg)), y: -Math.cos(rad(deg)) });

  it("a left foot turned to the left is toe-out, to the right is toe-in; the right foot mirrors it", () => {
    expect(footAngleDeg(leftOfUp(10), UP, "left")).toBeCloseTo(10);
    expect(footAngleDeg(leftOfUp(-10), UP, "left")).toBeCloseTo(-10);
    expect(footAngleDeg(leftOfUp(-10), UP, "right")).toBeCloseTo(10);
    expect(footAngleDeg(leftOfUp(10), UP, "right")).toBeCloseTo(-10);
  });

  it("follows a rotated walking direction (walking toward the right of the picture)", () => {
    const f = forwardFromPsi(90);
    // walking right: the person's left is the top of the picture, so a left foot pointing a bit upward is toe-out
    expect(footAngleDeg({ x: Math.cos(rad(10)), y: -Math.sin(rad(10)) }, f, "left")).toBeCloseTo(10);
    expect(footAngleDeg({ x: Math.cos(rad(10)), y: Math.sin(rad(10)) }, f, "right")).toBeCloseTo(10);
  });

  it("an axis without a sign gives the same angle whichever end is called the toe", () => {
    const a = leftOfUp(14);
    expect(axisAngleDeg(a, UP, "left")).toBeCloseTo(14);
    expect(axisAngleDeg({ x: -a.x, y: -a.y }, UP, "left")).toBeCloseTo(14);
  });

  it("the marked heel -> toe line gives the angle of that line", () => {
    const heel = { x: 300, y: 800 };
    const toe = { x: heel.x - 220 * Math.sin(rad(8)), y: heel.y - 220 * Math.cos(rad(8)) }; // 8 degrees to the left of up
    expect(markedAngleDeg(heel, toe, UP, "left")).toBeCloseTo(8);
    expect(markedAngleDeg(heel, toe, UP, "right")).toBeCloseTo(-8);
    // heel and toe clicked the wrong way round: the foot "points backwards", which is flagged as implausible
    expect(isPlausibleAngle(markedAngleDeg(toe, heel, UP, "left"))).toBe(false);
    expect(isPlausibleAngle(8)).toBe(true);
    expect(isPlausibleAngle(Number.NaN)).toBe(false);
  });

  it("a drawn direction line is turned to agree with the reference", () => {
    const d = directionFromLine({ x: 100, y: 100 }, { x: 110, y: 400 }, UP); // drawn downwards, reference is up
    expect(d).not.toBeNull();
    expect((d as { y: number }).y).toBeLessThan(0);
    expect(directionFromLine({ x: 5, y: 5 }, { x: 5, y: 5 }, UP)).toBeNull();
  });

  it("summarizes marks", () => {
    expect(summarize([])).toBeNull();
    expect(summarize([4])).toEqual({ n: 1, mean: 4, sd: 0 });
    const s = summarize([2, 4, 6, Number.NaN]);
    expect(s?.n).toBe(3);
    expect(s?.mean).toBeCloseTo(4);
    expect(s?.sd).toBeCloseTo(2);
  });
});

describe("the hand-mark maths agrees with what the analysis reads", () => {
  it("a heel->toe line marked on the foot axis of simulated walks gives the walking angle, for a rotated phone too", () => {
    // (beyond ~30° the simulated feet leave the narrow frame sideways)
    for (const yaw of [0, 20, -25]) {
      const { frames, video } = generateBlobWalk({ leftDeg: 12, rightDeg: 5, yawDeg: yaw });
      const result = analyzeTopDown(frames, video);
      expect(result.ok).toBe(true);
      const fwd = forwardFromPsi(result.heading.psiDeg);
      const seen = { left: [] as number[], right: [] as number[] };
      const marked = { left: [] as number[], right: [] as number[] };
      frames.forEach((fr, i) => {
        for (const side of ["left", "right"] as const) {
          const d = result.frames[i][side];
          if (!d.usable || d.blobIndex === undefined || d.blobIndex < 0) continue;
          const b = fr.blobs[d.blobIndex];
          seen[side].push(axisAngleDeg({ x: b.ux, y: b.uy }, fwd, side));
          marked[side].push(
            markedAngleDeg({ x: b.heelX * video.width, y: b.heelY * video.height }, { x: b.toeX * video.width, y: b.toeY * video.height }, fwd, side),
          );
        }
      });
      expect(seen.left.length).toBeGreaterThan(5);
      expect(seen.right.length).toBeGreaterThan(5);
      // (the walking direction itself is estimated from the feet's motion, so allow a degree for that)
      const near = (v: number | undefined, truth: number) => expect(Math.abs((v as number) - truth)).toBeLessThan(1.2);
      near(summarize(seen.left)?.mean, 12);
      near(summarize(seen.right)?.mean, 5);
      near(summarize(marked.left)?.mean, 12);
      near(summarize(marked.right)?.mean, 5);
    }
  });
});

describe("a calibration session on a simulated clip", () => {
  // marks laid on the simulated feet: heel centre -> toe along the true axis, optionally turned by `turnDeg` (a different axis definition)
  function marksOn(frames: TopDownFrame[], result: AnalysisResult, video: { width: number; height: number }, side: Side, turnDeg = 0) {
    const out: Mark[] = [];
    for (const idx of stanceFrames(result, side)) {
      const bi = result.frames[idx][side].blobIndex as number;
      const b = frames[idx].blobs[bi];
      const L = b.length * video.height;
      const cx = b.cx * video.width;
      const cy = b.cy * video.height;
      // turn the blob axis (pointing toward the toes) by turnDeg clockwise
      const t = (turnDeg * Math.PI) / 180;
      const ux = b.ux * Math.cos(t) - b.uy * Math.sin(t);
      const uy = b.ux * Math.sin(t) + b.uy * Math.cos(t);
      out.push({ id: out.length + 1, side, idx, heel: { x: cx - (ux * L) / 2, y: cy - (uy * L) / 2 }, toe: { x: cx + (ux * L) / 2, y: cy + (uy * L) / 2 } });
    }
    return out;
  }

  it("marks laid on the foot axis read the same angle as the app, so the offset is zero", () => {
    const { frames, video } = generateBlobWalk({ leftDeg: 12, rightDeg: 5, yawDeg: 8 });
    const result = analyzeTopDown(frames, video);
    const { fwd, own } = clipForward(result, null, false);
    expect(own).toBe(false);
    const marks = [...marksOn(frames, result, video, "left"), ...marksOn(frames, result, video, "right")];
    expect(marks.length).toBeGreaterThanOrEqual(4);
    const readings = readMarks(marks, frames, result, fwd);
    expect(readings.every((r) => r.plausible && r.appDeg !== null)).toBe(true);
    const fit = fitOffsets(axisPairs(readings));
    expect(Math.abs(fit.left.offsetDeg)).toBeLessThan(0.3);
    expect(Math.abs(fit.right.offsetDeg)).toBeLessThan(0.3);
    const means = clipMeans(readings);
    expect(Math.abs((means.left?.mean as number) - 12)).toBeLessThan(1);
    expect(Math.abs((means.right?.mean as number) - 5)).toBeLessThan(1);
  });

  it("recovers the offset between a different axis definition and the app's", () => {
    const { frames, video } = generateBlobWalk({ leftDeg: 12, rightDeg: 5 });
    const result = analyzeTopDown(frames, video);
    const { fwd } = clipForward(result, null, false);
    // the person's axis points 3 degrees more toe-in on the left foot (3 degrees clockwise on screen) and 2 degrees more toe-out on the right (also clockwise)
    const marks = [...marksOn(frames, result, video, "left", 3), ...marksOn(frames, result, video, "right", 2)];
    const fit = fitOffsets(axisPairs(readMarks(marks, frames, result, fwd)));
    expect(fit.left.offsetDeg).toBeCloseTo(-3, 0); // left foot: clockwise = toward the other foot = toe-in
    expect(fit.right.offsetDeg).toBeCloseTo(2, 0); // right foot: clockwise = outward = toe-out
    expect(fit.left.sdDeg).toBeLessThan(0.3);
    // and that offset, applied, makes the analysis agree with the person's marks
    const cal = analyzeTopDown(frames, video, { angleOffsetLeftDeg: fit.left.offsetDeg, angleOffsetRightDeg: fit.right.offsetDeg });
    const means = clipMeans(readMarks(marks, frames, result, fwd));
    expect(Math.abs((cal.leftDeg as number) - (means.left?.mean as number))).toBeLessThan(0.5);
    expect(Math.abs((cal.rightDeg as number) - (means.right?.mean as number))).toBeLessThan(0.5);
  });

  it("flags swapped heel and toe, and keeps such a mark out of the statistics", () => {
    const { frames, video } = generateBlobWalk({ leftDeg: 12, rightDeg: 5 });
    const result = analyzeTopDown(frames, video);
    const { fwd } = clipForward(result, null, false);
    const marks = marksOn(frames, result, video, "left");
    const swapped = { ...marks[0], heel: marks[0].toe, toe: marks[0].heel };
    const readings = readMarks([swapped, ...marks.slice(1)], frames, result, fwd);
    expect(readings[0].plausible).toBe(false);
    expect(axisPairs(readings).length).toBe(marks.length - 1);
    expect(clipMeans(readings).left?.n).toBe(marks.length - 1);
  });

  it("uses the person's own walking line when they draw one, turned to agree with the app's direction", () => {
    const { frames, video } = generateBlobWalk({ leftDeg: 12, rightDeg: 5 });
    const result = analyzeTopDown(frames, video);
    const line = { a: { x: 100, y: 300 }, b: { x: 100, y: 100 } }; // drawn upward
    const own = clipForward(result, line, true);
    expect(own.own).toBe(true);
    expect(own.fwd.y).toBeLessThan(-0.99);
    const backwards = clipForward(result, { a: line.b, b: line.a }, true); // drawn downward: same direction after turning
    expect(backwards.fwd.y).toBeLessThan(-0.99);
    expect(clipForward(result, line, false).own).toBe(false);
    expect(clipForward(result, null, true).own).toBe(false);
  });

  it("finds the frames in the middle of each stance, and writes labels.csv", () => {
    const { frames, video } = generateBlobWalk({ leftDeg: 12, rightDeg: 5 });
    const result = analyzeTopDown(frames, video);
    const left = stanceFrames(result, "left");
    const right = stanceFrames(result, "right");
    expect(left.length).toBeGreaterThanOrEqual(2);
    expect(right.length).toBeGreaterThanOrEqual(2);
    expect([...left].sort((a, b) => a - b)).toEqual(left);
    for (const i of left) expect(result.frames[i].left.usable).toBe(true);
    expect(labelsCsv([{ name: 'a,"b".mp4', left: 11.96, right: -3.04 }, { name: "skipped.mp4", left: 1, right: null }])).toBe(
      "video,left_deg,right_deg\na__b_.mp4,12.0,-3.0\n",
    );
  });
});

describe("fitting the offsets", () => {
  it("is the mean of (yours - the app's) per foot, with its scatter", () => {
    const fit = fitOffsets([
      { side: "left", user: 12, app: 10 },
      { side: "left", user: 14, app: 11 },
      { side: "left", user: 9, app: 8 },
      { side: "right", user: 4, app: 5 },
    ]);
    expect(fit.left.n).toBe(3);
    expect(fit.left.offsetDeg).toBeCloseTo(2);
    expect(fit.left.sdDeg).toBeCloseTo(1);
    expect(fit.left.seDeg).toBeCloseTo(1 / Math.sqrt(3));
    expect(fit.right.n).toBe(1);
    expect(fit.right.offsetDeg).toBeCloseTo(-1);
    expect(Number.isNaN(fit.right.seDeg)).toBe(true);
  });

  it("gives no offset without marks, and never more than the sanity limit", () => {
    const empty = fitOffsets([]);
    expect(empty.left).toEqual({ n: 0, offsetDeg: 0, sdDeg: 0, seDeg: NaN });
    const wild = fitOffsets([
      { side: "left", user: 40, app: 0 },
      { side: "right", user: -40, app: 0 },
    ]);
    expect(wild.left.offsetDeg).toBe(MAX_OFFSET_DEG);
    expect(wild.right.offsetDeg).toBe(-MAX_OFFSET_DEG);
  });

  it("says in plain words when the marks cannot be trusted yet", () => {
    expect(fitWarnings(fitOffsets([])).join(" ")).toMatch(/No left-foot marks/);
    const few = fitWarnings(fitOffsets([{ side: "left", user: 1, app: 0 }]));
    expect(few.join(" ")).toMatch(/Only 1 left-foot mark:/);
    const noisy = fitWarnings(
      fitOffsets(
        [-8, 8, -7, 9, 0, 1].flatMap((d) => [
          { side: "left" as const, user: d, app: 0 },
          { side: "right" as const, user: 0.5, app: 0 },
        ]),
      ),
    );
    expect(noisy.join(" ")).toMatch(/left-foot marks disagree/);
    expect(noisy.join(" ")).not.toMatch(/right-foot/);
  });
});

describe("calibration settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  const memoryStorage = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };

  it("accepts a good calibration, clamps numbers and rejects anything else", () => {
    expect(parseCalibration({ leftOffsetDeg: 1.5, rightOffsetDeg: -0.5, method: "hybrid" })).toMatchObject({
      version: 1,
      leftOffsetDeg: 1.5,
      rightOffsetDeg: -0.5,
      method: "hybrid",
    });
    expect(parseCalibration({ leftOffsetDeg: 99, rightOffsetDeg: -99, method: "balanced" })).toMatchObject({
      leftOffsetDeg: MAX_OFFSET_DEG,
      rightOffsetDeg: -MAX_OFFSET_DEG,
    });
    for (const bad of [null, "x", 3, {}, { leftOffsetDeg: 1, rightOffsetDeg: 1 }, { leftOffsetDeg: "1", rightOffsetDeg: 1, method: "balanced" }, { leftOffsetDeg: 1, rightOffsetDeg: 1, method: "magic" }, { leftOffsetDeg: NaN, rightOffsetDeg: 1, method: "single" }]) {
      expect(parseCalibration(bad)).toBeNull();
    }
  });

  it("turns a calibration into analysis options", () => {
    expect(calibrationOptions(NO_CALIBRATION)).toEqual({ balanceFeet: true, headingBlend: 0, angleOffsetLeftDeg: 0, angleOffsetRightDeg: 0 });
    expect(calibrationOptions({ ...NO_CALIBRATION, method: "single", leftOffsetDeg: 2, rightOffsetDeg: -1 })).toEqual({
      balanceFeet: false,
      headingBlend: 0,
      angleOffsetLeftDeg: 2,
      angleOffsetRightDeg: -1,
    });
    expect(calibrationOptions({ ...NO_CALIBRATION, method: "hybrid" }).headingBlend).toBe(0.5);
  });

  it("the offsets reach the angles the analysis reports", () => {
    const { frames, video } = generateBlobWalk({ leftDeg: 12, rightDeg: 5 });
    const raw = analyzeTopDown(frames, video);
    const cal = analyzeTopDown(frames, video, calibrationOptions({ ...NO_CALIBRATION, leftOffsetDeg: 2, rightOffsetDeg: -1.5 }));
    expect((cal.leftDeg as number) - (raw.leftDeg as number)).toBeCloseTo(2, 5);
    expect((cal.rightDeg as number) - (raw.rightDeg as number)).toBeCloseTo(-1.5, 5);
  });

  it("saves, loads and clears on this device, and falls back to the shipped calibration", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    expect(loadSavedCalibration()).toBeNull();
    expect(loadCalibration()).toEqual(NO_CALIBRATION); // the shipped default is zero offsets, balanced
    expect(saveCalibration({ ...NO_CALIBRATION, leftOffsetDeg: 1.2, rightOffsetDeg: -0.4, basedOn: { clips: 2, marks: 14 } })).toBe(true);
    expect(loadCalibration()).toMatchObject({ leftOffsetDeg: 1.2, rightOffsetDeg: -0.4, basedOn: { clips: 2, marks: 14 } });
    expect(loadSavedCalibration()?.savedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    clearCalibration();
    expect(loadSavedCalibration()).toBeNull();
  });

  it("survives blocked or corrupt storage", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => "{not json",
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(loadSavedCalibration()).toBeNull();
    expect(saveCalibration(NO_CALIBRATION)).toBe(false);
    expect(() => clearCalibration()).not.toThrow();
    expect(loadCalibration()).toEqual(NO_CALIBRATION);
  });

  it("does nothing on the server, where there is no window", () => {
    expect(loadSavedCalibration()).toBeNull();
    expect(saveCalibration(NO_CALIBRATION)).toBe(false);
  });

  it("describes a calibration and prints the line for config.ts", () => {
    const c = { ...NO_CALIBRATION, leftOffsetDeg: 1.5, rightOffsetDeg: -0.5, method: "hybrid" as const };
    expect(describeCalibration(c)).toBe("left +1.5°, right −0.5° · hybrid");
    expect(configSnippet(c)).toBe('export const DEFAULT_CALIBRATION = { leftOffsetDeg: 1.5, rightOffsetDeg: -0.5, method: "hybrid" } as const;');
  });
});
