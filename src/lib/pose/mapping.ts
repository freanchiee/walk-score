import { POSE_LANDMARK_COUNT } from "../analysis/landmarks";
import type { Lm, PoseFrame } from "../analysis/types";

/** The subset of MediaPipe's landmark / result shapes we read (keeps this file free of browser imports). */
interface RawLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}
interface RawResult {
  landmarks?: RawLandmark[][];
  worldLandmarks?: RawLandmark[][];
}

const copy = (p: RawLandmark): Lm => ({ x: p.x, y: p.y, z: p.z, v: p.visibility ?? 1 });

/** Copies the first detected pose out of a MediaPipe result (results are reused by the runtime). */
export function resultToFrame(t: number, res: RawResult | undefined | null): PoseFrame {
  const img = res?.landmarks?.[0];
  const world = res?.worldLandmarks?.[0];
  if (!img || !world || img.length < POSE_LANDMARK_COUNT || world.length < POSE_LANDMARK_COUNT) {
    return { t, ok: false, img: null, world: null };
  }
  return {
    t,
    ok: true,
    img: img.slice(0, POSE_LANDMARK_COUNT).map(copy),
    world: world.slice(0, POSE_LANDMARK_COUNT).map(copy),
  };
}
