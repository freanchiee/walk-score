/**
 * Product-level knobs. Algorithm thresholds live in lib/analysis/options.ts.
 */

/**
 * Target foot-progression-angle band, in degrees of TOE-OUT (negative = toe-in).
 * This is a BEST GUESS for a fun score, not a clinical norm or a medical recommendation. Change it freely.
 */
export const TARGET_BAND = { minDeg: 0, maxDeg: 10 } as const;

export const SCORE_CONFIG = {
  /** Relative weight of the two components (must sum to 1). */
  weights: { angle: 0.65, symmetry: 0.35 },
  /** Gaussian fall-off in degrees outside the target band: foot score = exp(-0.5 (distance / sigma)^2). */
  angleSigmaDeg: 10,
  /** Gaussian fall-off in degrees for the left/right difference: symmetry = exp(-0.5 (difference / sigma)^2). */
  symmetrySigmaDeg: 8,
} as const;

/** Thresholds for the fun labels (degrees unless noted). */
export const LABEL_CONFIG = {
  bigAsymmetryDeg: 12,
  /** mean toe-out beyond the band's upper edge by more than this -> "Chaplin Stroll" */
  splayDeg: 4,
  /** ...by more than this -> "Duck Walker" */
  duckDeg: 10,
  /** mean toe-in beyond the band's lower edge by more than this -> "Pigeon Strut" */
  toeInDeg: 3,
  runwayScore: 90,
  smoothScore: 75,
} as const;

export type CaptureMode = "topdown" | "front";

/**
 * How the video is captured and analysed.
 *  - "topdown": the person holds the phone in one hand, camera pointing straight down at their feet, and records
 *    ~10 s of normal walking. Feet are found with classical computer vision (MediaPipe Pose cannot see a
 *    body from this view: verified, it finds nothing) and the foot angle is read directly from the picture.
 *  - "front": phone on the floor at knee height, the person walks toward it; MediaPipe Pose Landmarker.
 */
export const CAPTURE_MODE: CaptureMode = "topdown";

/**
 * When the person is asked to tap the gap between the big toe and the next toe on a frame of their video (components/MarkFoot.tsx).
 * The tap teaches the feet finder what this person's foot looks like (colour, size) and which way the toes point, so socks, unusual
 * skin tones and odd lighting stop being failures. Top-down mode only.
 *  - "always": after every recording or upload, with a Skip button.
 *  - "onFailure": only on the error screen after a scan could not find the feet ("Tap your foot and try again").
 *  - "off": never.
 */
export type MarkStep = "always" | "onFailure" | "off";
export const MARK_STEP: MarkStep = "always";

const CAPTURE_PROFILES = {
  topdown: { countdownSec: 3, maxRecordSec: 10 },
  front: { countdownSec: 8, maxRecordSec: 10 },
} as const;

export const CAPTURE_CONFIG = {
  /** seconds between pressing Start and the recording beginning (to get into position) */
  countdownSec: CAPTURE_PROFILES[CAPTURE_MODE].countdownSec as number,
  /** recording stops automatically after this many seconds */
  maxRecordSec: CAPTURE_PROFILES[CAPTURE_MODE].maxRecordSec as number,
  /** longer uploads are truncated to this many seconds of analysis */
  maxAnalyzeSec: 30,
  idealWidth: 1920,
  idealHeight: 1080,
};

export type ModelVariant = "lite" | "full" | "heavy";

export const POSE_ASSETS = {
  wasmBase: "/mediapipe/wasm",
  defaultVariant: "full" as ModelVariant,
  modelPath: (variant: ModelVariant) => `/models/pose_landmarker_${variant}.task`,
} as const;

/** Frames per second sampled from the video for analysis (front-view pose pipeline). */
export const ANALYSIS_FPS = 30;

/** Default sampling rate for a mode: the top-down feet finder needs far fewer frames than the pose model. */
export const analysisFps = (mode: CaptureMode) => (mode === "topdown" ? 15 : ANALYSIS_FPS);

/**
 * Calibration shipped to every user. The app reads the principal axis of each foot silhouette, a hand measurement is
 * heel centre -> toe gap: the difference is a per-foot offset (degrees added to every reading, toe-out positive).
 * `method` is how the walking direction is found ("balanced" | "single" | "hybrid").
 * Measure yours on /settings/calibration, which prints the line to paste here; a calibration saved in a browser on that
 * page overrides this one for that browser only.
 */
export const DEFAULT_CALIBRATION = { leftOffsetDeg: 0, rightOffsetDeg: 0, method: "balanced" } as const;

/**
 * Phone-sensor guidance, capture gating and the experimental switches: every threshold in one place.
 * Tilt = the angle between the back camera's axis and straight down (0 = phone flat, screen up, camera at the floor).
 */
export const SENSOR_CONFIG = {
  /** tilt colours: green up to goodDeg, amber up to warnDeg, red beyond */
  tilt: { goodDeg: 5, warnDeg: 12 },
  /** the level bubble reaches the edge of its ring at this much tilt */
  bubbleFullScaleDeg: 20,
  /** "Steady": the gyroscope stays below this for holdMs */
  steady: { maxRotationDegPerSec: 25, holdMs: 1000 },
  /** "Light OK": mean luminance (0-255) of a downsampled frame, and the share of clipped pixels */
  light: { minMean: 55, maxMean: 205, maxClippedShare: 0.1 },
  /** how often the live feet / light checks run on the camera preview */
  liveCheckMs: 300,
  /** a "Start anyway" button appears after waiting this long for the chips to turn green */
  startAnywayAfterSec: 8,
  /** fewer accelerometer steps than this rejects the scan */
  minSteps: 6,
  /** frames tilted more than this are left out of the angle averaging */
  maxFrameTiltDeg: 12,
  /** fewer reliable frames than this share rejects the scan */
  minReliableFrameShare: 0.5,
  /** sensor clock minus video clock, ms (positive = the sensors run ahead of the video); measure it before trusting tilt per frame to better than ~100 ms */
  videoLatencyMs: 0,
  /** field of view along the picture's long side, degrees (a typical main phone camera); used by the tilt correction only */
  fovLongSideDeg: 67,
  /** relative yaw of the phone during the walk (experimental check) */
  yaw: { warnDeg: 15, rejectDeg: 30 },
} as const;

export interface ExperimentFlags {
  /** track the phone's yaw (alpha) during the walk and warn */
  yawCheck: boolean;
  /** ...and reject the scan when it turns beyond SENSOR_CONFIG.yaw.rejectDeg (needs yawCheck) */
  yawReject: boolean;
  /** estimate the walking direction from the floor texture's optical flow (debug comparison only) */
  floorFlow: boolean;
  /** re-project the feet to a virtual straight-down view with the phone's pitch and roll (rotation-only homography) */
  tiltCorrection: boolean;
}

/** Everything experimental is off by default. Try one on a phone with ?exp=yaw,yawreject,flow,tilt (see src/lib/flags.ts). */
export const DEFAULT_EXPERIMENTS: ExperimentFlags = { yawCheck: false, yawReject: false, floorFlow: false, tiltCorrection: false };

/** /validate says "above target" when the mean absolute error exceeds this many degrees. */
export const VALIDATION_TARGET_MAE_DEG = 5;
