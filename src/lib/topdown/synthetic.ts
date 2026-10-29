/**
 * Synthetic top-down walking clips with KNOWN foot angles (blob level, and rasterised pixels), used to test the
 * top-down geometry and to demo the debug page without a real video. This proves self-consistency only: it says
 * nothing about how well real footage segments.
 *
 * Model: a camera looks straight down and moves forward with the walker. Planted feet are fixed on the ground
 * (so they slide backward through the image), swinging feet move one stride ahead. The phone may be yawed
 * relative to the walking direction ("yawDeg") and sway with each step ("swayDeg").
 */
import type { VideoInfo } from "../analysis/types";
import type { TopDownFrame } from "./analyze";
import type { FootBlob } from "./segment";

export interface TopDownWalkConfig {
  /** true foot progression angles, degrees, toe-out positive */
  leftDeg: number;
  rightDeg: number;
  fps?: number;
  durationSec?: number;
  /** image size in pixels (also the VideoInfo size) */
  width?: number;
  height?: number;
  /** walking speed in m/s; 0 = standing still */
  speed?: number;
  /** phone rotated clockwise relative to the walking direction */
  yawDeg?: number;
  /** yaw sway amplitude (degrees) at the step frequency */
  swayDeg?: number;
  /** sway at the stride frequency (one cycle per two steps, like trunk rotation in real gait) instead of the step frequency */
  swayPerStride?: boolean;
  /** phase of the sway in degrees; its effect depends on when in the stance it peaks */
  swayPhaseDeg?: number;
  /** the camera also sways sideways by this amplitude (metres), one cycle per stride */
  lateralM?: number;
  /** phase of the sideways sway in degrees (default: the yaw sway's phase). About 162° puts the camera over the stance foot at mid-stance, as in real gait. */
  lateralPhaseDeg?: number;
  footLength?: number;
  footWidth?: number;
  /** centre-to-centre distance between the feet, metres */
  stepWidth?: number;
  /** metres of ground covered by the frame height */
  coverage?: number;
  /** per-frame noise on the blob axis angle (blob-level only), degrees */
  angleNoiseDeg?: number;
  /** per-frame noise on blob centroids (blob-level only), pixels */
  posNoisePx?: number;
  seed?: number;
}

export interface FootState {
  isLeft: boolean;
  /** centre in pixels */
  x: number;
  y: number;
  /** toe direction, degrees clockwise from image-up */
  alphaUp: number;
  lengthPx: number;
  widthPx: number;
  /** pixel renderer only: the shin leaves the ankle at this angle relative to the foot axis (degrees) */
  legDeg?: number;
  /** pixel renderer only: visible ankle / shin length as a fraction of the foot length (from straight above the shin is foreshortened, so short) */
  legLenFrac?: number;
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
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(uniform(), 1e-12))) * Math.cos(2 * Math.PI * uniform());
  return { uniform, gauss };
}

/** Kinematics of both feet at every frame. */
export function simulateFeet(cfg: TopDownWalkConfig): { times: number[]; states: FootState[][]; truthYawDeg: number[] } {
  const fps = cfg.fps ?? 15;
  const dur = cfg.durationSec ?? 5;
  const W = cfg.width ?? 200;
  const H = cfg.height ?? 356;
  const v = cfg.speed ?? 1.1;
  const ppm = H / (cfg.coverage ?? 1.55);
  const footL = cfg.footLength ?? 0.26;
  const footW = cfg.footWidth ?? 0.1;
  const sw = cfg.stepWidth ?? 0.18;
  const yawDeg = cfg.yawDeg ?? 0;
  const sway = cfg.swayDeg ?? 0;
  const stride = 1.3;
  const period = v > 0 ? stride / v : 1;
  const stanceFrac = 0.6;
  const swayPeriod = cfg.swayPerStride ? period : period / 2;
  const swayPhase = ((cfg.swayPhaseDeg ?? 0) * Math.PI) / 180;
  const latPhase = ((cfg.lateralPhaseDeg ?? cfg.swayPhaseDeg ?? 0) * Math.PI) / 180;
  const y0 = (v > 0 ? 0.55 : 0.62) * H;

  const n = Math.floor(dur * fps) + 1;
  const times: number[] = [];
  const states: FootState[][] = [];
  const truthYaw: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const psi = yawDeg + (sway && v > 0 ? sway * Math.sin((2 * Math.PI * t) / swayPeriod + swayPhase) : 0);
    const lat = cfg.lateralM && v > 0 ? cfg.lateralM * Math.sin((2 * Math.PI * t) / period + latPhase) : 0;
    const cr = Math.cos((psi * Math.PI) / 180);
    const sr = Math.sin((psi * Math.PI) / 180);
    const frame: FootState[] = [];
    for (const isLeft of [true, false]) {
      let delta = 0;
      if (v > 0) {
        const phase = isLeft ? 0 : period / 2;
        const tt = t - phase;
        const c = Math.floor(tt / period);
        const p = tt / period - c;
        const sMid = (k: number) => v * (phase + k * period + 0.3 * period);
        let g = sMid(c);
        if (p >= stanceFrac) {
          const q = (p - stanceFrac) / (1 - stanceFrac);
          g = sMid(c) + (sMid(c + 1) - sMid(c)) * (q * q * (3 - 2 * q));
        }
        delta = g - v * t;
      }
      const xf = W / 2 + (isLeft ? -1 : 1) * (sw / 2) * ppm - lat * ppm; // person's left foot is on the left of the walking direction
      const yf = y0 - delta * ppm;
      const dx = xf - W / 2;
      const dy = yf - H / 2;
      const x = W / 2 + dx * cr - dy * sr; // clockwise rotation by psi
      const y = H / 2 + dx * sr + dy * cr;
      const beta = isLeft ? -cfg.leftDeg : cfg.rightDeg; // clockwise from the forward direction
      frame.push({ isLeft, x, y, alphaUp: beta + psi, lengthPx: footL * ppm, widthPx: footW * ppm });
    }
    times.push(t);
    states.push(frame);
    truthYaw.push(psi);
  }
  return { times, states, truthYawDeg: truthYaw };
}

