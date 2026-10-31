/**
 * Foot-progression-angle analysis for the top-down capture: the person holds the phone in one hand pointing
 * straight down at their feet and records ~10 seconds of normal walking (or standing).
 *
 * Conventions
 *  - Image coords: x right, y down. A blob's long axis is measured in the image; "up" = toward y = 0.
 *  - The phone moves with the walker, so a planted foot slides backward through the image at ground speed and
 *    the walking direction is the OPPOSITE of that motion. The median velocity of the two feet over the clip is
 *    the ground flow (a foot is planted ~60 % of the time), so the walking direction needs no assumption about
 *    how the phone is held. With no ground motion (standing, marching in place) we assume the phone's top edge
 *    points forward and say so.
 *  - Reported angles are foot progression angles relative to the walking direction: toe-out positive, toe-in
 *    negative. The person's left foot is the one on the left of the walking direction.
 *  - A foot is "planted" when its image velocity equals the ground flow (it is not moving over the ground) and
 *    its silhouette is stable (area / elongation near the foot's median, so the heel is not lifting).
 *
 * Like the front-view analyzer this is pure and deterministic. Passing the synthetic tests proves the
 * geometry is self-consistent; whether real footage segments well is what /validate measures.
 */
import { aggregateFoot, qualityOf, rejectOutliers } from "../analysis/aggregate";
import { DEG, clamp, closeGaps, findRuns, gaussianSmooth, mean, median, robustSigma, weightedMedian } from "../analysis/math";
import type { AnalysisResult, FailureCode, Foot, FrameDebug, StepResult, VideoInfo } from "../analysis/types";
import { GATE_FAILURE_MESSAGES } from "../sensors/messages";
import type { FootBlob } from "./segment";

export interface TopDownFrame {
  /** seconds from the start of the video */
  t: number;
  /** feet found in this frame, sorted by x (at most two) */
  blobs: FootBlob[];
  /** the phone's tilt in this frame (degrees from straight down), when the sensors gave one */
  tiltDeg?: number;
  /** false = tilted past the limit: the frame is left out of the foot-angle averaging (it still helps find the walking direction) */
  reliable?: boolean;
  /** experimental: how the floor texture moved since the previous sampled frame, work-image pixels (see floorflow.ts) */
  flow?: { dx: number; dy: number; confidence: number };
}

export interface TopDownOptions {
  /** Blobs scoring below this are ignored. */
  minBlobScore: number;
  /** Blobs touching the frame edge have a biased axis; ignore them unless this is true. */
  allowClipped: boolean;
  /** Gaussian smoothing of foot positions, seconds. */
  smoothSigmaSec: number;
  /** Clips whose ground flow is slower than this (foot lengths per second) count as "standing". */
  minWalkSpeed: number;
  /** A foot is planted when its velocity differs from the ground flow by at most this (foot lengths per second). */
  plantedTolerance: number;
  /** Planted frames must keep the foot's silhouette within +/- this fraction of its median area / elongation. */
  shapeTolerance: number;
  minStanceSec: number;
  trimFraction: number;
  minStepFrames: number;
  /** Steps whose per-frame angles scatter more than this (robust sigma, degrees) are discarded. */
  maxStepSpreadDeg: number;
  minStepConfidence: number;
  /**
   * 0 = measure every stance against ONE walking direction for the whole clip (the default). 1 = measure each stance
   * against the direction its own foot slid through the picture during that stance, which cancels the phone's yaw
   * sway (the picture rotates under the feet) but trusts a few frames of foot motion. Values in between blend the two.
   * Not the default until /validate shows on real clips that it is better.
   */
  headingBlend: number;
  /**
   * Walking direction = the average of the left and right foot's own ground-flow clusters (default) instead of the
   * single densest cluster. Side-to-side sway of the phone makes the two feet's planted velocities lean opposite ways;
   * the densest cluster is then just one of them and shifts both angles by several degrees.
   */
  balanceFeet: boolean;
  /**
   * Step times in video seconds from the phone's accelerometer (heel strikes). A stance run that starts near one is
   * measured mostly from its middle (about 0.3 of a stride after the strike) and keeps its confidence the closer the
   * two agree; a run no step explains loses 15 % of it. null = no sensor timing: nothing changes.
   */
  stepTimesSec: number[] | null;
  /**
   * Which way the toes of the foot the person tapped point in the picture (unit vector, image coordinates; see seed.ts).
   * Used only for a clip with no ground motion, which has no other way to tell which edge of the picture faces forward: forward
   * is then the side of the picture the toes point to (up or down), not always the top edge. With walking, the ground flow decides.
   */
  seedToeDir: [number, number] | null;
  outlierFloorDeg: number;
  outlierMadK: number;
  /** Swap the reported feet (e.g. the phone was held with its top edge toward the body while standing still). */
  swapLeftRight: boolean;
  /** Constant corrections (degrees, toe-out positive) to remove a bias measured by /validate. */
  angleOffsetLeftDeg: number;
  angleOffsetRightDeg: number;
}

