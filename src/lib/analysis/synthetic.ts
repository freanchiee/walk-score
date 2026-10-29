/**
 * Synthetic walking clips with KNOWN foot angles, used to test the analysis geometry and to demo the
 * debug page without a real video.
 *
 * A pinhole camera sits 0.5 m above the floor looking along +Z (x right, y down). A person walks on
 * the ground plane with planted feet at fixed positions, alternating stance/swing, and each foot
 * rotated by a chosen foot progression angle. Landmarks are projected to normalized image coordinates
 * and to hip-centred "world" coordinates (optionally rotated so the frame looks along the line of
 * sight, which is what we assume the real model does).
 *
 * This validates self-consistency of the maths (signs, heading correction, stance detection). It says
 * NOTHING about how well MediaPipe localises real feet.
 */
import { DEG, RAD } from "./math";
import { LM, POSE_LANDMARK_COUNT } from "./landmarks";
import type { Lm, PoseFrame, VideoInfo } from "./types";

export interface SyntheticWalkConfig {
  /** true foot progression angles, degrees, toe-out positive */
  leftDeg: number;
  rightDeg: number;
  fps?: number;
  width?: number;
  height?: number;
  /** lateral start offset in meters (positive = image-right) */
  startX?: number;
  startZ?: number;
  /** the clip ends when the pelvis reaches this distance */
  endZ?: number;
  /** walking speed m/s */
  speed?: number;
  /** "camera": walk straight at the phone; "parallel": walk parallel to the optical axis */
  aim?: "camera" | "parallel";
  /** frame the world landmarks are expressed in (see analyze.ts) */
  worldFrame?: "los" | "axis";
  cameraHeight?: number;
  fovLongSideDeg?: number;
  footLength?: number;
  stepWidth?: number;
  /** Gaussian noise on image landmarks, pixels */
  noisePx?: number;
  /** Gaussian noise on world landmarks, meters */
  noiseWorldM?: number;
  visibility?: number;
  seed?: number;
  /** phone roll, degrees clockwise on screen */
  rollDeg?: number;
  /** stand still instead of walking (for negative tests) */
  standStill?: boolean;
  /** probability that a frame is dropped (pose not found) */
  dropoutRate?: number;
}

export interface SyntheticWalk {
  frames: PoseFrame[];
  video: VideoInfo;
  truth: { leftDeg: number; rightDeg: number; headingDeg: number };
}

function rng(seed: number) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(uniform(), 1e-12);
    const v = uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { uniform, gauss };
}

