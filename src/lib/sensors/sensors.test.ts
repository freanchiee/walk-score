import { describe, expect, it } from "vitest";
import { analyzeTopDown, type TopDownFrame } from "../topdown/analyze";
import type { FootBlob } from "../topdown/segment";
import { generateBlobWalk } from "../topdown/synthetic";
import { SENSOR_CONFIG } from "../config";
import { parseExperiments } from "../flags";
import type { CaptureInfo } from "./capture";
import { annotateFrames, buildReport, rejectionFor, stepTimesSec } from "./gate";
import { SensorLog } from "./log";
import { captureQuality, mergeQuality, type CaptureMetrics } from "./quality";
import { StepDetector, detectSteps } from "./steps";
import { bubbleOffset, downInCamera, tiltClass, tiltDeg } from "./tilt";
import { correctBlob, correctFramesForTilt, intrinsicsFor, nadirRotation, reproject, type Mat3 } from "./tiltCorrection";
import type { MotionSample } from "./types";
import { relativeYaw } from "./yaw";

const RAD = Math.PI / 180;

describe("tilt from beta / gamma (phone flat, screen up, back camera at the floor = level)", () => {
  it.each([
    [0, 0, 0],
    [10, 0, 10],
    [-10, 0, 10],
    [0, 10, 10],
    [0, -10, 10],
    [90, 0, 90], // upright in portrait: the camera looks straight ahead
    [0, 90, 90],
    [180, 0, 180], // face down: the camera looks at the sky
  ])("beta %f, gamma %f -> tilt %f°", (beta, gamma, expected) => {
    expect(tiltDeg(beta, gamma)).toBeCloseTo(expected, 6);
  });

  it("combines beta and gamma as the angle of the camera axis from vertical, not as a sum", () => {
    expect(tiltDeg(10, 10)).toBeCloseTo(14.106, 2); // acos(cos 10° cos 10°) = acos(0.96985)
    expect(tiltDeg(10, 10)).toBeLessThan(20);
  });

  it("classifies with the config thresholds: green up to 5°, amber up to 12°, red beyond", () => {
    expect(tiltClass(0)).toBe("good");
    expect(tiltClass(SENSOR_CONFIG.tilt.goodDeg)).toBe("good");
    expect(tiltClass(SENSOR_CONFIG.tilt.goodDeg + 0.1)).toBe("warn");
    expect(tiltClass(SENSOR_CONFIG.tilt.warnDeg)).toBe("warn");
    expect(tiltClass(SENSOR_CONFIG.tilt.warnDeg + 0.1)).toBe("bad");
  });

  it("the bubble drifts to the high side of the phone and its distance is tilt / full scale", () => {
    const full = 20;
    expect(bubbleOffset(0, 0, full)).toEqual({ x: 0, y: 0 });
    const topUp = bubbleOffset(10, 0, full); // top edge raised: bubble toward the top of the screen (y negative)
    expect(topUp.x).toBeCloseTo(0, 9);
    expect(topUp.y).toBeCloseTo(-0.5, 6);
    const rightDown = bubbleOffset(0, 10, full); // right edge lowered (gamma > 0): bubble toward the left
    expect(rightDown.x).toBeCloseTo(-0.5, 6);
    expect(rightDown.y).toBeCloseTo(0, 9);
    const far = bubbleOffset(0, 60, full); // capped at the ring
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(1, 9);
  });

  it("'down' in the camera picture: the picture centre when level, toward the bottom when the top of the phone is raised", () => {
    const level = downInCamera(0, 0);
    expect([level.x, level.y, level.z]).toEqual([0, 0, 1]);
    const raised = downInCamera(15, 0);
    expect(raised.y).toBeGreaterThan(0.2);
    expect(Math.hypot(raised.x, raised.y, raised.z)).toBeCloseTo(1, 9);
    expect(raised.z).toBeCloseTo(Math.cos(15 * RAD), 9); // z = cos(tilt)
  });
});

// ---- step detector -------------------------------------------------------------------------------------

