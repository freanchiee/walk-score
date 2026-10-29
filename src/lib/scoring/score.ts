import { LABEL_CONFIG, SCORE_CONFIG, TARGET_BAND } from "../config";

export interface Band {
  readonly minDeg: number;
  readonly maxDeg: number;
}

export type Quality = "rough" | "ok" | "good";

export interface ScoreInput {
  leftDeg: number;
  rightDeg: number;
  leftSteps: number;
  rightSteps: number;
  quality: Quality;
  /** the angles come from a standing stance, not from steps */
  standing?: boolean;
  /** the phone's sensors could not vouch for the capture (none available, or none came with an uploaded video) */
  lowConfidence?: boolean;
  /** why the capture was less than ideal, as a sentence (e.g. "The phone was tilted about 9° on average."), shown as a cue */
  captureNote?: string;
}

export type LabelTone = "great" | "good" | "quirky";

export interface WalkLabel {
  id: string;
  title: string;
  tagline: string;
  tone: LabelTone;
}

export interface ScoreResult {
  /** 0..100, integer */
  score: number;
  /** 0..100 - how close both feet are to the target band */
  angleScore: number;
  /** 0..100 - how alike the two feet are */
  symmetryScore: number;
  leftDeg: number;
  rightDeg: number;
  meanDeg: number;
  asymmetryDeg: number;
  label: WalkLabel;
  cues: string[];
  quality: Quality;
  leftSteps: number;
  rightSteps: number;
  standing: boolean;
  /** shown as "Rough read · low confidence" */
  lowConfidence: boolean;
}

const gauss = (distance: number, sigma: number) => Math.exp(-0.5 * (distance / sigma) ** 2);

/** Degrees outside the target band (0 inside it). */
export function distanceToBand(deg: number, band: Band = TARGET_BAND): number {
  if (deg < band.minDeg) return band.minDeg - deg;
  if (deg > band.maxDeg) return deg - band.maxDeg;
  return 0;
}

export function footScore(deg: number, band: Band = TARGET_BAND): number {
  return 100 * gauss(distanceToBand(deg, band), SCORE_CONFIG.angleSigmaDeg);
}

export function symmetryScore(asymmetryDeg: number): number {
  return 100 * gauss(asymmetryDeg, SCORE_CONFIG.symmetrySigmaDeg);
}

export const LABELS = {
  runway: { id: "runway", title: "Runway Straight", tagline: "Clean lines, even steps. Strut like it's a catwalk.", tone: "great" },
  smooth: { id: "smooth", title: "Street Smooth", tagline: "Easy, balanced and close to the sweet spot.", tone: "good" },
  freeSpirit: { id: "free-spirit", title: "Free Spirit", tagline: "Your stride has its own style - no two walks alike.", tone: "quirky" },
  chaplin: { id: "chaplin", title: "Chaplin Stroll", tagline: "A touch of splay. Silent-film star energy.", tone: "quirky" },
  duck: { id: "duck", title: "Duck Walker", tagline: "Toes proudly out. Waddle with confidence.", tone: "quirky" },
  pigeon: { id: "pigeon", title: "Pigeon Strut", tagline: "Toes tucked in, head-bob optional.", tone: "quirky" },
  plotTwist: { id: "plot-twist", title: "Plot Twist", tagline: "Left and right are doing their own thing.", tone: "quirky" },
} as const satisfies Record<string, WalkLabel>;

export function pickLabel(score: number, meanDeg: number, asymmetryDeg: number, band: Band = TARGET_BAND): WalkLabel {
  if (asymmetryDeg >= LABEL_CONFIG.bigAsymmetryDeg) return LABELS.plotTwist;
  if (meanDeg > band.maxDeg + LABEL_CONFIG.duckDeg) return LABELS.duck;
  if (meanDeg > band.maxDeg + LABEL_CONFIG.splayDeg) return LABELS.chaplin;
  if (meanDeg < band.minDeg - LABEL_CONFIG.toeInDeg) return LABELS.pigeon;
  if (score >= LABEL_CONFIG.runwayScore) return LABELS.runway;
  if (score >= LABEL_CONFIG.smoothScore) return LABELS.smooth;
  return LABELS.freeSpirit;
}

/** "8° out", "3° in" or "straight" - whole degrees, since a phone camera cannot do better. */
export function describeAngle(deg: number): { value: number; text: string; direction: "out" | "in" | "straight" } {
  const rounded = Math.round(deg);
  if (rounded === 0) return { value: 0, text: "0°", direction: "straight" };
  return { value: Math.abs(rounded), text: `${Math.abs(rounded)}°`, direction: rounded > 0 ? "out" : "in" };
}

function phrase(deg: number): string {
  const d = describeAngle(deg);
  if (d.direction === "straight") return "straight ahead";
  return `${d.text} ${d.direction === "out" ? "outward" : "inward"}`;
}

