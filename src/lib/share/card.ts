import { TARGET_BAND } from "../config";
import { describeAngle, type LabelTone, type ScoreResult } from "../scoring/score";

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1920;

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const PALETTE: Record<LabelTone, { accent: string; accent2: string; glow: string }> = {
  great: { accent: "#c6f432", accent2: "#2dd4bf", glow: "rgba(45,212,191,0.35)" },
  good: { accent: "#5eead4", accent2: "#60a5fa", glow: "rgba(96,165,250,0.35)" },
  quirky: { accent: "#fbbf24", accent2: "#f472b6", glow: "rgba(244,114,182,0.32)" },
};

type Ctx = CanvasRenderingContext2D;

function setTracking(ctx: Ctx, px: number) {
  const c = ctx as Ctx & { letterSpacing?: string };
  if ("letterSpacing" in c) c.letterSpacing = `${px}px`;
}

function fitFont(ctx: Ctx, text: string, maxWidth: number, startSize: number, weight: number, minSize = 40): number {
  let size = startSize;
  for (; size > minSize; size -= 2) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  return size;
}

function wrapLines(ctx: Ctx, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[.,;:]?$/, "")}…`;
    return kept;
  }
  return lines;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Top-down footprint with the heel at the origin and the toes pointing up (-y).
 * `medial` is +1 when the big toe is on the right side of the foot (a left foot), -1 for a right foot.
 */
function footPath(ctx: Ctx, len: number) {
  const w = len * 0.2;
  ctx.beginPath();
  ctx.moveTo(-w * 0.55, -len * 0.02);
  ctx.bezierCurveTo(-w * 0.95, -len * 0.12, -w * 0.7, -len * 0.38, -w * 0.8, -len * 0.55);
  ctx.bezierCurveTo(-w * 1.25, -len * 0.7, -w * 1.2, -len * 0.92, -w * 0.3, -len * 0.97);
  ctx.bezierCurveTo(w * 0.6, -len * 1.02, w * 1.3, -len * 0.9, w * 1.1, -len * 0.62);
  ctx.bezierCurveTo(w * 0.95, -len * 0.4, w * 0.95, -len * 0.2, w * 0.6, -len * 0.04);
  ctx.bezierCurveTo(w * 0.35, len * 0.04, -w * 0.35, len * 0.04, -w * 0.55, -len * 0.02);
  ctx.closePath();
}

function drawFoot(ctx: Ctx, heelX: number, heelY: number, len: number, deg: number, isLeft: boolean, accent: string) {
  const side = isLeft ? -1 : 1; // toe-out turns a left foot counter-clockwise and a right foot clockwise (top-down view)
  ctx.save();
  ctx.translate(heelX, heelY);

  // target band wedge (relative to the walking direction)
  const R = len * 1.18;
  const a0 = -Math.PI / 2 + side * (TARGET_BAND.minDeg * Math.PI) / 180;
  const a1 = -Math.PI / 2 + side * (TARGET_BAND.maxDeg * Math.PI) / 180;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, R, Math.min(a0, a1), Math.max(a0, a1));
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fill();

  // walking-direction guide
  ctx.setLineDash([14, 14]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -R);
  ctx.stroke();
  ctx.setLineDash([]);

  // the foot, rotated about the heel
  ctx.rotate(side * (deg * Math.PI) / 180);
  footPath(ctx, len);
  const g = ctx.createLinearGradient(0, 0, 0, -len);
  g.addColorStop(0, accent);
  g.addColorStop(1, "#ffffff");
  ctx.fillStyle = g;
  ctx.fill();

  // toes
  const medial = isLeft ? 1 : -1;
  const toes = [
    { x: 0.17, y: -1.05, r: 0.075 },
    { x: 0.04, y: -1.07, r: 0.05 },
    { x: -0.08, y: -1.04, r: 0.045 },
    { x: -0.18, y: -0.98, r: 0.04 },
    { x: -0.26, y: -0.9, r: 0.035 },
  ];
  ctx.fillStyle = "#ffffff";
  for (const t of toes) {
    ctx.beginPath();
    ctx.arc(medial * t.x * len, t.y * len, t.r * len, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function angleCaption(deg: number): string {
  const d = describeAngle(deg);
  if (d.direction === "straight") return "straight ahead";
  return `${d.text} ${d.direction === "out" ? "toe-out" : "toe-in"}`;
}

export function shareCardAlt(s: ScoreResult): string {
  const l = describeAngle(s.leftDeg);
  const r = describeAngle(s.rightDeg);
  const dir = (d: ReturnType<typeof describeAngle>) =>
    d.direction === "straight" ? "straight" : `${d.text} ${d.direction === "out" ? "outward" : "inward"}`;
  return `Walk Score card: ${s.score} out of 100, "${s.label.title}". Left foot ${dir(l)}, right foot ${dir(r)}. Symmetry ${s.symmetryScore}%.`;
}

export interface CardOptions {
  /** shown at the bottom as a call to action, e.g. "walkscore.app" */
  host?: string;
}

/** Draws the 1080x1920 share card. No camera frame, face or video is ever drawn. */
export function drawShareCard(ctx: Ctx, s: ScoreResult, opts: CardOptions = {}) {
  const W = CARD_WIDTH;
  const H = CARD_HEIGHT;
  const pal = PALETTE[s.label.tone];
  ctx.textBaseline = "alphabetic";

  // background
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, "#0a0f24");
  bg.addColorStop(0.55, "#171046");
  bg.addColorStop(1, "#0b1a2e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 640, 40, W / 2, 640, 640);
  glow.addColorStop(0, pal.glow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // brand
  ctx.textAlign = "center";
  ctx.fillStyle = pal.accent;
  ctx.font = `800 40px ${FONT}`;
  setTracking(ctx, 12);
  ctx.fillText("WALK SCORE", W / 2, 150);
  setTracking(ctx, 0);

  // score ring
  const cx = W / 2;
  const cy = 640;
  const radius = 300;
  ctx.lineWidth = 44;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  const ring = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  ring.addColorStop(0, pal.accent);
  ring.addColorStop(1, pal.accent2);
  ctx.strokeStyle = ring;
  ctx.beginPath();
  const sweep = (Math.max(s.score, 1) / 100) * Math.PI * 2;
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + sweep);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = `800 300px ${FONT}`;
  ctx.fillText(String(s.score), cx, cy + 100);
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = `600 48px ${FONT}`;
  ctx.fillText("out of 100", cx, cy + 190);

  // label + tagline
  ctx.fillStyle = "#ffffff";
  const size = fitFont(ctx, s.label.title, W - 160, 104, 800);
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.fillText(s.label.title, cx, 1090);
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = `500 40px ${FONT}`;
  const lines = wrapLines(ctx, s.label.tagline, W - 220, 2);
  lines.forEach((ln, i) => ctx.fillText(ln, cx, 1160 + i * 54));

  // foot panel
  const px = 70;
  const py = 1262;
  const pw = W - 140;
  const ph = 452;
  roundRect(ctx, px, py, pw, ph, 44);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.stroke();

  const heelY = py + 372;
  drawFoot(ctx, 340, heelY, 230, s.leftDeg, true, pal.accent);
  drawFoot(ctx, 740, heelY, 230, s.rightDeg, false, pal.accent);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `700 30px ${FONT}`;
  setTracking(ctx, 5);
  ctx.fillText("LEFT", 340, py + 424);
  ctx.fillText("RIGHT", 740, py + 424);
  setTracking(ctx, 0);
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 46px ${FONT}`;
  ctx.fillText(angleCaption(s.leftDeg), 340, py + 70);
  ctx.fillText(angleCaption(s.rightDeg), 740, py + 70);

  // symmetry pill
  const pill = `Symmetry ${s.symmetryScore}%`;
  ctx.font = `700 40px ${FONT}`;
  const pillW = ctx.measureText(pill).width + 80;
  roundRect(ctx, cx - pillW / 2, 1736, pillW, 76, 38);
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fill();
  ctx.fillStyle = pal.accent;
  ctx.fillText(pill, cx, 1736 + 51);

  // footer
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText("For fun only · processed on-device · no face, no video", cx, 1866);
  if (opts.host) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(opts.host, cx, 1904);
  }
}

export async function renderShareCard(s: ScoreResult, opts: CardOptions = {}): Promise<Blob> {
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* fonts are system fonts; ignore */
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  drawShareCard(ctx, s, opts);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create the image."))), "image/png");
  });
}
