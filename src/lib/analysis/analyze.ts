/**
 * Foot-progression-angle analysis from a series of MediaPipe pose frames.
 *
 * Setup assumed: a fixed camera at about knee height, the person walks toward it.
 *
 * Conventions
 *  - Image axes: x right, y down. "Left"/"right" are the model's labels: for a person facing the
 *    camera the model's left foot is on the image-right.
 *  - Reported angles are foot progression angles: degrees between the heel->toe direction and the
 *    walking direction on the ground plane. Toe-out (toes pointing away from the body midline) is
 *    positive, toe-in is negative.
 *  - World landmarks (meters, hip-centred) are assumed to be expressed in a frame that looks along the
 *    camera -> person line of sight (WorldFrame "los"); the crop the network sees is centred on the
 *    person, so its 3D output has no idea about the person's bearing in the full frame. Whether that
 *    is true is NOT verified; the "axis" option and /validate exist to find out.
 *
 * Pipeline
 *  1. Build landmark tracks (pixels / world vectors), drop low-visibility or clipped frames, smooth.
 *  2. Walking = torso size growing (person approaches the camera). Stance can only occur then.
 *  3. A foot is on the ground when both its heel and foot-index landmarks stay still (the camera is
 *     fixed, so a planted foot does not move in the image) and the foot is roughly flat.
 *  4. For each stance run, measure the heel->toe direction per frame (world vector or image-plane
 *     lateral offset), correct for the walking direction, take the median -> one angle per step.
 *  5. Drop unstable / low-confidence / outlier steps, average per foot, report left, right, asymmetry.
 *
 * Everything here is pure and deterministic so it can be unit-tested on synthetic landmark sequences
 * (src/lib/analysis/synthetic.ts). Passing those tests proves the geometry is self-consistent, NOT that
 * the real pose model is accurate - that is what /validate measures.
 */
import { GATE_FAILURE_MESSAGES } from "../sensors/messages";
import { aggregateFoot, qualityOf, rejectOutliers } from "./aggregate";
import { LM } from "./landmarks";
import {
  DEG,
  RAD,
  clamp,
  closeGaps,
  findRuns,
  gaussianSmooth,
  localSlope,
  mean,
  median,
  percentile,
  robustSigma,
  theilSen,
  unroll,
} from "./math";
import { DEFAULT_ANALYSIS_OPTIONS } from "./options";
import type {
  AnalysisOptions,
  AnalysisResult,
  FailureCode,
  Foot,
  FrameDebug,
  Lm,
  PoseFrame,
  StepResult,
  VideoInfo,
} from "./types";

export const FAILURE_MESSAGES: Record<FailureCode, string> = {
  too_short: "That clip is too short to analyse. Record about 10 seconds of walking.",
  no_pose: "We couldn't find a person in the video. Keep your whole body in view, with good light.",
  no_feet: "We couldn't find your feet in the video.",
  no_approach: "We didn't see you walking toward the phone. Start 3–4 m away and walk straight at it.",
  no_steps: "We couldn't get a clear read of your feet. Keep both feet in view and the phone low and steady.",
  no_steps_left: "We couldn't get a clear read of your left foot. Keep both feet in view and the phone low and steady.",
  no_steps_right: "We couldn't get a clear read of your right foot. Keep both feet in view and the phone low and steady.",
  ...GATE_FAILURE_MESSAGES,
};

const FOOT_LM = {
  left: { heel: LM.L_HEEL, toe: LM.L_FOOT_INDEX },
  right: { heel: LM.R_HEEL, toe: LM.R_FOOT_INDEX },
} as const;

const FEET: Foot[] = ["left", "right"];
const other = (f: Foot): Foot => (f === "left" ? "right" : "left");
const isFin = Number.isFinite;

interface FootTracks {
  /** smoothed pixel positions (NaN where unusable) */
  heelX: Float64Array;
  heelY: Float64Array;
  toeX: Float64Array;
  toeY: Float64Array;
  /** smoothed world heel->toe vector in the model's raw axes */
  wdx: Float64Array;
  wdy: Float64Array;
  wdz: Float64Array;
  /** raw min(heel, toe) visibility */
  vis: Float64Array;
}

function emptyFootDebug() {
  return { valid: false, stationary: false, flat: false, usable: false, step: -1 };
}