export const DEFAULT_TOPDOWN_OPTIONS: TopDownOptions = {
  minBlobScore: 0.45,
  allowClipped: false,
  smoothSigmaSec: 0.07,
  minWalkSpeed: 0.6,
  plantedTolerance: 1.2,
  shapeTolerance: 0.3,
  minStanceSec: 0.2,
  trimFraction: 0.2,
  minStepFrames: 3,
  maxStepSpreadDeg: 8,
  minStepConfidence: 0.2,
  headingBlend: 0,
  balanceFeet: true,
  stepTimesSec: null,
  seedToeDir: null,
  outlierFloorDeg: 8,
  outlierMadK: 3,
  swapLeftRight: false,
  angleOffsetLeftDeg: 0,
  angleOffsetRightDeg: 0,
};

/** Estimator presets compared on /validate for the top-down mode. The first is the app default. */
export const TOPDOWN_PRESETS: ReadonlyArray<{ id: string; label: string; options: Partial<TopDownOptions> }> = [
  { id: "td-default", label: "top-down: stance frames, walking direction from ground flow (default)", options: {} },
  { id: "td-loose", label: "top-down: looser planted / shape tests", options: { plantedTolerance: 2.2, shapeTolerance: 0.45 } },
  { id: "td-strict", label: "top-down: stricter planted / shape tests", options: { plantedTolerance: 0.8, shapeTolerance: 0.2 } },
  { id: "td-clipped", label: "top-down: also use blobs touching the frame edge", options: { allowClipped: true } },
  { id: "td-single-cluster", label: "top-down: walking direction from the single densest ground-flow cluster (the old default)", options: { balanceFeet: false } },
  { id: "td-hybrid-heading", label: "top-down: walking direction half from each stance's own foot motion (cancels phone yaw sway, but trusts a few frames)", options: { headingBlend: 0.5 } },
];

/** A stance whose own foot motion points further than this from the clip's walking direction is measured against the clip's direction instead. */
const MAX_LOCAL_HEADING_DEV_DEG = 20;

/**
 * Share of the frames in which two whole feet were found: the same test the live "Feet visible" check applies to the preview
 * (score at least `minScore`, not cut by the frame edge). null when there are no frames.
 */
export function bothFeetShare(frames: TopDownFrame[], minScore: number = DEFAULT_TOPDOWN_OPTIONS.minBlobScore): number | null {
  if (!frames.length) return null;
  return frames.filter((f) => f.blobs.filter((b) => b.score >= minScore && !b.clipped).length >= 2).length / frames.length;
}

/** The edge of the picture a direction points to most (up, right, down or left); a tie goes to up / down. No direction means up. */
export function cardinalDirection(v: [number, number] | null): [number, number] {
  if (!v || Math.hypot(v[0], v[1]) < 1e-6) return [0, -1];
  return Math.abs(v[0]) > Math.abs(v[1]) ? [Math.sign(v[0]), 0] : [0, v[1] < 0 ? -1 : 1];
}