function walkSamples(opts: { seconds: number; stepHz: number; amp: number; hz: number; noise?: number; seed?: number; phase?: number }): MotionSample[] {
  let a = opts.seed ?? 1;
  const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 2;
  const out: MotionSample[] = [];
  const n = Math.round(opts.seconds * opts.hz);
  for (let i = 0; i < n; i++) {
    const t = (i / opts.hz) * 1000 + 5000;
    const s = i / opts.hz;
    // a heel-strike bounce each step, with a second harmonic bump
    const bounce = opts.amp * (Math.sin(2 * Math.PI * opts.stepHz * s + (opts.phase ?? 0)) + 0.4 * Math.sin(4 * Math.PI * opts.stepHz * s + 1));
    out.push({ t, ax: (opts.noise ?? 0) * rnd(), ay: (opts.noise ?? 0) * rnd(), az: 9.81 + bounce + (opts.noise ?? 0) * rnd(), rx: 0, ry: 0, rz: 0 });
  }
  return out;
}

describe("step detector (accelerometer peaks)", () => {
  it.each([
    [1.9, 2.0, 60],
    [1.9, 2.0, 30],
    [1.9, 2.0, 100],
    [1.5, 1.2, 60],
    [2.2, 2.5, 60],
  ])("counts a %f steps/s walk of 10 s sampled at %i Hz", (stepHz, amp, hz) => {
    const steps = detectSteps(walkSamples({ seconds: 10, stepHz, amp, hz, noise: 0.25, seed: 7 }));
    expect(Math.abs(steps.length - 10 * stepHz)).toBeLessThanOrEqual(2);
    // steps are one cadence period apart (no double counts)
    const gaps = steps.slice(1).map((t, i) => t - steps[i]);
    expect(Math.min(...gaps)).toBeGreaterThan(0.6 * (1000 / stepHz));
  });

  it("counts nothing while standing, with hand tremor", () => {
    expect(detectSteps(walkSamples({ seconds: 10, stepHz: 1.9, amp: 0, hz: 60, noise: 0.3, seed: 3 })).length).toBe(0);
  });

  it("does not care how the phone is oriented (works from gravity-included magnitude)", () => {
    const flat = walkSamples({ seconds: 8, stepHz: 1.8, amp: 2, hz: 60, noise: 0.2 });
    const rotated = flat.map((s) => ({ ...s, ax: s.az, ay: s.ax, az: s.ay })); // gravity now along x
    expect(detectSteps(rotated).length).toBe(detectSteps(flat).length);
  });

  it("streams: the live counter and the after-the-fact count agree", () => {
    const samples = walkSamples({ seconds: 6, stepHz: 1.8, amp: 2, hz: 60, noise: 0.2 });
    const d = new StepDetector();
    let live = 0;
    for (const s of samples) if (d.push(s.t, s.ax, s.ay, s.az) !== null) live++;
    expect(live).toBe(detectSteps(samples).length);
    expect(live).toBe(d.steps.length);
  });
});

// ---- sensor log ----------------------------------------------------------------------------------------

describe("sensor log", () => {
  const log = new SensorLog();
  for (let i = 0; i <= 600; i++) log.addOrientation({ t: 1000 + i * (1000 / 60), alpha: 10, beta: i < 300 ? 2 : 20, gamma: 0 });
  for (let i = 0; i <= 600; i++) log.addMotion({ t: 1000 + i * (1000 / 60), ax: 0, ay: 0, az: 9.8, rx: 30, ry: 0, rz: 40 });

  it("interpolates beta / gamma between samples and returns null far from any sample", () => {
    const l = new SensorLog();
    l.addOrientation({ t: 100, alpha: 0, beta: 0, gamma: 0 });
    l.addOrientation({ t: 200, alpha: 0, beta: 10, gamma: -4 });
    expect(l.betaGammaAt(150)).toEqual({ beta: 5, gamma: -2 });
    expect(l.betaGammaAt(100)?.beta).toBe(0);
    expect(l.betaGammaAt(260)?.beta).toBe(10); // within the gap limit of the last sample
    expect(l.betaGammaAt(900)).toBeNull();
    expect(l.betaGammaAt(-400)).toBeNull();
    expect(new SensorLog().tiltAt(0)).toBeNull();
  });

  it("gives the tilt at a time and window statistics", () => {
    expect(log.tiltAt(1000 + 1000)).toBeCloseTo(2, 6);
    expect(log.tiltAt(1000 + 9000)).toBeCloseTo(20, 6);
    const w = log.window(1000, 11000);
    expect(w.orientationN).toBe(601);
    expect(w.tiltMedianDeg).toBeGreaterThan(1.9);
    expect(w.rotationRmsDegPerSec).toBeCloseTo(50, 6); // hypot(30, 40)
  });

  it("keeps at most maxSamples (memory only)", () => {
    const l = new SensorLog(100);
    for (let i = 0; i < 250; i++) l.addMotion({ t: i, ax: 0, ay: 0, az: 9.8, rx: 0, ry: 0, rz: 0 });
    expect(l.motion.length).toBe(100);
    expect(l.motion[0].t).toBe(150);
    l.clear();
    expect(l.motion.length + l.orientation.length).toBe(0);
  });
});

