import { SENSOR_CONFIG } from "../config";

const RAD = Math.PI / 180;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Tilt in degrees: the angle between the back camera's axis and straight down, from the W3C beta / gamma.
 * Device axes: x to the right of the screen, y toward the top of the screen, z out of the screen. Phone flat with the
 * screen up puts z straight up, so the camera (looking along -z) looks straight down: beta = gamma = 0, tilt = 0.
 * z's vertical component is cos(beta) cos(gamma), so tilt = acos(cos(beta) cos(gamma)), the same in portrait or landscape.
 */
export function tiltDeg(betaDeg: number, gammaDeg: number): number {
  const c = Math.cos(betaDeg * RAD) * Math.cos(gammaDeg * RAD);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
}

export type TiltClass = "good" | "warn" | "bad";

export function tiltClass(tilt: number, limits: { goodDeg: number; warnDeg: number } = SENSOR_CONFIG.tilt): TiltClass {
  return tilt <= limits.goodDeg ? "good" : tilt <= limits.warnDeg ? "warn" : "bad";
}

/**
 * Where a spirit-level bubble sits in its ring: it drifts to the HIGH side of the phone. x right, y down (screen),
 * its distance from the centre is tilt / fullScale (at most 1). Gravity projected on the screen plane is
 * (sin g cos b, -sin b) in (x right, y up); the bubble goes the opposite way.
 */
export function bubbleOffset(betaDeg: number, gammaDeg: number, fullScaleDeg: number = SENSOR_CONFIG.bubbleFullScaleDeg): { x: number; y: number } {
  const b = betaDeg * RAD;
  const g = gammaDeg * RAD;
  const x = -Math.sin(g) * Math.cos(b);
  const y = -Math.sin(b);
  const m = Math.hypot(x, y);
  if (m < 1e-9) return { x: 0, y: 0 };
  const r = Math.min(1, tiltDeg(betaDeg, gammaDeg) / fullScaleDeg);
  return { x: (x / m) * r, y: (y / m) * r };
}

/**
 * "Down" as the back camera sees it, unit vector in the image frame (x right, y down in the picture, z into the scene).
 * In a portrait photo the image x axis is the device x axis, the image y axis is the device -y axis and the optical axis
 * is the device -z axis. Level: (0, 0, 1), the nadir is the picture centre. Top of the phone raised (beta > 0): the nadir
 * moves toward the bottom of the picture (y > 0).
 */
export function downInCamera(betaDeg: number, gammaDeg: number): Vec3 {
  const b = betaDeg * RAD;
  const g = gammaDeg * RAD;
  return { x: Math.sin(g) * Math.cos(b), y: Math.sin(b), z: Math.cos(b) * Math.cos(g) };
}