export const TOPDOWN_FAILURE_MESSAGES: Record<FailureCode, string> = {
  ...GATE_FAILURE_MESSAGES,
  too_short: "That clip is too short. Record about 10 seconds of your feet.",
  no_pose: "We couldn't find your feet in the video.",
  no_feet:
    "We couldn't find your feet. Use bare feet on a plain, evenly lit floor, point the phone straight down and keep both feet in view.",
  no_approach: "We couldn't see your feet moving clearly.",
  no_steps:
    "We couldn't get a steady read of your feet. Keep both feet fully in view (not cut off by the edges), the phone pointing straight down, and take a few relaxed steps.",
  no_steps_left:
    "We couldn't get a steady read of your left foot. Keep it fully in view, not cut off by the edge of the picture.",
  no_steps_right:
    "We couldn't get a steady read of your right foot. Keep it fully in view, not cut off by the edge of the picture.",
};

interface Track {
  present: Uint8Array;
  blob: Array<FootBlob | null>;
  /** index of the blob in frames[i].blobs, or -1 */
  blobIdx: Int16Array;
  /** centroid in isotropic pixels (NaN where absent) */
  x: Float64Array;
  y: Float64Array;
}

function emptyFootDebug() {
  return { valid: false, stationary: false, flat: false, usable: false, step: -1 };
}

