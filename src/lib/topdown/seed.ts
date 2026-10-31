/**
 * What one tap on one frame tells the feet finder. The person taps the point between the big toe and the next toe of a
 * foot; from the pixels around it we learn what THIS person's foot looks like in THIS video (colour, size) and which way
 * its toes point. The colour then replaces the generic skin test for every frame, which is what makes socks, unusual
 * skin tones and odd lighting work and keeps rugs and shorts of another colour out; the size rejects patches that are
 * too small to be this foot; the toe direction fixes the walking direction of a clip with no walking in it.
 *
 * Steps: colour of the non-floor pixels around the tap (the floor shows through the gap between the toes, so it is left
 * out) -> grow the foot: everything connected to the tap that is not floor and close in colour -> refit the colour on the
 * grown foot (now with its shading) -> shape check -> toe end = the end of the foot's axis on the side of the tap.
 */
import type { FailureCode, SeedSummary } from "../analysis/types";
import { componentStats, labelComponents, open } from "./blobs";
import { allocLab, rgbaToLab } from "./color";
import { DEFAULT_SEGMENT_OPTIONS, buildBlob, distanceMap, estimateFloor, localStd, type FootBlob, type SeedColour, type SegmentOptions } from "./segment";

export interface FootSeed {
  /** where the person tapped, normalised to the picture */
  tap: { x: number; y: number };
  /** seconds into the video of the frame that was tapped */
  t: number;
  colour: SeedColour;
  /** the grown foot's area, as a share of the frame */
  area: number;
  /** length / width of the trimmed foot, in frame heights */
  length: number;
  width: number;
  /**
   * Unit vector from the heel toward the toes (image coordinates, y down), or null when the tap was not near the toes.
   * A hint only: a clip with no walking in it has no other way to know which way the person faces.
   */
  toeDir: [number, number] | null;
}

export interface SeedFound {
  seed: FootSeed;
  /** the grown foot (1 = foot) at the working resolution, to show the person what was found */
  region: Uint8Array;
  width: number;
  height: number;
  blob: FootBlob;
  /** toe end and heel end of the foot along its axis, working-resolution pixels */
  toe: [number, number];
  heel: [number, number];
}

export type SeedResult = SeedFound | { error: string };

/** The tap counts as "at the toes" when it is within this share of the foot's full extent from the toe end. */
const NEAR_TOES = 0.3;
/** Shoes and knitted socks are rougher than skin. */
const SEED_TEXTURE_STD = 14;
/** Smallest and largest patch (share of the frame) that can be a foot. */
const MIN_FOOT_AREA = 0.002;
const MAX_FOOT_AREA = 0.3;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mad = (v: number[], c: number) => 1.4826 * median(v.map((x) => Math.abs(x - c)));

const TAP_HINT = "Tap the gap between your big toe and the next toe.";
export const NOT_A_FOOT = {
  floor: `That spot looks like the floor, not a foot. ${TAP_HINT}`,
  nothing: `We couldn't make out a foot at that spot. ${TAP_HINT}`,
  small: `That patch is too small to be a foot. ${TAP_HINT}`,
  big: `That patch is too big to be a foot (it looks like part of the floor). ${TAP_HINT}`,
  shape: `That doesn't look like a foot (the shape is off). ${TAP_HINT}`,
  sideways: "The foot is lying sideways in the picture. Hold the phone with its top edge pointing the way you walk and record again.",
} as const;

/**
 * Learns the foot under a tap. `rgba` is a frame at the working resolution, `tapPx` the tap in its pixels, `t` the frame's
 * time in the video. Returns what was learned, or the plain-language reason the tap could not be used.
 */
