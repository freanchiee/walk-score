import type { AnalysisOptions } from "./types";

/**
 * Algorithm defaults. These are starting guesses, NOT tuned values: the /debug page lets you
 * change them live on a recorded clip and /validate compares presets against hand measurements.
 */
export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  method: "world",
  heading: "path",
  worldFrame: "los",
  swapLeftRight: false,
  rollCompensation: true,
  longSideFovDeg: 65,
  minVisibility: 0.4,
  frameMargin: 0.015,
  smoothSigmaSec: 0.05,
  stationaryWindowSec: 0.13,
  stationaryMaxRange: 0.08,
  maxFootPitchDeg: 35,
  minApproachRate: 0.1,
  minStanceSec: 0.2,
  maxStanceSec: 1.5,
  trimFraction: 0.2,
  minStepFrames: 3,
  maxStepSpreadDeg: 25,
  minStepConfidence: 0.15,
  outlierFloorDeg: 15,
  outlierMadK: 3,
  fullConfidenceTorsoFrac: 0.14,
};

/**
 * Estimator presets compared side by side on /validate.
 * The first entry is what the app uses by default.
 */
export const ANALYSIS_PRESETS: ReadonlyArray<{ id: string; label: string; options: Partial<AnalysisOptions> }> = [
  { id: "world-path", label: "world landmarks + fitted path (default)", options: { method: "world", heading: "path" } },
  { id: "world-camera", label: "world landmarks, walking straight at camera", options: { method: "world", heading: "camera" } },
  { id: "image-path", label: "image plane + fitted path", options: { method: "image", heading: "path" } },
  { id: "image-camera", label: "image plane, walking straight at camera", options: { method: "image", heading: "camera" } },
  {
    id: "world-axis-path",
    label: "world landmarks (camera-axis frame) + fitted path",
    options: { method: "world", worldFrame: "axis", heading: "path" },
  },
];