export function buildCues(input: ScoreInput, asymmetryDeg: number, band: Band = TARGET_BAND): string[] {
  const cues: string[] = [];
  const sweet = `${band.minDeg}–${band.maxDeg}°`;
  const dl = distanceToBand(input.leftDeg, band);
  const dr = distanceToBand(input.rightDeg, band);

  // which side of the band each foot is on: 1 = beyond the upper edge, -1 = below the lower edge, 0 = inside
  const sideOf = (deg: number, d: number) => (d < 0.5 ? 0 : deg > band.maxDeg ? 1 : -1);
  const sl = sideOf(input.leftDeg, dl);
  const sr = sideOf(input.rightDeg, dr);

  if (sl === 0 && sr === 0) {
    cues.push(`Both feet land inside our ${sweet} sweet spot (left ${phrase(input.leftDeg)}, right ${phrase(input.rightDeg)}).`);
  } else if (sl !== 0 && sl === sr) {
    const way = sl > 0 ? "further out" : "further in";
    cues.push(`Both feet point ${way} than our ${sweet} sweet spot (left ${phrase(input.leftDeg)}, right ${phrase(input.rightDeg)}).`);
  } else {
    const worst = dl >= dr ? "left" : "right";
    const deg = worst === "left" ? input.leftDeg : input.rightDeg;
    const other = worst === "left" ? "right" : "left";
    const otherDeg = worst === "left" ? input.rightDeg : input.leftDeg;
    const side = deg > band.maxDeg ? "past" : "short of";
    cues.push(
      `Your ${worst} foot points ${phrase(deg)} - ${Math.round(Math.max(dl, dr))}° ${side} our ${sweet} sweet spot. Your ${other} foot points ${phrase(otherDeg)}.`,
    );
  }

  // from the whole degrees the user sees, so "12° and 4°" never comes with "differ by 7°"
  const asym = Math.abs(Math.round(input.leftDeg) - Math.round(input.rightDeg));
  if (asymmetryDeg <= 3) cues.push(`Your feet match within ${Math.max(asym, 1)}° - very even.`);
  else if (asymmetryDeg < LABEL_CONFIG.bigAsymmetryDeg) {
    const turnier = input.leftDeg > input.rightDeg ? "left" : "right";
    cues.push(`Your feet differ by ${asym}° - your ${turnier} foot turns out more.`);
  } else {
    const turnier = input.leftDeg > input.rightDeg ? "left" : "right";
    cues.push(`Big gap: your feet differ by ${asym}°, with the ${turnier} foot turning out more.`);
  }

  const nl = input.leftSteps;
  const nr = input.rightSteps;
  const steps = (n: number) => `${n} step${n === 1 ? "" : "s"}`;
  if (input.standing) {
    cues.push("We read your standing stance, since no steps were detected. Take a few steps while recording for a true walking angle.");
  } else if (input.lowConfidence) {
    cues.push("Low confidence: we couldn't read your phone's motion sensors, so tilt and steadiness were not checked. Treat this as a rough read.");
  } else if (input.quality === "rough") {
    cues.push(
      input.captureNote
        ? `Rough read - ${input.captureNote}`
        : `Rough read - only ${steps(Math.min(nl, nr))} caught for one foot. Scan again and keep walking for a steadier score.`,
    );
  } else if (input.quality === "ok") {
    cues.push(
      input.captureNote
        ? `Decent read - ${input.captureNote}`
        : `Based on ${steps(nl)} (left) and ${steps(nr)} (right). A second scan shows how steady your score is.`,
    );
  } else {
    cues.push(`Based on ${steps(nl)} (left) and ${steps(nr)} (right) - a clean read.`);
  }
  return cues;
}

export function computeScore(input: ScoreInput, band: Band = TARGET_BAND): ScoreResult {
  const asymmetryDeg = Math.abs(input.leftDeg - input.rightDeg);
  const angle = (footScore(input.leftDeg, band) + footScore(input.rightDeg, band)) / 2;
  const sym = symmetryScore(asymmetryDeg);
  const total = SCORE_CONFIG.weights.angle * angle + SCORE_CONFIG.weights.symmetry * sym;
  const score = Math.max(0, Math.min(100, Math.round(total)));
  const meanDeg = (input.leftDeg + input.rightDeg) / 2;
  return {
    score,
    angleScore: Math.round(angle),
    symmetryScore: Math.round(sym),
    leftDeg: input.leftDeg,
    rightDeg: input.rightDeg,
    meanDeg,
    asymmetryDeg,
    label: pickLabel(score, meanDeg, asymmetryDeg, band),
    cues: buildCues(input, asymmetryDeg, band),
    quality: input.quality,
    leftSteps: input.leftSteps,
    rightSteps: input.rightSteps,
    standing: input.standing === true,
    lowConfidence: input.lowConfidence === true,
  };
}
