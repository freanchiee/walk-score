/**
 * Tilt correction (experimental, off by default): re-project the feet to the picture a camera at the SAME position, but
 * looking straight down, would have taken. A pure rotation of the camera about its centre maps picture to picture with
 * the homography H = K R K^-1 whatever the depth of the scene, so no knowledge of the floor distance is needed; for the
 * floor, which is perpendicular to the virtual optical axis, angles are then preserved (the foot angle against the
 * walking direction is read from the corrected centroid tracks and axes).
 *
 * Needs the phone's pitch and roll per frame and an assumed field of view (SENSOR_CONFIG.fovLongSideDeg). Assumes a
 * portrait picture from the back camera: image x = device x, image y = -device y, optical axis = -device z.
 */
import type { VideoInfo } from "../analysis/types";
import type { TopDownFrame } from "../topdown/analyze";
import type { FootBlob } from "../topdown/segment";
import { downInCamera, type Vec3 } from "./tilt";

/** row-major 3x3 */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface Intrinsics {
  /** focal length in pixels */
  f: number;
  cx: number;
  cy: number;
}

export function intrinsicsFor(width: number, height: number, fovLongSideDeg: number): Intrinsics {
  return { f: Math.max(width, height) / 2 / Math.tan((fovLongSideDeg * Math.PI) / 360), cx: width / 2, cy: height / 2 };
}

const mul = (a: Mat3, b: Mat3): Mat3 => {
  const o = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o as Mat3;
};

/** The shortest rotation taking the unit vector `d` ("down" as the camera sees it) onto the optical axis (0, 0, 1). */
export function nadirRotation(d: Vec3): Mat3 {
  // Rodrigues with k = d x z = (dy, -dx, 0), |k|^2 = 1 - dz^2: R = I + [k]x + [k]x^2 / (1 + dz)
  const kx = d.y;
  const ky = -d.x;
  const K: Mat3 = [0, 0, ky, 0, 0, -kx, -ky, kx, 0];
  const K2 = mul(K, K);
  const w = 1 / (1 + d.z);
  return [1 + K[0] + K2[0] * w, K[1] + K2[1] * w, K[2] + K2[2] * w, K[3] + K2[3] * w, 1 + K[4] + K2[4] * w, K[5] + K2[5] * w, K[6] + K2[6] * w, K[7] + K2[7] * w, 1 + K[8] + K2[8] * w];
}

/** Where picture point (u, v) lands in the virtual picture. */
export function reproject(u: number, v: number, R: Mat3, K: Intrinsics): { u: number; v: number } {
  const x = (u - K.cx) / K.f;
  const y = (v - K.cy) / K.f;
  const rx = R[0] * x + R[1] * y + R[2];
  const ry = R[3] * x + R[4] * y + R[5];
  const rz = R[6] * x + R[7] * y + R[8];
  return { u: (K.f * rx) / rz + K.cx, v: (K.f * ry) / rz + K.cy };
}

/** One foot blob as the virtual straight-down camera would see it (position, axis and its ends; the shape numbers are kept). */
export function correctBlob(b: FootBlob, W: number, H: number, R: Mat3, K: Intrinsics): FootBlob {
  const half = (b.length * H) / 2;
  const c = reproject(b.cx * W, b.cy * H, R, K);
  const front = reproject(b.cx * W + b.ux * half, b.cy * H + b.uy * half, R, K);
  const back = reproject(b.cx * W - b.ux * half, b.cy * H - b.uy * half, R, K);
  let ux = front.u - back.u;
  let uy = front.v - back.v;
  const len = Math.hypot(ux, uy) || 1;
  ux /= len;
  uy /= len;
  if (ux * b.ux + uy * b.uy < 0) {
    ux = -ux;
    uy = -uy;
  }
  const toe = reproject(b.toeX * W, b.toeY * H, R, K);
  const heel = reproject(b.heelX * W, b.heelY * H, R, K);
  return { ...b, cx: c.u / W, cy: c.v / H, ux, uy, toeX: toe.u / W, toeY: toe.v / H, heelX: heel.u / W, heelY: heel.v / H };
}

/**
 * Corrects every frame whose pitch / roll is known (`betaGammaAtSec` returns null where it is not: those frames are
 * left as they are). The result feeds analyzeTopDown unchanged.
 */
export function correctFramesForTilt(
  frames: TopDownFrame[],
  video: Pick<VideoInfo, "width" | "height">,
  betaGammaAtSec: (tSec: number) => { beta: number; gamma: number } | null,
  fovLongSideDeg: number,
): TopDownFrame[] {
  const K = intrinsicsFor(video.width, video.height, fovLongSideDeg);
  return frames.map((f) => {
    const bg = betaGammaAtSec(f.t);
    if (!bg || !f.blobs.length) return f;
    const R = nadirRotation(downInCamera(bg.beta, bg.gamma));
    return { ...f, blobs: f.blobs.map((b) => correctBlob(b, video.width, video.height, R, K)) };
  });
}