export function analyzeTopDown(
  frames: TopDownFrame[],
  video: VideoInfo,
  partial: Partial<TopDownOptions> = {},
): AnalysisResult {
  const o: TopDownOptions = { ...DEFAULT_TOPDOWN_OPTIONS, ...partial };
  const n = frames.length;
  const W = video.width;
  const H = video.height;
  const warnings: string[] = [];

  let dt = 1 / (video.fps > 0 ? video.fps : 15);
  if (n > 1) dt = (frames[n - 1].t - frames[0].t) / (n - 1);
  if (!(dt > 0)) dt = 1 / 15;
  const fps = 1 / dt;
  const sigma = Math.max(0.01, o.smoothSigmaSec * fps);

  const debug: FrameDebug[] = Array.from({ length: n }, () => ({
    approach: false,
    rate: NaN,
    left: emptyFootDebug(),
    right: emptyFootDebug(),
  }));

  const usableBlobs = (f: TopDownFrame) =>
    f.blobs.filter((b) => b.score >= o.minBlobScore && (o.allowClipped || !b.clipped));

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
    calibration: { lateralSign: 1, worldAxisSign: { x: 1, y: 1, z: 1 }, torsoToFootRatio: 0, focalPx: 0 },
    warnings,
    frames: debug,
    stats: { frames: n, posedFrames: frames.filter((f) => usableBlobs(f).length > 0).length, approachFrames: 0, fps },
    mode: "topdown",
    swapLeftRight: o.swapLeftRight,
  };
  const fail = (code: FailureCode): AnalysisResult => {
    result.ok = false;
    result.failure = { code, message: TOPDOWN_FAILURE_MESSAGES[code] };
    return result;
  };

  if (n < 8 || frames[n - 1].t - frames[0].t < 1.5) return fail("too_short");
  if (result.stats.posedFrames / n < 0.2) return fail("no_feet");

  // Midline between the feet from frames that show both.
  const mids: Array<[number, number]> = [];
  for (const f of frames) {
    const b = usableBlobs(f);
    if (b.length === 2) mids.push([((b[0].cx + b[1].cx) / 2) * W, ((b[0].cy + b[1].cy) / 2) * H]);
  }
  let mid: [number, number] = [0.5 * W, 0.5 * H];
  if (mids.length >= 3) mid = [median(mids.map((m) => m[0])), median(mids.map((m) => m[1]))];
  else warnings.push("Both feet were rarely visible at the same time; left/right is guessed from the picture's centre line.");

  // Forward direction f (unit, image coords). Start with "up"; refine from the ground flow below. A clip with no ground motion
  // keeps "up" unless the person marked a foot whose toes point to another edge of the picture.
  const standingFwd = cardinalDirection(o.seedToeDir);
  let fwd: [number, number] = [0, -1];
  let walking = false;
  let flow: [number, number] = [0, 0];
  let flowSamples = 0;
  let tracks: Record<Foot, Track> = buildTracks(frames, usableBlobs, W, H, mid, fwd, sigma);

  for (let pass = 0; pass < 3; pass++) {
    const footLenPx = footLength(frames, usableBlobs, H);
    const est = estimateFlow(tracks, dt, footLenPx, o.minWalkSpeed, o.balanceFeet);
    walking = est.walking;
    flow = est.flow;
    flowSamples = est.samples;
    const next: [number, number] = walking ? [-flow[0] / Math.hypot(...flow), -flow[1] / Math.hypot(...flow)] : standingFwd;
    // (any real change, about 1 degree: a phone rotated 10-20 degrees used to keep the sides built for "up", and when the
    // feet were far apart along the walking direction that swapped left and right in a quarter of the frames)
    const changed = Math.hypot(next[0] - fwd[0], next[1] - fwd[1]) > 0.02;
    fwd = next;
    if (!changed) break;
    // the phone is rotated relative to the walking direction: sides must follow the new forward axis
    tracks = buildTracks(frames, usableBlobs, W, H, mid, fwd, sigma);
  }
  const psi = (Math.atan2(fwd[0], -fwd[1]) * 180) / Math.PI;
  result.heading = { psiDeg: psi, fitted: walking, points: flowSamples, rollDeg: 0 };
  result.stats.approachFrames = walking ? n : 0;
  result.standing = !walking;
  for (const d of debug) d.approach = walking;
  if (!walking) {
    warnings.push(
      standingFwd[1] === -1
        ? "No ground motion detected: measuring a standing stance and assuming the top of the phone points forward."
        : "No ground motion detected: measuring a standing stance, with forward taken from the way the toes you marked point in the picture.",
    );
  } else if (Math.abs(psi) > 25) {
    warnings.push(`The phone's top edge points ${Math.abs(psi).toFixed(0)}° away from your walking direction; angles are corrected for it.`);
  }

  const footLenPx = footLength(frames, usableBlobs, H);
  const sides: Foot[] = ["left", "right"];
  const reported = (side: Foot): Foot => (o.swapLeftRight ? (side === "left" ? "right" : "left") : side);
  const stepTimes = o.stepTimesSec && o.stepTimesSec.length >= 2 ? [...o.stepTimesSec].sort((x, y) => x - y) : null;
  // one stride = two steps: from the accelerometer's cadence, else a typical 1.1 s
  const strideSec = stepTimes && stepTimes.length >= 3 ? 2 * median(stepTimes.slice(1).map((t, i) => t - stepTimes[i])) : 1.1;
  const steps: StepResult[] = [];

  for (const side of sides) {
    const T = tracks[side];
    const rep = reported(side);
    const sideSign = side === "left" ? -1 : 1; // toe-out = counter-clockwise for the left foot, clockwise for the right

    // velocity from smoothed positions (central differences), px/s
    const vx = new Float64Array(n).fill(NaN);
    const vy = new Float64Array(n).fill(NaN);
    for (let i = 1; i < n - 1; i++) {
      if (Number.isFinite(T.x[i - 1]) && Number.isFinite(T.x[i + 1])) {
        vx[i] = (T.x[i + 1] - T.x[i - 1]) / (2 * dt);
        vy[i] = (T.y[i + 1] - T.y[i - 1]) / (2 * dt);
      }
    }

    // shape reference: median area / elongation of this foot's valid frames
    const areas: number[] = [];
    const elongs: number[] = [];
    for (let i = 0; i < n; i++) {
      const b = T.blob[i];
      if (b) {
        areas.push(b.area);
        elongs.push(b.elongation);
      }
    }
    const medArea = median(areas);
    const medElong = median(elongs);

    const valid = new Uint8Array(n);
    const planted = new Uint8Array(n);
    const flat = new Uint8Array(n);
    const usable = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const b = T.blob[i];
      if (!b) continue;
      valid[i] = 1;
      if (Number.isFinite(vx[i])) {
        const dev = Math.hypot(vx[i] - flow[0], vy[i] - flow[1]);
        planted[i] = dev <= o.plantedTolerance * footLenPx ? 1 : 0;
      }
      const okArea = Math.abs(b.area / medArea - 1) <= o.shapeTolerance;
      const okElong = Math.abs(b.elongation / medElong - 1) <= o.shapeTolerance;
      flat[i] = okArea && okElong ? 1 : 0;
      usable[i] = planted[i] && flat[i] ? 1 : 0;
    }
    const usableClosed = closeGaps(usable, valid, 1);
    for (let i = 0; i < n; i++) {
      const d = debug[i][rep];
      d.valid = valid[i] === 1;
      d.stationary = planted[i] === 1;
      d.flat = flat[i] === 1;
      d.usable = usableClosed[i] === 1;
      d.blobIndex = T.blobIdx[i];
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

      // the walking direction this stance is measured against: the clip's, or (headingBlend) partly its own foot's motion
      let fwdRun = fwd;
      if (walking && o.headingBlend > 0) {
        const own = stanceForward(T, ua, ub, dt, 0.5 * Math.hypot(flow[0], flow[1]));
        if (own && Math.acos(clamp(own[0] * fwd[0] + own[1] * fwd[1], -1, 1)) * DEG <= MAX_LOCAL_HEADING_DEV_DEG) {
          const w = clamp(o.headingBlend, 0, 1);
          const bx = (1 - w) * fwd[0] + w * own[0];
          const by = (1 - w) * fwd[1] + w * own[1];
          const bl = Math.hypot(bx, by);
          if (bl > 1e-6) fwdRun = [bx / bl, by / bl];
        }
      }
      const psiRun = (Math.atan2(fwdRun[0], -fwdRun[1]) * 180) / Math.PI;

      // accelerometer timing: a heel strike near the start of this stance puts its middle about 0.3 of a stride later
      let tMid = Number.NaN;
      let align = 0;
      if (stepTimes) {
        let nearest = Number.NaN;
        let gap = Infinity;
        for (const ts of stepTimes) {
          const d = Math.abs(ts - frames[a].t);
          if (d < gap) {
            gap = d;
            nearest = ts;
          }
        }
        if (gap <= 0.25) {
          tMid = nearest + 0.3 * strideSec;
          align = Math.exp(-0.5 * (gap / 0.12) ** 2);
        }
      }

      const fpas: number[] = [];
      const cams: number[] = [];
      const scores: number[] = [];
      const weights: number[] = [];
      for (let i = ua; i <= ub; i++) {
        const blob = T.blob[i];
        if (!blob) continue;
        if (frames[i].reliable === false) continue; // the phone was tilted too much in this frame
        // toe direction: the long axis, oriented along the walking direction
        const dot = blob.ux * fwdRun[0] + blob.uy * fwdRun[1];
        const sgn = dot >= 0 ? 1 : -1;
        const tx = sgn * blob.ux;
        const ty = sgn * blob.uy;
        const beta = Math.atan2(fwdRun[0] * ty - fwdRun[1] * tx, fwdRun[0] * tx + fwdRun[1] * ty) * DEG; // clockwise from forward
        const alphaUp = Math.atan2(tx, -ty) * DEG; // clockwise from image-up
        const offset = side === "left" ? o.angleOffsetLeftDeg : o.angleOffsetRightDeg;
        fpas.push(sideSign * beta + offset);
        cams.push(sideSign * alphaUp + offset);
        scores.push(blob.score);
        // frames near the accelerometer's mid-stance count most (a small floor keeps the others in play)
        weights.push(Number.isFinite(tMid) ? Math.exp(-0.5 * ((frames[i].t - tMid) / 0.12) ** 2) + 0.05 : 1);
      }
      const nUsed = fpas.length;
      const angle = nUsed ? (Number.isFinite(tMid) ? weightedMedian(fpas, weights) : median(fpas)) : NaN;
      const spread = nUsed ? robustSigma(fpas) : NaN;
      const countFactor = clamp(nUsed / 6, 0.25, 1);
      const spreadFactor = Number.isFinite(spread) ? 1 / (1 + (spread / 5) ** 2) : 0;
      // agreeing with the accelerometer's step timing is worth a little; a stance no step explains costs a little
      const timingFactor = stepTimes ? (Number.isFinite(tMid) ? 0.7 + 0.3 * align : 0.85) : 1;
      const confidence = nUsed ? clamp(mean(scores) * countFactor * spreadFactor * timingFactor, 0, 1) : 0;

      let reason: string | undefined;
      if (nUsed < o.minStepFrames) reason = `only ${nUsed} usable frame${nUsed === 1 ? "" : "s"}`;
      else if (spread > o.maxStepSpreadDeg) reason = `unstable (±${spread.toFixed(0)}° scatter)`;
      else if (confidence < o.minStepConfidence) reason = `low confidence (${confidence.toFixed(2)})`;

      const idx = steps.length;
      steps.push({
        foot: rep,
        startIdx: a,
        endIdx: b,
        usedStartIdx: ua,
        usedEndIdx: ub,
        tStart: frames[a].t,
        tEnd: frames[b].t,
        nFrames: nUsed,
        angleDeg: angle,
        losAngleDeg: nUsed ? median(cams) : NaN,
        headingDeg: nUsed ? sideSign * psiRun : NaN,
        spreadDeg: spread,
        confidence,
        approxDistanceM: NaN,
        used: !reason,
        discardReason: reason,
      });
      for (let i = a; i <= b; i++) debug[i][rep].step = idx;
    }
  }

  rejectOutliers(steps, o.outlierFloorDeg, o.outlierMadK);
  steps.sort((a, b) => a.startIdx - b.startIdx);
  for (const d of debug) {
    d.left.step = -1;
    d.right.step = -1;
  }
  steps.forEach((s, idx) => {
    for (let i = s.startIdx; i <= s.endIdx; i++) debug[i][s.foot].step = idx;
  });
  result.steps = steps;

  const L = aggregateFoot(steps, "left");
  const R = aggregateFoot(steps, "right");
  result.leftDeg = L.value;
  result.rightDeg = R.value;
  result.leftSteps = L.n;
  result.rightSteps = R.n;
  result.asymmetryDeg = L.value !== null && R.value !== null ? Math.abs(L.value - R.value) : null;
  result.quality = qualityOf(steps, L.n, R.n, 6);

  if (L.n === 0 && R.n === 0) return fail("no_steps");
  if (L.n === 0) return fail("no_steps_left");
  if (R.n === 0) return fail("no_steps_right");
  result.ok = true;
  return result;
}

