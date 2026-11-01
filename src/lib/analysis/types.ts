import type { CaptureReport } from "../sensors/capture";

/** One pose landmark. Image landmarks are normalized 0..1; world landmarks are meters (hip-centred). */
export interface Lm {
  x: number;
  y: number;
  z: number;
  /** visibility 0..1 as reported by the model */
  v: number;
}

/** Landmarks for one analysed video frame. */
export interface PoseFrame {
  /** seconds from the start of the video */
  t: number;
  /** a pose was detected in this frame */
  ok: boolean;
  /** 33 normalized image landmarks (x,y are fractions of frame width/height) */
  img: Lm[] | null;
  /** 33 world landmarks in meters, origin at the hip centre */
  world: Lm[] | null;
}

export interface VideoInfo {
  /** frame size in pixels (as displayed, i.e. after rotation metadata) */
  width: number;
  height: number;
  /** sampling rate of the PoseFrame series (frames per second) */
  fps: number;
  /** clip duration in seconds */
  duration: number;
}

export type Foot = "left" | "right";

/** How the per-frame foot direction is measured. */
export type AngleMethod = "world" | "image";
/** How the walking direction is obtained. `path` fits the pelvis trajectory; `camera` assumes the person walks straight at the phone. */
export type HeadingMode = "path" | "camera";
/** Which frame the model's world landmarks are expressed in (see analyze.ts). */
export type WorldFrame = "los" | "axis";

export interface AnalysisOptions {
  method: AngleMethod;
  heading: HeadingMode;
  worldFrame: WorldFrame;
  /** The video is mirrored (e.g. front-camera selfie file): swap the reported left/right feet. */
  swapLeftRight: boolean;
  /** Undo phone roll using the torso direction. */
  rollCompensation: boolean;
  /** Assumed field of view along the long side of the frame, degrees. */
  longSideFovDeg: number;
  /** Minimum landmark visibility for heel / foot-index / torso landmarks. */
  minVisibility: number;
  /** Landmarks closer than this fraction to the frame edge are treated as clipped. */
  frameMargin: number;
  /** Gaussian smoothing of landmark tracks, seconds. */
  smoothSigmaSec: number;
  /** Window over which a foot must be stationary, seconds. */
  stationaryWindowSec: number;
  /** Max heel/toe movement inside that window, as a fraction of torso length (pixels). */
  stationaryMaxRange: number;
  /** A foot steeper than this (heel vs toe height, world landmarks) is not "flat". */
  maxFootPitchDeg: number;
  /** Minimum rate of growth of torso size (1/s) to count as walking toward the camera. */
  minApproachRate: number;
  minStanceSec: number;
  maxStanceSec: number;
  /** Fraction of each stance dropped at both ends before measuring the angle. */
  trimFraction: number;
  minStepFrames: number;
  /** Steps whose per-frame angles scatter more than this (robust sigma, degrees) are discarded. */
  maxStepSpreadDeg: number;
  minStepConfidence: number;
  /** A step further than max(this, madK * sigma) from the foot's median is dropped as an outlier. */
  outlierFloorDeg: number;
  outlierMadK: number;
  /** Torso length as a fraction of the long frame side at which a step gets full confidence (closer = more pixels = better). */
  fullConfidenceTorsoFrac: number;
}

export type FailureCode =
  | "too_short"
  | "no_pose"
  | "no_feet"
  | "no_approach"
  | "no_steps"
  | "no_steps_left"
  | "no_steps_right"
  // capture gating from the phone's sensors (see lib/sensors/gate.ts)
  | "too_few_steps"
  | "too_tilted"
  | "yaw_drift";