export function analyze(
  frames: PoseFrame[],
  video: VideoInfo,
  partial: Partial<AnalysisOptions> = {},
): AnalysisResult {
  const o: AnalysisOptions = { ...DEFAULT_ANALYSIS_OPTIONS, ...partial };
  const n = frames.length;
  const warnings: string[] = [];
  const W = video.width;
  const H = video.height;
  const longSide = Math.max(W, H);
  const focalPx = longSide / (2 * Math.tan((o.longSideFovDeg * RAD) / 2));
  const cx = W / 2;

  let dt = 1 / (video.fps > 0 ? video.fps : 30);
  if (n > 1) dt = (frames[n - 1].t - frames[0].t) / (n - 1);
  if (!(dt > 0)) dt = 1 / 30;
  const fps = 1 / dt;
  const sigma = Math.max(0.01, o.smoothSigmaSec * fps);

  const debug: FrameDebug[] = Array.from({ length: n }, () => ({
    approach: false,
    rate: NaN,
    left: emptyFootDebug(),
    right: emptyFootDebug(),
  }));
  const posedFrames = frames.reduce((c, f) => c + (f.ok && f.img && f.world ? 1 : 0), 0);

  const result: AnalysisResult = {
    ok: false,
    leftDeg: null,
    rightDeg: null,
    asymmetryDeg: null,
    leftSteps: 0,
    rightSteps: 0,
    quality: "none",
    steps: [],
    heading: { psiDeg: 0, fitted: false, points: 0, rollDeg: 0 },
    calibration: {
      lateralSign: 1,
      worldAxisSign: { x: 1, y: 1, z: 1 },
      torsoToFootRatio: 2.1,
      focalPx,
    },
    warnings,
    frames: debug,
    stats: { frames: n, posedFrames, approachFrames: 0, fps },
    mode: "front",
    swapLeftRight: o.swapLeftRight,
  };
  const fail = (code: FailureCode): AnalysisResult => {
    result.ok = false;
    result.failure = { code, message: FAILURE_MESSAGES[code] };
    return result;
  };

  if (n < 10 || frames[n - 1].t - frames[0].t < 1) return fail("too_short");
  if (posedFrames / n < 0.25) return fail("no_pose");

  const nanArr = () => new Float64Array(n).fill(NaN);
  const smooth = (a: Float64Array) => gaussianSmooth(a, sigma, 2);

  // ---- 1. torso tracks ------------------------------------------------------------------------
  const hipXr = nanArr();
  const hipYr = nanArr();
  const shoXr = nanArr();
  const shoYr = nanArr();
  for (let i = 0; i < n; i++) {
    const fr = frames[i];
    const im = fr.ok ? fr.img : null;
    if (!im) continue;
    const need = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];
    if (need.some((k) => !(im[k].v >= o.minVisibility))) continue;
    hipXr[i] = ((im[LM.L_HIP].x + im[LM.R_HIP].x) / 2) * W;
    hipYr[i] = ((im[LM.L_HIP].y + im[LM.R_HIP].y) / 2) * H;
    shoXr[i] = ((im[LM.L_SHOULDER].x + im[LM.R_SHOULDER].x) / 2) * W;
    shoYr[i] = ((im[LM.L_SHOULDER].y + im[LM.R_SHOULDER].y) / 2) * H;
  }
  const hipX = smooth(hipXr);
  const hipY = smooth(hipYr);
  const shoX = smooth(shoXr);
  const shoY = smooth(shoYr);
  const torso = nanArr();
  for (let i = 0; i < n; i++) {
    if (isFin(hipX[i]) && isFin(hipY[i]) && isFin(shoX[i]) && isFin(shoY[i])) {
      const t = Math.hypot(shoX[i] - hipX[i], shoY[i] - hipY[i]);
      if (t > 5) torso[i] = t;
    }
  }
  const torsoValid = Uint8Array.from(torso, (v) => (isFin(v) ? 1 : 0));

  // ---- 2. foot tracks -------------------------------------------------------------------------
  const inFrame = (p: Lm) =>
    p.x >= o.frameMargin && p.x <= 1 - o.frameMargin && p.y >= o.frameMargin && p.y <= 1 - o.frameMargin;

  const buildFoot = (foot: Foot): FootTracks => {
    const { heel: hi, toe: ti } = FOOT_LM[foot];
    const hx = nanArr();
    const hy = nanArr();
    const tx = nanArr();
    const ty = nanArr();
    const dx = nanArr();
    const dy = nanArr();
    const dz = nanArr();
    const vis = nanArr();
    for (let i = 0; i < n; i++) {
      const fr = frames[i];
      if (!fr.ok || !fr.img || !fr.world) continue;
      const h = fr.img[hi];
      const t = fr.img[ti];
      const v = Math.min(h.v, t.v);
      if (!(v >= o.minVisibility) || !inFrame(h) || !inFrame(t)) continue;
      hx[i] = h.x * W;
      hy[i] = h.y * H;
      tx[i] = t.x * W;
      ty[i] = t.y * H;
      const wh = fr.world[hi];
      const wt = fr.world[ti];
      dx[i] = wt.x - wh.x;
      dy[i] = wt.y - wh.y;
      dz[i] = wt.z - wh.z;
      vis[i] = v;
    }
    return {
      heelX: smooth(hx),
      heelY: smooth(hy),
      toeX: smooth(tx),
      toeY: smooth(ty),
      wdx: smooth(dx),
      wdy: smooth(dy),
      wdz: smooth(dz),
      vis,
    };
  };
  const tracks: Record<Foot, FootTracks> = { left: buildFoot("left"), right: buildFoot("right") };

  // ---- 3. calibration from the clip itself ----------------------------------------------------
  // 3a. Which image side is the model's "left" foot on? (+1 = image-right = person facing the camera)
  const sideDiffs: number[] = [];
  for (let i = 0; i < n; i++) {
    const L = tracks.left;
    const R = tracks.right;
    if (isFin(L.heelX[i]) && isFin(L.toeX[i]) && isFin(R.heelX[i]) && isFin(R.toeX[i])) {
      sideDiffs.push((L.heelX[i] + L.toeX[i]) / 2 - (R.heelX[i] + R.toeX[i]) / 2);
    }
  }
  const medSide = median(sideDiffs);
  let lateralSign: 1 | -1 = 1;
  if (isFin(medSide)) {
    lateralSign = medSide >= 0 ? 1 : -1;
    if (lateralSign < 0) {
      warnings.push("The model's left foot is on the image-left: are you facing the camera? (walking away gives unusable angles)");
    } else if (Math.abs(medSide) < 0.01 * W) {
      warnings.push("Left and right feet are almost on top of each other in the image; left/right labels may be unreliable.");
    }
  }

  // 3b. Orientation of the world axes + body proportions (needed for the image-plane estimator).
  const wHip: number[] = [];
  const iHip: number[] = [];
  const wTorsoY: number[] = [];
  const ratios: number[] = [];
  for (let i = 0; i < n; i++) {
    const fr = frames[i];
    if (!fr.ok || !fr.img || !fr.world) continue;
    const w = fr.world;
    const im = fr.img;
    wHip.push(w[LM.L_HIP].x - w[LM.R_HIP].x);
    iHip.push(im[LM.L_HIP].x - im[LM.R_HIP].x);
    const hipC = { x: (w[LM.L_HIP].x + w[LM.R_HIP].x) / 2, y: (w[LM.L_HIP].y + w[LM.R_HIP].y) / 2, z: (w[LM.L_HIP].z + w[LM.R_HIP].z) / 2 };
    const shoC = { x: (w[LM.L_SHOULDER].x + w[LM.R_SHOULDER].x) / 2, y: (w[LM.L_SHOULDER].y + w[LM.R_SHOULDER].y) / 2, z: (w[LM.L_SHOULDER].z + w[LM.R_SHOULDER].z) / 2 };
    wTorsoY.push(hipC.y - shoC.y);
    const torso3 = Math.hypot(hipC.x - shoC.x, hipC.y - shoC.y, hipC.z - shoC.z);
    const footLens = FEET.map((f) => {
      const a = w[FOOT_LM[f].heel];
      const b = w[FOOT_LM[f].toe];
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    });
    const foot3 = (footLens[0] + footLens[1]) / 2;
    if (foot3 > 0.05) ratios.push(torso3 / foot3);
  }
  const axis = { x: 1 as 1 | -1, y: 1 as 1 | -1, z: 1 as 1 | -1 };
  const mw = median(wHip);
  const mi = median(iHip);
  if (isFin(mw) && isFin(mi) && Math.abs(mw) > 0.02 && Math.abs(mi) > 0.01 && mw * mi < 0) {
    axis.x = -1;
    warnings.push("World-landmark x axis points opposite to the image x axis; flipped automatically.");
  }
  const mty = median(wTorsoY);
  if (isFin(mty) && mty < -0.05) {
    axis.y = -1;
    warnings.push("World-landmark y axis points up; flipped automatically.");
  }
  const fwdSamples: number[] = [];
  for (const f of FEET) {
    for (let i = 0; i < n; i++) if (isFin(tracks[f].wdz[i])) fwdSamples.push(-tracks[f].wdz[i]);
  }
  const mf = median(fwdSamples);
  if (isFin(mf) && mf < -0.01) {
    axis.z = -1;
    warnings.push("World-landmark z axis points away from the camera for the toes; flipped automatically.");
  }
  const ratioMed = median(ratios);
  const torsoToFootRatio = isFin(ratioMed) ? clamp(ratioMed, 1.6, 2.8) : 2.1;

  // 3c. Phone roll from the torso direction (positive = torso leans clockwise on screen).
  let tau = 0;
  if (o.rollCompensation) {
    const taus: number[] = [];
    for (let i = 0; i < n; i++) {
      if (isFin(hipX[i]) && isFin(shoX[i])) taus.push(Math.atan2(shoX[i] - hipX[i], hipY[i] - shoY[i]));
    }
    const m = median(taus);
    if (isFin(m)) tau = clamp(m, -20 * RAD, 20 * RAD);
  }
  result.heading.rollDeg = tau * DEG;
  result.calibration = { lateralSign, worldAxisSign: axis, torsoToFootRatio, focalPx };

  // ---- 4. walking toward the camera? ----------------------------------------------------------
  const logS = torso.map((v) => (isFin(v) ? Math.log(v) : NaN));
  const rateHalf = Math.max(2, Math.round(0.25 * fps));
  const rate = nanArr();
  const approachRaw = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = localSlope(logS, i, rateHalf);
    if (isFin(s)) {
      rate[i] = s * fps;
      approachRaw[i] = rate[i] >= o.minApproachRate ? 1 : 0;
    }
  }
  const approach = closeGaps(approachRaw, torsoValid, Math.round(0.3 * fps));
  let approachFrames = 0;
  for (let i = 0; i < n; i++) {
    debug[i].approach = approach[i] === 1;
    debug[i].rate = rate[i];
    approachFrames += approach[i];
  }
  result.stats.approachFrames = approachFrames;

  // Hip position with the phone roll removed (rotation about the image centre), so the bearing and the
  // path fit below are measured against the true horizontal.
  const cy = H / 2;
  const hipXu = nanArr();
  for (let i = 0; i < n; i++) {
    if (isFin(hipX[i]) && isFin(hipY[i])) hipXu[i] = cx + unroll(hipX[i] - cx, hipY[i] - cy, tau)[0];
  }

  // Bearing of the person as seen from the camera (positive = image-right), degrees.
  const beta = nanArr();
  for (let i = 0; i < n; i++) if (isFin(hipXu[i])) beta[i] = Math.atan((hipXu[i] - cx) / focalPx) * DEG;

  // Walking direction: fit the pelvis path on the ground plane. With torso length s (px) as a depth
  // proxy, X/K = (u - cx) / s and Z/K = f / s share the unknown torso length K, so the slope dX/dZ
  // (and the heading angle) does not depend on it.
  let psi = 0;
  {
    const zs: number[] = [];
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      if (approach[i] && isFin(torso[i]) && isFin(hipXu[i])) {
        zs.push(focalPx / torso[i]);
        xs.push((hipXu[i] - cx) / torso[i]);
      }
    }
    result.heading.points = zs.length;
    if (zs.length >= 20) {
      const spread = (percentile(zs, 0.9) - percentile(zs, 0.1)) / median(zs);
      if (spread >= 0.2) {
        const fit = theilSen(zs, xs);
        if (fit) {
          psi = clamp(-Math.atan(fit.slope) * DEG, -30, 30);
          result.heading.fitted = true;
        }
      }
    }
    if (!result.heading.fitted && o.heading === "path" && approachFrames >= Math.round(0.5 * fps)) {
      warnings.push("Walking direction could not be fitted; assuming you walked straight at the phone.");
    }
  }
  result.heading.psiDeg = psi;
  const headingAt = (i: number) => (o.heading === "path" ? psi + (isFin(beta[i]) ? beta[i] : 0) : 0);

  // ---- 5. per-foot stance detection and angle measurement ------------------------------------
  const steps: StepResult[] = [];
  const reportedFoot = (side: Foot): Foot => (o.swapLeftRight ? other(side) : side);
  const halfWin = Math.max(1, Math.round((o.stationaryWindowSec * fps) / 2));

  for (const side of FEET) {
    const F = tracks[side];
    const O = tracks[other(side)];
    const reported = reportedFoot(side);
    const sideSign = side === "left" ? lateralSign : (-lateralSign as 1 | -1);

    // median horizontal foot length (world) -> gate for degenerate vectors
    const lens: number[] = [];
    for (let i = 0; i < n; i++) if (isFin(F.wdx[i]) && isFin(F.wdz[i])) lens.push(Math.hypot(F.wdx[i], F.wdz[i]));
    const footLenMed = median(lens);

    const frameAlpha = (i: number): number => {
      const b = beta[i];
      if (o.method === "image") {
        const [lat] = unroll(F.toeX[i] - F.heelX[i], F.toeY[i] - F.heelY[i], tau);
        const cosB = isFin(b) ? Math.cos(b * RAD) : 1;
        const s = clamp((lat / torso[i]) * torsoToFootRatio * cosB, -0.95, 0.95);
        return Math.asin(s) * DEG;
      }
      if (!isFin(F.wdx[i]) || !isFin(F.wdy[i]) || !isFin(F.wdz[i])) return NaN;
      const [lat] = unroll(axis.x * F.wdx[i], axis.y * F.wdy[i], tau);
      const fwd = -(axis.z * F.wdz[i]);
      if (!isFin(footLenMed) || Math.hypot(lat, fwd) < 0.4 * footLenMed) return NaN;
      let a = Math.atan2(lat, fwd) * DEG;
      if (o.worldFrame === "axis" && isFin(b)) a += b;
      return a;
    };

    const valid = new Uint8Array(n);
    const stationary = new Uint8Array(n);
    const flat = new Uint8Array(n);
    const usable = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      valid[i] =
        isFin(F.heelX[i]) && isFin(F.heelY[i]) && isFin(F.toeX[i]) && isFin(F.toeY[i]) && isFin(torso[i]) ? 1 : 0;
    }
    for (let i = 0; i < n; i++) {
      if (isFin(F.wdx[i]) && isFin(F.wdy[i]) && isFin(F.wdz[i])) {
        const pitch = Math.atan2(Math.abs(F.wdy[i]), Math.hypot(F.wdx[i], F.wdz[i])) * DEG;
        flat[i] = pitch <= o.maxFootPitchDeg ? 1 : 0;
      } else {
        flat[i] = 1; // unknown: do not reject on flatness alone
      }
      if (!valid[i]) continue;
      let ok = true;
      let hxMin = Infinity, hxMax = -Infinity, hyMin = Infinity, hyMax = -Infinity;
      let txMin = Infinity, txMax = -Infinity, tyMin = Infinity, tyMax = -Infinity;
      for (let j = i - halfWin; j <= i + halfWin; j++) {
        if (j < 0 || j >= n || !valid[j]) {
          ok = false;
          break;
        }
        hxMin = Math.min(hxMin, F.heelX[j]); hxMax = Math.max(hxMax, F.heelX[j]);
        hyMin = Math.min(hyMin, F.heelY[j]); hyMax = Math.max(hyMax, F.heelY[j]);
        txMin = Math.min(txMin, F.toeX[j]); txMax = Math.max(txMax, F.toeX[j]);
        tyMin = Math.min(tyMin, F.toeY[j]); tyMax = Math.max(tyMax, F.toeY[j]);
      }
      if (ok) {
        const range = Math.max(hxMax - hxMin, hyMax - hyMin, txMax - txMin, tyMax - tyMin);
        stationary[i] = range <= o.stationaryMaxRange * torso[i] ? 1 : 0;
      }
    }
    for (let i = 0; i < n; i++) usable[i] = valid[i] && stationary[i] && flat[i] && approach[i] ? 1 : 0;
    const usableClosed = closeGaps(usable, valid, 1);

    for (let i = 0; i < n; i++) {
      const d = debug[i][reported];
      d.valid = valid[i] === 1;
      d.stationary = stationary[i] === 1;
      d.flat = flat[i] === 1;
      d.usable = usableClosed[i] === 1;
    }

    for (const [a, b] of findRuns(usableClosed)) {
      const durSec = (b - a + 1) * dt;
      if (durSec < o.minStanceSec) continue;

      const len = b - a + 1;
      const trim = Math.floor(len * o.trimFraction);
      let ua = a + trim;
      let ub = b - trim;
      if (ub - ua + 1 < 3) {
        ua = a;
        ub = b;
      }

      const alphas: number[] = [];
      const fpas: number[] = [];
      const hs: number[] = [];
      const visList: number[] = [];
      const torsoList: number[] = [];
      let crossed = 0;
      let checked = 0;
      for (let i = ua; i <= ub; i++) {
        const al = frameAlpha(i);
        if (!isFin(al)) continue;
        const h = headingAt(i);
        alphas.push(al);
        hs.push(h);
        fpas.push(sideSign * (al - h));
        visList.push(F.vis[i]);
        torsoList.push(torso[i]);
        const ownMid = (F.heelX[i] + F.toeX[i]) / 2;
        const otherMid = (O.heelX[i] + O.toeX[i]) / 2;
        if (isFin(otherMid)) {
          checked++;
          if (sideSign * (ownMid - otherMid) < -0.15 * torso[i]) crossed++;
        }
      }

      const nUsed = fpas.length;
      const angle = nUsed ? median(fpas) : NaN;
      const spread = nUsed ? robustSigma(fpas) : NaN;
      const meanTorso = mean(torsoList);
      const meanVis = mean(visList);
      const scaleFactor = clamp(meanTorso / (o.fullConfidenceTorsoFrac * longSide), 0.25, 1);
      const countFactor = clamp(nUsed / 8, 0.25, 1);
      const spreadFactor = isFin(spread) ? 1 / (1 + (spread / 15) ** 2) : 0;
      const confidence = nUsed ? clamp((isFin(meanVis) ? meanVis : 0.5) * scaleFactor * countFactor * spreadFactor, 0, 1) : 0;

      let reason: string | undefined;
      if (durSec > o.maxStanceSec) reason = "too long for a walking step (standing still?)";
      else if (nUsed < o.minStepFrames) reason = `only ${nUsed} usable frame${nUsed === 1 ? "" : "s"}`;
      else if (spread > o.maxStepSpreadDeg) reason = `unstable (±${spread.toFixed(0)}° scatter)`;
      else if (checked >= 3 && crossed / checked > 0.3) reason = "feet crossed / left-right mix-up";
      else if (confidence < o.minStepConfidence) reason = `low confidence (${confidence.toFixed(2)})`;

      const idx = steps.length;
      steps.push({
        foot: reported,
        startIdx: a,
        endIdx: b,
        usedStartIdx: ua,
        usedEndIdx: ub,
        tStart: frames[a].t,
        tEnd: frames[b].t,
        nFrames: nUsed,
        angleDeg: angle,
        losAngleDeg: nUsed ? sideSign * median(alphas) : NaN,
        headingDeg: nUsed ? sideSign * median(hs) : NaN,
        spreadDeg: spread,
        confidence,
        approxDistanceM: (focalPx * 0.5) / meanTorso,
        used: !reason,
        discardReason: reason,
      });
      for (let i = a; i <= b; i++) debug[i][reported].step = idx;
    }
  }

  // Foot-level outlier rejection (needs >= 3 steps to be meaningful).
  rejectOutliers(steps, o.outlierFloorDeg, o.outlierMadK);
  steps.sort((a, b) => a.startIdx - b.startIdx);
  // indices changed by sorting: refresh the per-frame links
  for (const d of debug) {
    d.left.step = -1;
    d.right.step = -1;
  }
  steps.forEach((s, idx) => {
    for (let i = s.startIdx; i <= s.endIdx; i++) debug[i][s.foot].step = idx;
  });
  result.steps = steps;

  // ---- 6. aggregate ---------------------------------------------------------------------------
  const L = aggregateFoot(steps, "left");
  const R = aggregateFoot(steps, "right");
  result.leftDeg = L.value;
  result.rightDeg = R.value;
  result.leftSteps = L.n;
  result.rightSteps = R.n;
  result.asymmetryDeg = L.value !== null && R.value !== null ? Math.abs(L.value - R.value) : null;
  result.quality = qualityOf(steps, L.n, R.n);

  if (approachFrames < Math.round(0.5 * fps)) return fail("no_approach");
  if (L.n === 0 && R.n === 0) return fail("no_steps");
  if (L.n === 0) return fail("no_steps_left");
  if (R.n === 0) return fail("no_steps_right");

  result.ok = true;
  return result;
}
