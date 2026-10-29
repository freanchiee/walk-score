/** MediaPipe Pose landmark indices used by the analysis. */
export const LM = {
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
  L_HEEL: 29,
  R_HEEL: 30,
  L_FOOT_INDEX: 31,
  R_FOOT_INDEX: 32,
} as const;

export const POSE_LANDMARK_COUNT = 33;

/** Pairs of landmark indices drawn as the leg skeleton in the debug overlay. */
export const LEG_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [LM.L_HIP, LM.L_KNEE],
  [LM.L_KNEE, LM.L_ANKLE],
  [LM.L_ANKLE, LM.L_HEEL],
  [LM.L_HEEL, LM.L_FOOT_INDEX],
  [LM.L_ANKLE, LM.L_FOOT_INDEX],
  [LM.R_HIP, LM.R_KNEE],
  [LM.R_KNEE, LM.R_ANKLE],
  [LM.R_ANKLE, LM.R_HEEL],
  [LM.R_HEEL, LM.R_FOOT_INDEX],
  [LM.R_ANKLE, LM.R_FOOT_INDEX],
  [LM.L_HIP, LM.R_HIP],
  [LM.L_SHOULDER, LM.R_SHOULDER],
  [LM.L_SHOULDER, LM.L_HIP],
  [LM.R_SHOULDER, LM.R_HIP],
];
