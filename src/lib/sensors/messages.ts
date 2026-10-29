/** Why a scan is turned down before or after the feet are measured, in words for the person holding the phone. */
export const GATE_FAILURE_MESSAGES = {
  too_few_steps: "Walk a bit longer and try again.",
  too_tilted: "The phone was tilted too much. Hold it flat and level (keep the bubble in the green ring) and try again.",
  yaw_drift: "The phone turned away from your walking direction. Keep it pointing the way you walk and try again.",
} as const;