// ---- capture quality -----------------------------------------------------------------------------------

describe("capture quality", () => {
  const good: CaptureMetrics = {
    sensors: "ok",
    tiltMedianDeg: 2.5,
    tiltOverShare: 0,
    rotationRmsDegPerSec: 15,
    steps: 16,
    lightOkShare: 1,
    feetShare: 0.95,
    forcedStart: false,
    yawStatus: "off",
  };

  it("scores a flat, steady, long, well-lit walk as good", () => {
    const q = captureQuality(good);
    expect(q.score).toBeGreaterThanOrEqual(90);
    expect(q.category).toBe("good");
    expect(q.lowConfidence).toBe(false);
    expect(q.reasons).toEqual([]);
  });

  it("drops with tilt, shaking, few steps, bad light, a forced start, and says why", () => {
    const tilted = captureQuality({ ...good, tiltMedianDeg: 11, tiltOverShare: 0.4 });
    expect(tilted.score).toBeLessThan(captureQuality(good).score - 25);
    expect(tilted.reasons.join(" ")).toMatch(/tilted about 11°/);
    expect(captureQuality({ ...good, rotationRmsDegPerSec: 80 }).reasons.join(" ")).toMatch(/moving or turning/);
    expect(captureQuality({ ...good, steps: 7 }).reasons.join(" ")).toMatch(/Only 7 steps/);
    expect(captureQuality({ ...good, lightOkShare: 0.4 }).reasons.join(" ")).toMatch(/light/);
    const forced = captureQuality({ ...good, forcedStart: true });
    expect(forced.score).toBeLessThan(captureQuality(good).score);
    expect(forced.reasons.join(" ")).toMatch(/before the live checks/);
    expect(captureQuality({ ...good, yawStatus: "reject" }).score).toBeLessThan(captureQuality({ ...good, yawStatus: "warn" }).score);
  });

  it("is low confidence and a rough read whenever the sensors could not vouch for it", () => {
    const none = captureQuality({ ...good, sensors: "unavailable", tiltMedianDeg: null, tiltOverShare: null, rotationRmsDegPerSec: null, steps: null });
    expect(none.lowConfidence).toBe(true);
    expect(none.category).toBe("poor");
    expect(none.reasons[0]).toMatch(/motion sensors were not available/);
    expect(captureQuality({ ...good, sensors: "partial" }).lowConfidence).toBe(true);
  });

  it("the badge is the worse of the analysis and the capture", () => {
    const q = (m: Partial<CaptureMetrics>) => captureQuality({ ...good, ...m });
    expect(mergeQuality("good", q({}))).toBe("good");
    expect(mergeQuality("good", q({ tiltMedianDeg: 8, rotationRmsDegPerSec: 40, steps: 8 }))).not.toBe("good");
    expect(mergeQuality("ok", q({}))).toBe("ok");
    expect(mergeQuality("good", q({ sensors: "unavailable" }))).toBe("rough");
    expect(mergeQuality("rough", q({}))).toBe("rough");
    expect(mergeQuality("none", q({}))).toBe("rough");
    expect(mergeQuality("good", null)).toBe("good");
  });
});