/** Footprint extents and whether the foot is cut by the frame edge. */
function extents(s: FootState, W: number, H: number) {
  const a = (s.alphaUp * Math.PI) / 180;
  const tx = Math.sin(a);
  const ty = -Math.cos(a);
  const px = Math.cos(a);
  const py = Math.sin(a);
  const hx = Math.abs(tx) * (s.lengthPx / 2) + Math.abs(px) * (s.widthPx / 2);
  const hy = Math.abs(ty) * (s.lengthPx / 2) + Math.abs(py) * (s.widthPx / 2);
  const visible = s.x + hx > 0 && s.x - hx < W && s.y + hy > 0 && s.y - hy < H;
  const clipped = s.x - hx < 0 || s.x + hx > W || s.y - hy < 0 || s.y + hy > H;
  return { tx, ty, visible, clipped };
}

/** Blob-level clip: exactly what the segmentation would report for a perfect, unbiased foot finder. */
export function generateBlobWalk(cfg: TopDownWalkConfig): {
  frames: TopDownFrame[];
  video: VideoInfo;
  truth: { leftDeg: number; rightDeg: number; yawDeg: number[] };
} {
  const W = cfg.width ?? 200;
  const H = cfg.height ?? 356;
  const fps = cfg.fps ?? 15;
  const rand = rng(cfg.seed ?? 1);
  const { times, states, truthYawDeg } = simulateFeet(cfg);
  const frames: TopDownFrame[] = times.map((t, i) => {
    const blobs: FootBlob[] = [];
    for (const s of states[i]) {
      const e = extents(s, W, H);
      if (!e.visible) continue;
      const noisyAlpha = s.alphaUp + (cfg.angleNoiseDeg ? rand.gauss() * cfg.angleNoiseDeg : 0);
      const a = (noisyAlpha * Math.PI) / 180;
      let ux = Math.sin(a);
      let uy = -Math.cos(a);
      if (uy > 0 || (uy === 0 && ux < 0)) {
        ux = -ux;
        uy = -uy;
      }
      const cx = s.x + (cfg.posNoisePx ? rand.gauss() * cfg.posNoisePx : 0);
      const cy = s.y + (cfg.posNoisePx ? rand.gauss() * cfg.posNoisePx : 0);
      const half = s.lengthPx / 2;
      blobs.push({
        cx: cx / W,
        cy: cy / H,
        area: ((Math.PI / 4) * s.lengthPx * s.widthPx) / (W * H),
        length: s.lengthPx / H,
        width: s.widthPx / H,
        ux,
        uy,
        elongation: s.lengthPx / s.widthPx,
        toeX: (cx + ux * half) / W,
        toeY: (cy + uy * half) / H,
        heelX: (cx - ux * half) / W,
        heelY: (cy - uy * half) / H,
        clipped: e.clipped,
        score: e.clipped ? 0.6 : 1,
        L: 33,
        a: 10,
        b: 11,
      });
    }
    blobs.sort((p, q) => p.cx - q.cx);
    return { t, blobs };
  });
  return {
    frames,
    video: { width: W, height: H, fps, duration: (frames.length - 1) / fps },
    truth: { leftDeg: cfg.leftDeg, rightDeg: cfg.rightDeg, yawDeg: truthYawDeg },
  };
}