export function learnFootSeed(
  rgba: ArrayLike<number>,
  w: number,
  h: number,
  tapPx: { x: number; y: number },
  t = 0,
  partial: Partial<SegmentOptions> = {},
): SeedResult {
  const o: SegmentOptions = { ...DEFAULT_SEGMENT_OPTIONS, ...partial, seed: null };
  const n = w * h;
  const tx = Math.max(0, Math.min(w - 1, Math.round(tapPx.x)));
  const ty = Math.max(0, Math.min(h - 1, Math.round(tapPx.y)));
  const lab = rgbaToLab(rgba, n, allocLab(n));
  const floor = estimateFloor(lab, n);
  const D = distanceMap(lab, floor, n);
  const tex = localStd(lab.L, w, h, 2);

  // the disk around the tap (about a toe's width), as pixel indices
  const R = Math.max(3, Math.round(0.022 * w));
  const disk: number[] = [];
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      if (dx * dx + dy * dy <= R * R && x >= 0 && y >= 0 && x < w && y < h) disk.push(y * w + x);
    }
  }

  // 1. colour around the tap, leaving out floor-coloured pixels (the floor shows through the gap between the toes)
  const sL: number[] = [];
  const sA: number[] = [];
  const sB: number[] = [];
  for (const i of disk) {
    if (D[i] <= o.floorDistance) continue;
    sL.push(lab.L[i]);
    sA.push(lab.a[i]);
    sB.push(lab.b[i]);
  }
  if (sL.length < 8) return { error: NOT_A_FOOT.floor };
  const mu: [number, number, number] = [median(sL), median(sA), median(sB)];
  const sd0: [number, number, number] = [Math.max(mad(sL, mu[0]), 6), Math.max(mad(sA, mu[1]), 3), Math.max(mad(sB, mu[2]), 3)];

  // 2. grow: not floor, smooth enough, close in colour
  const tolL = Math.max(3 * sd0[0], 22);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (D[i] <= o.floorDistance || tex[i] > SEED_TEXTURE_STD) continue;
    if (Math.abs(lab.L[i] - mu[0]) > tolL) continue;
    if (Math.hypot((lab.a[i] - mu[1]) / sd0[1], (lab.b[i] - mu[2]) / sd0[2]) > 3.2) continue;
    mask[i] = 1;
  }
  const opened = open(mask, w, h, o.openIterations);
  const { labels, count } = labelComponents(opened, w, h);
  const votes = new Map<number, number>();
  for (const i of disk) if (labels[i] > 0) votes.set(labels[i], (votes.get(labels[i]) ?? 0) + 1);
  if (!votes.size) return { error: NOT_A_FOOT.nothing };
  const label = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const comp = componentStats(labels, w, h, count).find((c) => c.label === label);
  if (!comp) return { error: NOT_A_FOOT.nothing };
  const areaFrac = comp.area / n;
  if (areaFrac < MIN_FOOT_AREA) return { error: NOT_A_FOOT.small };
  if (areaFrac > MAX_FOOT_AREA) return { error: NOT_A_FOOT.big };

  // 3. refit the colour on the grown foot, with its shading; widened so a shadow or a change of exposure does not lose it
  const region = new Uint8Array(n);
  const xs: number[] = [];
  const ys: number[] = [];
  const L: number[] = [];
  const A: number[] = [];
  const B: number[] = [];
  for (let y = comp.y0; y <= comp.y1; y++) {
    for (let x = comp.x0; x <= comp.x1; x++) {
      const i = y * w + x;
      if (labels[i] !== label) continue;
      region[i] = 1;
      xs.push(x);
      ys.push(y);
      L.push(lab.L[i]);
      A.push(lab.a[i]);
      B.push(lab.b[i]);
    }
  }
  const stats = (v: number[]) => {
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return { m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) };
  };
  const sl = stats(L);
  const sa = stats(A);
  const sb = stats(B);
  const colour: SeedColour = {
    mean: [sl.m, sa.m, sb.m],
    sd: [Math.max(1.25 * sl.sd, 8), Math.max(1.25 * sa.sd, 3), Math.max(1.25 * sb.sd, 3)],
  };

  // 4. shape check: elongated, filled, not lying sideways. The size was checked above, so the area term is switched off here.
  const shapeOptions: SegmentOptions = {
    ...o,
    minAreaFrac: Math.min(o.minAreaFrac, areaFrac),
    maxAreaFrac: Math.max(o.maxAreaFrac, areaFrac),
  };
  const blob = buildBlob(comp, labels, w, h, lab, shapeOptions);
  if (!blob) return { error: NOT_A_FOOT.shape };
  if (blob.score < o.minScore) {
    const tiltDeg = (Math.atan2(Math.abs(blob.ux), -blob.uy) * 180) / Math.PI;
    return { error: tiltDeg > 70 ? NOT_A_FOOT.sideways : NOT_A_FOOT.shape };
  }

  // 5. which way the toes lie along the axis: the side of the foot the tap is on (the gap between the toes is near the tip).
  // Measured on the whole grown region, not the trimmed blob, because the trimming assumes the toes point up the picture.
  const { ux, uy } = blob;
  let sMin = Infinity;
  let sMax = -Infinity;
  for (let k = 0; k < xs.length; k++) {
    const s = (xs[k] - comp.cx) * ux + (ys[k] - comp.cy) * uy;
    if (s < sMin) sMin = s;
    if (s > sMax) sMax = s;
  }
  const sTap = (tx - comp.cx) * ux + (ty - comp.cy) * uy;
  const towardPlus = sTap >= (sMin + sMax) / 2;
  const sToe = towardPlus ? sMax : sMin;
  const dir: [number, number] = towardPlus ? [ux, uy] : [-ux, -uy];
  const extent = sMax - sMin;
  const footLen = Math.min(extent, blob.length * h);
  const toe: [number, number] = [comp.cx + ux * sToe, comp.cy + uy * sToe];
  const heel: [number, number] = [toe[0] - dir[0] * footLen, toe[1] - dir[1] * footLen];
  const nearToes = extent > 4 && Math.abs(sToe - sTap) <= NEAR_TOES * extent;

  return {
    seed: {
      tap: { x: tx / w, y: ty / h },
      t,
      colour,
      area: areaFrac,
      length: blob.length,
      width: blob.width,
      toeDir: nearToes ? dir : null,
    },
    region,
    width: w,
    height: h,
    blob,
    toe,
    heel,
  };
}