// ---- yaw -----------------------------------------------------------------------------------------------

describe("relative yaw (experimental)", () => {
  const run = (alphaAt: (s: number) => number, seconds = 10) =>
    Array.from({ length: seconds * 30 + 1 }, (_, i) => ({ t: 1000 + (i * 1000) / 30, alpha: ((alphaAt(i / 30) % 360) + 360) % 360, beta: 0, gamma: 0 }));

  it("is ok for a steady heading with a few degrees of sway", () => {
    const r = relativeYaw(run((s) => 200 + 3 * Math.sin(s * 5)), 1000, 11000);
    expect(r.status).toBe("ok");
    expect(r.maxAbsDeg).toBeLessThan(4);
    expect(r.swayRmsDeg).toBeGreaterThan(1.5);
  });

  it("warns, then rejects, as the phone turns away from where it started", () => {
    expect(relativeYaw(run((s) => 100 + 2 * s), 1000, 11000).status).toBe("warn"); // 20° over 10 s
    const turn = relativeYaw(run((s) => 100 + 8 * s), 1000, 11000);
    expect(turn.status).toBe("reject"); // 80°
    expect(turn.endDeg).toBeCloseTo(80, 0);
  });

  it("follows a turn across the 0/360 wrap and in either direction", () => {
    const r = relativeYaw(run((s) => 350 + 4 * s), 1000, 11000); // 350 -> 30 degrees: +40
    expect(r.endDeg).toBeCloseTo(40, 0);
    expect(relativeYaw(run((s) => 10 - 4 * s), 1000, 11000).endDeg).toBeCloseTo(-40, 0);
  });

  it("says nothing without enough heading samples", () => {
    expect(relativeYaw([], 0, 1000).status).toBe("na");
    expect(relativeYaw([{ t: 1, alpha: null, beta: 0, gamma: 0 }], 0, 1000).status).toBe("na");
  });
});

// ---- experiment flags ----------------------------------------------------------------------------------

describe("experiment flags", () => {
  it("are all off by default and switched on only from the address", () => {
    expect(parseExperiments("")).toEqual({ yawCheck: false, yawReject: false, floorFlow: false, tiltCorrection: false });
    expect(parseExperiments("?exp=tilt")).toMatchObject({ tiltCorrection: true, yawCheck: false });
    expect(parseExperiments("?exp=yaw,flow")).toMatchObject({ yawCheck: true, floorFlow: true, tiltCorrection: false });
    expect(parseExperiments("?exp=yawreject")).toMatchObject({ yawReject: true, yawCheck: true });
    expect(parseExperiments("?x=1&exp=Tilt+Flow")).toMatchObject({ tiltCorrection: true, floorFlow: true });
    expect(parseExperiments("?exp=none", { yawCheck: true, yawReject: false, floorFlow: true, tiltCorrection: true })).toEqual({
      yawCheck: false,
      yawReject: false,
      floorFlow: false,
      tiltCorrection: false,
    });
    expect(parseExperiments("?exp=bogus")).toEqual(parseExperiments(""));
  });
});

// ---- tilt correction -----------------------------------------------------------------------------------