export function generateSyntheticWalk(cfg: SyntheticWalkConfig): SyntheticWalk {
  const fps = cfg.fps ?? 30;
  const W = cfg.width ?? 1080;
  const H = cfg.height ?? 1920;
  const startX = cfg.startX ?? 0;
  const startZ = cfg.startZ ?? 7;
  const endZ = cfg.endZ ?? 1.8;
  const speed = cfg.speed ?? 1.2;
  const aim = cfg.aim ?? "camera";
  const worldFrame = cfg.worldFrame ?? "los";
  const camH = cfg.cameraHeight ?? 0.5;
  const f = Math.max(W, H) / (2 * Math.tan(((cfg.fovLongSideDeg ?? 65) * RAD) / 2));
  const footLen = cfg.footLength ?? 0.25;
  const stepWidth = cfg.stepWidth ?? 0.1;
  const noisePx = cfg.noisePx ?? 0;
  const noiseW = cfg.noiseWorldM ?? 0;
  const vis = cfg.visibility ?? 0.9;
  const roll = (cfg.rollDeg ?? 0) * RAD;
  const rand = rng(cfg.seed ?? 1);

  // walking direction on the ground plane (x, z)
  let dx = 0;
  let dz = -1;
  if (aim === "camera") {
    const len = Math.hypot(startX, startZ);
    dx = -startX / len;
    dz = -startZ / len;
  }
  const psi = Math.atan2(dx, -dz);
  const perp: [number, number] = [Math.cos(psi), Math.sin(psi)]; // toward image-right

  const sEnd = (startZ - endZ) / -dz;
  const duration = cfg.standStill ? 4 : sEnd / speed;
  const nFrames = Math.floor(duration * fps) + 1;

  const stride = 1.3;
  const period = stride / speed;
  const stanceFrac = 0.6;
  const liftMax = 0.08;

  const footAt = (isLeft: boolean, t: number) => {
    if (cfg.standStill) {
      const lat = (isLeft ? 1 : -1) * stepWidth * 0.5;
      return { X: startX + perp[0] * lat, Z: startZ + perp[1] * lat, lift: 0 };
    }
    const phase = isLeft ? 0 : period / 2;
    const tt = t - phase;
    const c = Math.floor(tt / period);
    const p = tt / period - c;
    const sMid = (k: number) => speed * (phase + k * period + 0.3 * period);
    let s = sMid(c);
    let lift = 0;
    if (p >= stanceFrac) {
      const q = (p - stanceFrac) / (1 - stanceFrac);
      const e = q * q * (3 - 2 * q);
      s = sMid(c) + (sMid(c + 1) - sMid(c)) * e;
      lift = liftMax * Math.sin(Math.PI * q);
    }
    const lat = (isLeft ? 1 : -1) * stepWidth * 0.5;
    return { X: startX + dx * s + perp[0] * lat, Z: startZ + dz * s + perp[1] * lat, lift };
  };

  const footDir = (isLeft: boolean, deg: number): [number, number] => {
    const th = deg * RAD;
    const sgn = isLeft ? 1 : -1;
    return [Math.cos(th) * dx + sgn * Math.sin(th) * perp[0], Math.cos(th) * dz + sgn * Math.sin(th) * perp[1]];
  };
  const dirL = footDir(true, cfg.leftDeg);
  const dirR = footDir(false, cfg.rightDeg);

  const frames: PoseFrame[] = [];
  for (let i = 0; i < nFrames; i++) {
    const t = i / fps;
    if (cfg.dropoutRate && rand.uniform() < cfg.dropoutRate) {
      frames.push({ t, ok: false, img: null, world: null });
      continue;
    }
    const s = cfg.standStill ? 0 : speed * t;
    const C = { X: startX + dx * s, Z: startZ + dz * s };
    const hipY = camH - 0.95;
    const shoY = camH - 1.45;

    const pts: Array<{ idx: number; X: number; Y: number; Z: number }> = [];
    const add = (idx: number, X: number, Y: number, Z: number) => pts.push({ idx, X, Y, Z });
    add(LM.L_HIP, C.X + perp[0] * 0.09, hipY, C.Z + perp[1] * 0.09);
    add(LM.R_HIP, C.X - perp[0] * 0.09, hipY, C.Z - perp[1] * 0.09);
    add(LM.L_SHOULDER, C.X + perp[0] * 0.19, shoY, C.Z + perp[1] * 0.19);
    add(LM.R_SHOULDER, C.X - perp[0] * 0.19, shoY, C.Z - perp[1] * 0.19);
    for (const isLeft of [true, false]) {
      const st = footAt(isLeft, t);
      const dir = isLeft ? dirL : dirR;
      const y = camH - st.lift;
      const h = isLeft ? LM.L_HEEL : LM.R_HEEL;
      const to = isLeft ? LM.L_FOOT_INDEX : LM.R_FOOT_INDEX;
      const an = isLeft ? LM.L_ANKLE : LM.R_ANKLE;
      add(h, st.X - dir[0] * footLen * 0.5, y, st.Z - dir[1] * footLen * 0.5);
      add(to, st.X + dir[0] * footLen * 0.5, y, st.Z + dir[1] * footLen * 0.5);
      add(an, st.X - dir[0] * footLen * 0.3, y - 0.08, st.Z - dir[1] * footLen * 0.3);
    }

    const hipC = { X: C.X, Y: hipY, Z: C.Z };
    const beta = Math.atan2(hipC.X, hipC.Z);
    const img: Lm[] = Array.from({ length: POSE_LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0, v: 0 }));
    const world: Lm[] = Array.from({ length: POSE_LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0, v: 0 }));
    for (const p of pts) {
      let u = W / 2 + (f * p.X) / p.Z;
      let v = H / 2 + (f * p.Y) / p.Z;
      if (roll) {
        const ux = u - W / 2;
        const vy = v - H / 2;
        u = W / 2 + ux * Math.cos(roll) - vy * Math.sin(roll);
        v = H / 2 + ux * Math.sin(roll) + vy * Math.cos(roll);
      }
      u += rand.gauss() * noisePx;
      v += rand.gauss() * noisePx;
      img[p.idx] = { x: u / W, y: v / H, z: 0, v: vis };

      let wx = p.X - hipC.X;
      let wy = p.Y - hipC.Y;
      let wz = p.Z - hipC.Z;
      if (worldFrame === "los") {
        const rx = wx * Math.cos(beta) - wz * Math.sin(beta);
        const rz = wx * Math.sin(beta) + wz * Math.cos(beta);
        wx = rx;
        wz = rz;
      }
      if (roll) {
        const rx = wx * Math.cos(roll) - wy * Math.sin(roll);
        const ry = wx * Math.sin(roll) + wy * Math.cos(roll);
        wx = rx;
        wy = ry;
      }
      world[p.idx] = {
        x: wx + rand.gauss() * noiseW,
        y: wy + rand.gauss() * noiseW,
        z: wz + rand.gauss() * noiseW,
        v: vis,
      };
    }
    frames.push({ t, ok: true, img, world });
  }

  return {
    frames,
    video: { width: W, height: H, fps, duration: nFrames / fps },
    truth: { leftDeg: cfg.leftDeg, rightDeg: cfg.rightDeg, headingDeg: psi * DEG },
  };
}