// ---------- helpers -----------------------------------------------------------------------------------

/** Median foot length in isotropic pixels over all usable blobs. */
function footLength(frames: TopDownFrame[], pick: (f: TopDownFrame) => FootBlob[], H: number): number {
  const lens: number[] = [];
  for (const f of frames) for (const b of pick(f)) lens.push(b.length * H);
  const m = median(lens);
  return Number.isFinite(m) && m > 1 ? m : 50;
}

/**
 * The way the person walked during one stance, from how the planted foot's centroid slid through the picture (least-squares
 * slope over frames a..b, reversed). Unit vector in image coords; null when there are too few frames or the foot barely moved.
 */
function stanceForward(T: Track, a: number, b: number, dt: number, minSpeedPx: number): [number, number] | null {
  let n = 0;
  let st = 0;
  let sx = 0;
  let sy = 0;
  let stt = 0;
  let stx = 0;
  let sty = 0;
  for (let i = a; i <= b; i++) {
    if (!Number.isFinite(T.x[i]) || !Number.isFinite(T.y[i])) continue;
    const t = (i - a) * dt;
    n++;
    st += t;
    sx += T.x[i];
    sy += T.y[i];
    stt += t * t;
    stx += t * T.x[i];
    sty += t * T.y[i];
  }
  if (n < 3) return null;
  const den = n * stt - st * st;
  if (!(den > 1e-12)) return null;
  const vx = (n * stx - st * sx) / den;
  const vy = (n * sty - st * sy) / den;
  const speed = Math.hypot(vx, vy);
  if (!(speed >= minSpeedPx)) return null;
  return [-vx / speed, -vy / speed];
}