type V3 = [number, number, number];
const matMul = (a: number[][], b: number[][]) => a.map((r, i) => b[0].map((_, j) => r.reduce((s, _, k) => s + a[i][k] * b[k][j], 0)));
const rxM = (d: number) => [[1, 0, 0], [0, Math.cos(d * RAD), -Math.sin(d * RAD)], [0, Math.sin(d * RAD), Math.cos(d * RAD)]];
const ryM = (d: number) => [[Math.cos(d * RAD), 0, Math.sin(d * RAD)], [0, 1, 0], [-Math.sin(d * RAD), 0, Math.cos(d * RAD)]];
const rzM = (d: number) => [[Math.cos(d * RAD), -Math.sin(d * RAD), 0], [Math.sin(d * RAD), Math.cos(d * RAD), 0], [0, 0, 1]];
const mulV = (m: number[][], v: V3): V3 => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as V3;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A pinhole phone camera 1 m above the floor with the W3C orientation (device -> world = Rz(alpha) Rx(beta) Ry(gamma)). */
function camera(alpha: number, beta: number, gamma: number, W = 540, H = 960) {
  const R = matMul(matMul(rzM(alpha), rxM(beta)), ryM(gamma));
  const xc = mulV(R, [1, 0, 0]); // picture x = device x
  const yc = mulV(R, [0, -1, 0]); // picture y (down) = device -y
  const zc = mulV(R, [0, 0, -1]); // optical axis = device -z
  const K = intrinsicsFor(W, H, SENSOR_CONFIG.fovLongSideDeg);
  const C: V3 = [0, 0, 1];
  return {
    K,
    project: (P: V3) => {
      const d: V3 = [P[0] - C[0], P[1] - C[1], P[2] - C[2]];
      return { u: K.cx + (K.f * dot(xc, d)) / dot(zc, d), v: K.cy + (K.f * dot(yc, d)) / dot(zc, d) };
    },
  };
}
/** angle of a picture segment, degrees clockwise from the top of the picture */
const imgAngle = (a: { u: number; v: number }, b: { u: number; v: number }) => (Math.atan2(b.u - a.u, -(b.v - a.v)) / RAD);

describe("tilt correction (rotation-only homography to a straight-down view)", () => {
  // a foot 10° off the walking direction (+y on the floor) next to a reference line along the walking direction
  const toeOut = 10;
  const heel: V3 = [-0.04, 0.12, 0];
  const toe: V3 = [heel[0] + 0.26 * Math.sin(toeOut * RAD), heel[1] + 0.26 * Math.cos(toeOut * RAD), 0];
  const ref0: V3 = [0.06, -0.1, 0];
  const ref1: V3 = [0.06, 0.5, 0];

  const footAgainstWalking = (alpha: number, beta: number, gamma: number, correct: boolean) => {
    const cam = camera(alpha, beta, gamma);
    let pts = [heel, toe, ref0, ref1].map((p) => cam.project(p));
    if (correct) {
      const R = nadirRotation(downInCamera(beta, gamma));
      pts = pts.map((p) => reproject(p.u, p.v, R, cam.K));
    }
    return imgAngle(pts[0], pts[1]) - imgAngle(pts[2], pts[3]);
  };

  it.each([
    [0, 0, 0],
    [0, 10, 0],
    [0, 0, 10],
    [0, 12, 8],
    [40, -15, 6],
    [200, 18, -14],
  ])("alpha %f, beta %f, gamma %f: a tilted phone misreads the angle, the correction restores it", (alpha, beta, gamma) => {
    const wrong = footAgainstWalking(alpha, beta, gamma, false);
    const right = footAgainstWalking(alpha, beta, gamma, true);
    expect(Math.abs(right - toeOut)).toBeLessThan(0.01);
    if (Math.hypot(beta, gamma) >= 12) expect(Math.abs(wrong - toeOut)).toBeGreaterThan(0.25);
  });

  it("is the identity for a level phone and keeps the nadir at the picture centre", () => {
    const K = intrinsicsFor(540, 960, 67);
    const R = nadirRotation(downInCamera(0, 0));
    const p = reproject(123, 456, R, K);
    expect(p.u).toBeCloseTo(123, 9);
    expect(p.v).toBeCloseTo(456, 9);
    // tilted: the picture point where the nadir appears goes to the centre
    const d = downInCamera(12, 8);
    const R2 = nadirRotation(d);
    const c = reproject(K.cx + (K.f * d.x) / d.z, K.cy + (K.f * d.y) / d.z, R2, K);
    expect(c.u).toBeCloseTo(K.cx, 6);
    expect(c.v).toBeCloseTo(K.cy, 6);
  });

  it("is a proper rotation (orthonormal, determinant 1)", () => {
    const R: Mat3 = nadirRotation(downInCamera(17, -9));
    const row = (i: number): V3 => [R[i * 3], R[i * 3 + 1], R[i * 3 + 2]];
    expect(dot(row(0), row(0))).toBeCloseTo(1, 9);
    expect(dot(row(1), row(2))).toBeCloseTo(0, 9);
    const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
    expect(det).toBeCloseTo(1, 9);
  });

  it("corrects blobs and frames: the axis a blob reports follows the foot on the floor", () => {
    const W = 540;
    const H = 960;
    const cam = camera(0, 12, 8, W, H);
    const [h, t] = [heel, toe].map((p) => cam.project(p));
    const len = Math.hypot(t.u - h.u, t.v - h.v);
    const blob: FootBlob = {
      cx: (h.u + t.u) / 2 / W,
      cy: (h.v + t.v) / 2 / H,
      area: 0.01,
      length: len / H,
      width: 0.03,
      ux: (t.u - h.u) / len,
      uy: (t.v - h.v) / len,
      elongation: 2.6,
      toeX: t.u / W,
      toeY: t.v / H,
      heelX: h.u / W,
      heelY: h.v / H,
      clipped: false,
      score: 1,
      L: 0,
      a: 0,
      b: 0,
    };
    const R = nadirRotation(downInCamera(12, 8));
    const fixed = correctBlob(blob, W, H, R, cam.K);
    const [rh, rt] = [h, t].map((p) => reproject(p.u, p.v, R, cam.K));
    expect(fixed.ux).toBeCloseTo((rt.u - rh.u) / Math.hypot(rt.u - rh.u, rt.v - rh.v), 6);
    expect(fixed.score).toBe(1);
    const frames: TopDownFrame[] = [
      { t: 0, blobs: [blob] },
      { t: 1, blobs: [blob] },
    ];
    const out = correctFramesForTilt(frames, { width: W, height: H }, (s) => (s < 0.5 ? { beta: 12, gamma: 8 } : null), 67);
    expect(out[0].blobs[0].ux).not.toBe(blob.ux);
    expect(out[1]).toBe(frames[1]); // no tilt reading: left alone
  });
});

