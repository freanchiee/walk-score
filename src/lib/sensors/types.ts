/** Phone-sensor samples. Every sample carries performance.now() (ms) so it can be lined up with video frames. */

export type SensorStatus = "idle" | "needs-permission" | "requesting" | "active" | "denied" | "unavailable";

/** DeviceOrientationEvent: degrees (W3C Z-X'-Y'' angles). Phone flat, screen up: beta = gamma = 0. */
export interface OrientSample {
  t: number;
  alpha: number | null;
  beta: number;
  gamma: number;
}

/** DeviceMotionEvent: acceleration incl. gravity (m/s², linear acceleration when gravity is not reported) and rotation rate (deg/s). */
export interface MotionSample {
  t: number;
  ax: number;
  ay: number;
  az: number;
  rx: number;
  ry: number;
  rz: number;
}