/** Assigns blobs to the person's left / right (relative to the forward axis) and builds smoothed position tracks. */
function buildTracks(
  frames: TopDownFrame[],
  pick: (f: TopDownFrame) => FootBlob[],
  W: number,
  H: number,
  mid: [number, number],
  fwd: [number, number],
  sigma: number,
): Record<Foot, Track> {
  const n = frames.length;
  const left: [number, number] = [fwd[1], -fwd[0]]; // forward rotated counter-clockwise on screen
  const mk = (): Track => ({
    present: new Uint8Array(n),
    blob: new Array(n).fill(null),
    blobIdx: new Int16Array(n).fill(-1),
    x: new Float64Array(n).fill(NaN),
    y: new Float64Array(n).fill(NaN),
  });
  const out: Record<Foot, Track> = { left: mk(), right: mk() };
  const rawX: Record<Foot, Float64Array> = { left: new Float64Array(n).fill(NaN), right: new Float64Array(n).fill(NaN) };
  const rawY: Record<Foot, Float64Array> = { left: new Float64Array(n).fill(NaN), right: new Float64Array(n).fill(NaN) };

  for (let i = 0; i < n; i++) {
    const blobs = pick(frames[i]);
    const side = (b: FootBlob): Foot => {
      const dx = b.cx * W - mid[0];
      const dy = b.cy * H - mid[1];
      return dx * left[0] + dy * left[1] > 0 ? "left" : "right";
    };
    if (blobs.length === 2) {
      // two feet: the one further to the left of the forward axis is the left foot
      const [p, q] = blobs;
      const sp = (p.cx * W - mid[0]) * left[0] + (p.cy * H - mid[1]) * left[1];
      const sq = (q.cx * W - mid[0]) * left[0] + (q.cy * H - mid[1]) * left[1];
      const [lb, rb] = sp >= sq ? [p, q] : [q, p];
      assign(out.left, rawX.left, rawY.left, i, lb, frames[i].blobs.indexOf(lb), W, H);
      assign(out.right, rawX.right, rawY.right, i, rb, frames[i].blobs.indexOf(rb), W, H);
    } else if (blobs.length === 1) {
      const b = blobs[0];
      const s = side(b);
      assign(out[s], rawX[s], rawY[s], i, b, frames[i].blobs.indexOf(b), W, H);
    }
  }
  for (const s of ["left", "right"] as Foot[]) {
    out[s].x = gaussianSmooth(rawX[s], sigma, 2);
    out[s].y = gaussianSmooth(rawY[s], sigma, 2);
  }
  return out;
}