export interface StepResult {
  /** reported foot (after the optional left/right swap) */
  foot: Foot;
  /** frame indices of the whole detected stance run */
  startIdx: number;
  endIdx: number;
  /** frame indices of the trimmed window the angle was measured on */
  usedStartIdx: number;
  usedEndIdx: number;
  tStart: number;
  tEnd: number;
  /** frames that produced a valid per-frame angle */
  nFrames: number;
  /** final foot progression angle: degrees, toe-out positive. NaN when the step could not be measured. */
  angleDeg: number;
  /** angle relative to the camera line of sight before the walking-direction correction (same sign convention) */
  losAngleDeg: number;
  /** walking-direction correction that was subtracted, degrees */
  headingDeg: number;
  /** robust scatter of the per-frame angles inside the step, degrees */
  spreadDeg: number;
  /** 0..1 */
  confidence: number;
  /** rough distance from the camera at this step, meters (assumes a 0.5 m torso) */
  approxDistanceM: number;
  used: boolean;
  discardReason?: string;
}

export interface FootFrameDebug {
  valid: boolean;
  stationary: boolean;
  flat: boolean;
  usable: boolean;
  /** index into AnalysisResult.steps, or -1 */
  step: number;
  /** top-down only: index of this foot's blob in the frame's blob list, or -1 */
  blobIndex?: number;
}

export interface FrameDebug {
  approach: boolean;
  /** d(ln torso)/dt, 1/s */
  rate: number;
  left: FootFrameDebug;
  right: FootFrameDebug;
}

/** top-down: what the person's tap on a toe gap taught the feet finder (see lib/topdown/seed.ts). In memory only, like the rest. */
export interface SeedSummary {
  /** where the person tapped: the live camera preview before recording, or a frame of the recorded video; null when not known */
  from: "preview" | "video" | null;
  /** the foot colour that was learned, Lab */
  colour: [number, number, number];
  /** which way the tapped toes point, degrees clockwise from the top of the picture; null when the tap was not near the toes */
  toeAngleDeg: number | null;
  /** frames where the learned colour found the feet / frames that fell back to the generic skin test */
  seededFrames: number;
  fallbackFrames: number;
  /** angle between the tapped toes and the walking direction from the ground flow (0 = straight ahead); null without walking or toes */
  vsWalkingDeg: number | null;
  /** the clip had no walking in it and its forward direction was taken from the tapped toes instead of the top edge */
  setDirection: boolean;
}

export interface AnalysisResult {
  ok: boolean;
  failure?: { code: FailureCode; message: string };
  /** reported angles, degrees, toe-out positive; null when a foot could not be measured */
  leftDeg: number | null;
  rightDeg: number | null;
  /** |left - right| */
  asymmetryDeg: number | null;
  leftSteps: number;
  rightSteps: number;
  quality: "none" | "rough" | "ok" | "good";
  steps: StepResult[];
  heading: {
    /** fitted heading of the pelvis path relative to the camera axis (positive = drifting toward image-right while approaching) */
    psiDeg: number;
    /** false when the fit was not possible and 0 was assumed */
    fitted: boolean;
    points: number;
    rollDeg: number;
  };
  calibration: {
    /** +1 when the model's "left" foot is on the image-right (person facing the camera) */
    lateralSign: 1 | -1;
    worldAxisSign: { x: 1 | -1; y: 1 | -1; z: 1 | -1 };
    torsoToFootRatio: number;
    focalPx: number;
  };
  warnings: string[];
  frames: FrameDebug[];
  stats: {
    frames: number;
    posedFrames: number;
    approachFrames: number;
    fps: number;
  };
  /** which analyzer produced this result: the pose-based front view or the top-down feet view */
  mode: "front" | "topdown";
  /** top-down only: no ground motion was seen, so this is a standing stance, not a walking angle */
  standing?: boolean;
  /** the left/right swap that was applied when labelling the feet (overlays need it) */
  swapLeftRight: boolean;
  /** top-down camera captures: what the phone's sensors say about the capture (see lib/sensors/gate.ts) */
  capture?: CaptureReport;
  /** top-down: present when the person tapped a toe gap before the scan */
  seed?: SeedSummary;
}