/** Scan failures a tap on the foot can help with: the feet were not found, or not steadily enough. */
export const TAP_CAN_HELP: ReadonlySet<FailureCode> = new Set<FailureCode>([
  "no_pose",
  "no_feet",
  "no_approach",
  "no_steps",
  "no_steps_left",
  "no_steps_right",
]);

/** Degrees clockwise from the top of the picture of a unit vector in image coordinates (y down). */
export const directionDeg = (v: [number, number]) => (Math.atan2(v[0], -v[1]) * 180) / Math.PI;

/** The tapped toes pointing further than this from the way the floor slid means the tap or the direction is probably off. */
export const SEED_DISAGREES_DEG = 60;
/** A learned colour that found the feet in fewer than this share of the frames does not describe them well. */
export const SEED_MIN_FRAME_SHARE = 0.5;

export const SEED_WARNINGS = {
  disagrees: (deg: number) =>
    `The foot you marked points ${deg.toFixed(0)}° away from the way the floor slid through the picture. Check that you tapped the gap between the big toe and the next toe, and that the top edge of the phone pointed the way you walked.`,
  fewFrames: (share: number) =>
    `The colour you marked matched your feet in only ${Math.round(share * 100)}% of the frames; the other frames used the general skin test.`,
} as const;

/**
 * What to report about a tap once the clip has been analysed: how often its colour found the feet, and whether the tapped toes
 * agree with the walking direction (`heading`: degrees clockwise from the top of the picture, `fitted` = the clip had walking in it).
 */
export function seedSummary(
  seed: FootSeed,
  frames: { seededFrames: number; fallbackFrames: number },
  heading: { psiDeg: number; fitted: boolean },
  standingFwd: [number, number] | null = null,
): SeedSummary {
  const toeAngleDeg = seed.toeDir ? directionDeg(seed.toeDir) : null;
  let vsWalkingDeg: number | null = null;
  if (toeAngleDeg !== null && heading.fitted) {
    let d = Math.abs(toeAngleDeg - heading.psiDeg) % 360;
    if (d > 180) d = 360 - d;
    vsWalkingDeg = d;
  }
  return {
    colour: [...seed.colour.mean],
    toeAngleDeg,
    seededFrames: frames.seededFrames,
    fallbackFrames: frames.fallbackFrames,
    vsWalkingDeg,
    setDirection: !heading.fitted && standingFwd !== null && !(standingFwd[0] === 0 && standingFwd[1] === -1),
  };
}

/** Plain-language notes about a tap that went wrong; empty when it looks fine. */
export function seedWarnings(s: SeedSummary): string[] {
  const out: string[] = [];
  if (s.vsWalkingDeg !== null && s.vsWalkingDeg > SEED_DISAGREES_DEG) out.push(SEED_WARNINGS.disagrees(s.vsWalkingDeg));
  const total = s.seededFrames + s.fallbackFrames;
  if (total > 0 && s.seededFrames / total < SEED_MIN_FRAME_SHARE) out.push(SEED_WARNINGS.fewFrames(s.seededFrames / total));
  return out;
}

/**
 * Segmentation options for one video once a foot is known. The tapped foot can only relax or raise the generic limits, never
 * tighten them below the default: the grown patch is the part of the foot that matched the colour, so it may be smaller than
 * the whole foot, and shrinking the limits to it would throw real feet away.
 */
export function seededSegmentOptions(seed: FootSeed, base: Partial<SegmentOptions> = {}): Partial<SegmentOptions> {
  return {
    ...base,
    seed: seed.colour,
    maxTextureStd: Math.max(base.maxTextureStd ?? DEFAULT_SEGMENT_OPTIONS.maxTextureStd, SEED_TEXTURE_STD),
    minAreaFrac: Math.max(base.minAreaFrac ?? DEFAULT_SEGMENT_OPTIONS.minAreaFrac, 0.15 * seed.area),
    maxAreaFrac: Math.max(base.maxAreaFrac ?? DEFAULT_SEGMENT_OPTIONS.maxAreaFrac, 1.8 * seed.area),
  };
}