function assign(t: Track, rx: Float64Array, ry: Float64Array, i: number, b: FootBlob, blobIndex: number, W: number, H: number) {
  t.present[i] = 1;
  t.blob[i] = b;
  t.blobIdx[i] = blobIndex;
  rx[i] = b.cx * W;
  ry[i] = b.cy * H;
}

/**
 * Densest cluster of 2D samples (a mean-shift style mode). A planted foot is on the ground for only about half
 * of the samples once the stance edges are smoothed, so the MEDIAN velocity lands in the transition region; the
 * planted samples, however, form a tight cluster while swing velocities are spread widely.
 */
export function denseMode(xs: number[], ys: number[], radius: number): [number, number] {
  const n = xs.length;
  let best = 0;
  let bestCount = -1;
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let j = 0; j < n; j++) if (Math.hypot(xs[j] - xs[i], ys[j] - ys[i]) <= radius) c++;
    if (c > bestCount) {
      bestCount = c;
      best = i;
    }
  }
  let cx = xs[best];
  let cy = ys[best];
  for (let it = 0; it < 8; it++) {
    let sx = 0;
    let sy = 0;
    let c = 0;
    for (let j = 0; j < n; j++) {
      if (Math.hypot(xs[j] - cx, ys[j] - cy) <= radius) {
        sx += xs[j];
        sy += ys[j];
        c++;
      }
    }
    if (!c) break;
    const nx = sx / c;
    const ny = sy / c;
    if (Math.hypot(nx - cx, ny - cy) < 0.05) {
      cx = nx;
      cy = ny;
      break;
    }
    cx = nx;
    cy = ny;
  }
  return [cx, cy];
}