// ---- gating --------------------------------------------------------------------------------------------

describe("capture gating", () => {
  const frames: TopDownFrame[] = Array.from({ length: 150 }, (_, i) => ({ t: i / 15, blobs: [] }));

  function capture(opts: { tilt: (tSec: number) => number; steps: number; orientation?: boolean; motion?: boolean }): CaptureInfo {
    const log = new SensorLog();
    const recStart = 4000;
    for (let i = 0; i <= 600; i++) {
      const tMs = recStart + i * (10000 / 600);
      log.addOrientation({ t: tMs, alpha: 0, beta: opts.tilt((tMs - recStart) / 1000), gamma: 0 });
    }
    return {
      sensors: {
        status: "active",
        log,
        stepTimesMs: Array.from({ length: opts.steps }, (_, i) => recStart + 500 + i * 500),
        hasOrientation: opts.orientation ?? true,
        hasMotion: opts.motion ?? true,
      },
      recStartMs: recStart,
      recEndMs: recStart + 10000,
      forcedStart: false,
      live: { lightOkShare: 1, feetShare: 1 },
      lens: null,
    };
  }
  const flags = { yawCheck: false, yawReject: false, floorFlow: false, tiltCorrection: false };
  const okResult = () => {
    const { frames: f, video } = generateBlobWalk({ leftDeg: 10, rightDeg: 4 });
    return analyzeTopDown(f, video);
  };

  it("lines the sensor log up with the frames and marks tilted ones unreliable, keeping the originals untouched", () => {
    const cap = capture({ tilt: (s) => (s < 5 ? 3 : 20), steps: 14 });
    const ann = annotateFrames(frames, cap);
    expect(ann[10].reliable).toBe(true);
    expect(ann[10].tiltDeg).toBeCloseTo(3, 6);
    expect(ann[100].reliable).toBe(false);
    expect(ann[100].tiltDeg).toBeCloseTo(20, 6);
    expect(frames[100].reliable).toBeUndefined();
    expect(annotateFrames(frames, null)).toBe(frames); // no sensors: nothing changes
  });

  it("reports tilt, reliable share, steps and a quality for a good and for a tilted capture", () => {
    const good = buildReport({ capture: capture({ tilt: () => 3, steps: 16 }), frames: annotateFrames(frames, capture({ tilt: () => 3, steps: 16 })), flags });
    expect(good.sensors).toBe("ok");
    expect(good.steps).toBe(16);
    expect(good.reliableShare).toBe(1);
    expect(good.tilt.medianDeg).toBeCloseTo(3, 6);
    expect(good.quality.category).not.toBe("poor");
    expect(good.lowConfidence).toBe(false);

    const tilted = capture({ tilt: (s) => (s < 4 ? 3 : 25), steps: 16 });
    const bad = buildReport({ capture: tilted, frames: annotateFrames(frames, tilted), flags });
    expect(bad.reliableShare).toBeCloseTo(0.4, 1);
    expect(bad.tilt.overShare).toBeCloseTo(0.6, 1);
    expect(bad.quality.score).toBeLessThan(good.quality.score);
  });

  it("without any sensor data the scan is low confidence and keeps going (a rough read, not a rejection)", () => {
    const r = buildReport({ capture: null, frames, flags });
    expect(r.sensors).toBe("unavailable");
    expect(r.lowConfidence).toBe(true);
    expect(r.quality.category).toBe("poor");
    expect(r.steps).toBeNull();
    expect(r.reliableShare).toBeNull();
    expect(rejectionFor(r, okResult(), flags)).toBeNull();
  });

  it("rejects with a plain reason: too few steps, too tilted, (optionally) yaw", () => {
    const result = okResult();
    const few = capture({ tilt: () => 3, steps: SENSOR_CONFIG.minSteps - 1 });
    const fewReport = buildReport({ capture: few, frames: annotateFrames(frames, few), flags });
    expect(rejectionFor(fewReport, result, flags)).toEqual({ code: "too_few_steps", message: "Walk a bit longer and try again." });
    const enough = capture({ tilt: () => 3, steps: SENSOR_CONFIG.minSteps });
    expect(rejectionFor(buildReport({ capture: enough, frames: annotateFrames(frames, enough), flags }), result, flags)).toBeNull();

    const tilted = capture({ tilt: (s) => (s < 3 ? 3 : 22), steps: 14 });
    const tiltedReport = buildReport({ capture: tilted, frames: annotateFrames(frames, tilted), flags });
    expect(rejectionFor(tiltedReport, result, flags)?.code).toBe("too_tilted");

    // a clip that fails to measure while a third of it was tilted is blamed on the tilt
    const partlyTilted = capture({ tilt: (s) => (s < 6.5 ? 3 : 22), steps: 14 });
    const partlyReport = buildReport({ capture: partlyTilted, frames: annotateFrames(frames, partlyTilted), flags });
    expect(rejectionFor(partlyReport, result, flags)).toBeNull();
    expect(rejectionFor(partlyReport, { ...result, ok: false }, flags)?.code).toBe("too_tilted");

    // yaw: reported when the check is on, rejects only with yawReject
    const yawFlags = { ...flags, yawCheck: true, yawReject: true };
    const turning = capture({ tilt: () => 3, steps: 14 });
    turning.sensors?.log.orientation.forEach((o, i) => (o.alpha = i * 0.2)); // 120° over the clip
    const yawReport = buildReport({ capture: turning, frames: annotateFrames(frames, turning), flags: yawFlags });
    expect(yawReport.yaw.status).toBe("reject");
    expect(rejectionFor(yawReport, result, yawFlags)?.code).toBe("yaw_drift");
    expect(rejectionFor(yawReport, result, { ...yawFlags, yawReject: false })).toBeNull();
    expect(buildReport({ capture: turning, frames, flags }).yaw.status).toBe("off");
  });

  it("turns accelerometer step times into video seconds", () => {
    const cap = capture({ tilt: () => 3, steps: 4 });
    expect(stepTimesSec(cap, 10)).toEqual([0.5, 1, 1.5, 2]);
    expect(stepTimesSec(null, 10)).toEqual([]);
  });
});