// ---------- pixel level ------------------------------------------------------------------------------

export interface SceneOptions {
  floor?: [number, number, number];
  skin?: [number, number, number];
  /** striped rug behind the feet (like a doormat) */
  rug?: boolean;
  /** light shorts at the bottom edge */
  shorts?: boolean;
  /** sensor noise (RGB units) */
  noise?: number;
  seed?: number;
}

/** Rasterises one frame of feet on a wood-like floor. Returns RGBA at W x H. */
export function renderFeetFrame(states: FootState[], W: number, H: number, scene: SceneOptions = {}): Uint8ClampedArray<ArrayBuffer> {
  const floor = scene.floor ?? [152, 128, 100];
  const skin = scene.skin ?? [98, 70, 58];
  const noise = scene.noise ?? 2;
  const rand = rng(scene.seed ?? 7);
  const out = new Uint8ClampedArray(W * H * 4);

  // plank bands: horizontal strips of slightly different tone, plus fine grain streaks
  const plankH = Math.max(10, Math.round(H / 18));
  const plankTone = Array.from({ length: Math.ceil(H / plankH) + 2 }, () => (rand.uniform() - 0.5) * 14);
  const grain = new Float32Array(H);
  for (let y = 0; y < H; y++) grain[y] = (rand.uniform() - 0.5) * 7;

  const feet = states.map((s) => {
    const a = (s.alphaUp * Math.PI) / 180;
    const la = ((s.alphaUp + (s.legDeg ?? 0)) * Math.PI) / 180;
    const tx = Math.sin(a);
    const ty = -Math.cos(a);
    return {
      s,
      tx,
      ty,
      px: Math.cos(a),
      py: Math.sin(a),
      // ankle point and the (possibly tilted) leg axis
      ax: s.x + tx * -0.4 * s.lengthPx,
      ay: s.y + ty * -0.4 * s.lengthPx,
      ltx: Math.sin(la),
      lty: -Math.cos(la),
      lpx: Math.cos(la),
      lpy: Math.sin(la),
    };
  });

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let r = floor[0] + plankTone[Math.floor(y / plankH)] + grain[y];
      let g = floor[1] + plankTone[Math.floor(y / plankH)] * 0.85 + grain[y] * 0.9;
      let b = floor[2] + plankTone[Math.floor(y / plankH)] * 0.7 + grain[y] * 0.8;

      if (scene.rug) {
        const rx0 = W * 0.2;
        const rx1 = W * 0.78;
        const ry0 = H * 0.42;
        const ry1 = H * 0.96;
        if (x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1) {
          const k = Math.floor((y - ry0) / 4) % 4;
          const col = k === 0 ? [165, 35, 45] : k === 1 ? [225, 220, 214] : k === 2 ? [95, 22, 30] : [200, 190, 185];
          r = col[0];
          g = col[1];
          b = col[2];
        }
      }

      for (const f of feet) {
        const dx = x - f.s.x;
        const dy = y - f.s.y;
        const s = dx * f.tx + dy * f.ty; // along the toe direction
        const q = dx * f.px + dy * f.py; // across the foot
        const L = f.s.lengthPx;
        const Wd = f.s.widthPx;
        const fore = ((s - 0.06 * L) / (0.46 * L)) ** 2 + (q / (0.5 * Wd)) ** 2 <= 1;
        const heel = ((s + 0.34 * L) / (0.16 * L)) ** 2 + (q / (0.4 * Wd)) ** 2 <= 1;
        const lsx = x - f.ax;
        const lsy = y - f.ay;
        const sLeg = lsx * f.ltx + lsy * f.lty;
        const qLeg = lsx * f.lpx + lsy * f.lpy;
        const leg = sLeg <= 0 && sLeg >= -(f.s.legLenFrac ?? 0.5) * L && Math.abs(qLeg) <= 0.27 * Wd;
        if (fore || heel || leg) {
          const shade = 1 + 0.12 * (q / (0.5 * Wd));
          r = skin[0] * shade;
          g = skin[1] * shade;
          b = skin[2] * shade;
        }
      }

      if (scene.shorts && y > H * 0.9 - 0.25 * H * Math.pow((x - W / 2) / (W / 2), 2)) {
        r = 226 + (rand.uniform() - 0.5) * 20;
        g = 223 + (rand.uniform() - 0.5) * 20;
        b = 216 + (rand.uniform() - 0.5) * 20;
      }

      out[i] = r + rand.gauss() * noise;
      out[i + 1] = g + rand.gauss() * noise;
      out[i + 2] = b + rand.gauss() * noise;
      out[i + 3] = 255;
    }
  }
  return out;
}