/** Centre of the cluster of 2D samples nearest `start` (flat-kernel mean shift); null when fewer than 5 samples are near it. */
function clusterCenter(xs: number[], ys: number[], start: [number, number], radius: number): [number, number] | null {
  let cx = start[0];
  let cy = start[1];
  let count = 0;
  for (let it = 0; it < 10; it++) {
    let sx = 0;
    let sy = 0;
    count = 0;
    for (let j = 0; j < xs.length; j++) {
      if (Math.hypot(xs[j] - cx, ys[j] - cy) <= radius) {
        sx += xs[j];
        sy += ys[j];
        count++;
      }
    }
    if (count < 5) return null;
    const nx = sx / count;
    const ny = sy / count;
    const moved = Math.hypot(nx - cx, ny - cy);
    cx = nx;
    cy = ny;
    if (moved < 0.05) break;
  }
  return [cx, cy];
}

/** Ground flow = the dominant (planted) velocity of the feet. Standing / marching on the spot give ~zero. */
function estimateFlow(
  tracks: Record<Foot, Track>,
  dt: number,
  footLenPx: number,
  minWalkSpeed: number,
  balanceFeet: boolean,
): { walking: boolean; flow: [number, number]; samples: number } {
  const vxs: number[] = [];
  const vys: number[] = [];
  const own: Record<Foot, { x: number[]; y: number[] }> = { left: { x: [], y: [] }, right: { x: [], y: [] } };
  for (const s of ["left", "right"] as Foot[]) {
    const T = tracks[s];
    for (let i = 1; i < T.x.length - 1; i++) {
      if (Number.isFinite(T.x[i - 1]) && Number.isFinite(T.x[i + 1])) {
        const vx = (T.x[i + 1] - T.x[i - 1]) / (2 * dt);
        const vy = (T.y[i + 1] - T.y[i - 1]) / (2 * dt);
        vxs.push(vx);
        vys.push(vy);
        own[s].x.push(vx);
        own[s].y.push(vy);
      }
    }
  }
  if (vxs.length < 8) return { walking: false, flow: [0, 0], samples: vxs.length };
  let flow = denseMode(vxs, vys, 0.5 * footLenPx);
  if (balanceFeet) {
    // The phone sways sideways with each step, so the left foot's planted velocity leans one way and the right foot's
    // the other. The densest cluster would be just one of them; the walking direction is their average.
    const left = clusterCenter(own.left.x, own.left.y, flow, 0.8 * footLenPx);
    const right = clusterCenter(own.right.x, own.right.y, flow, 0.8 * footLenPx);
    // (if the two disagree by more than ~1.5 foot lengths per second one of them is not a real planted cluster: keep the densest)
    if (left && right && Math.hypot(left[0] - right[0], left[1] - right[1]) <= 1.5 * footLenPx) {
      flow = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
    }
  }
  const speed = Math.hypot(flow[0], flow[1]);
  const walking = speed >= minWalkSpeed * footLenPx;
  return { walking, flow: walking ? flow : [0, 0], samples: vxs.length };
}
