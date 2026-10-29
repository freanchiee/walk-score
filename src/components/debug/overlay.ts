import { LEG_CONNECTIONS, LM } from "@/lib/analysis/landmarks";
import type { AnalysisResult, Foot, PoseFrame } from "@/lib/analysis/types";
import type { TopDownFrame } from "@/lib/topdown/analyze";
import { segmentFeet, type FootBlob, type FrameSegmentation, type SegmentOptions } from "@/lib/topdown/segment";

export const STATE_COLORS = {
  stance: "#4ade80", // planted, used for the angle
  discarded: "#fbbf24", // planted, but the step was thrown away
  swing: "#e5e7eb", // moving or not flat
  invalid: "#f87171", // low visibility / clipped
  approach: "#60a5fa",
} as const;

const FEET: Foot[] = ["left", "right"];

export type FootState = keyof typeof STATE_COLORS;

/** What the analysis thinks the foot is doing in frame `idx`. */
export function footState(result: AnalysisResult, idx: number, foot: Foot): FootState {
  const d = result.frames[idx]?.[foot];
  if (!d) return "invalid";
  if (d.usable) return d.step >= 0 && result.steps[d.step]?.used ? "stance" : "discarded";
  return d.valid ? "swing" : "invalid";
}

/** Draws the landmarks of one frame over the video; coordinates are normalized so the canvas size does not matter. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: PoseFrame | undefined,
  idx: number,
  result: AnalysisResult | null,
  opts: { skeleton: boolean },
) {
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = "round";
  ctx.font = `600 ${Math.max(11, Math.round(w / 38))}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "top";

  const hud = (lines: string[]) => {
    const size = Math.max(11, Math.round(w / 38));
    const pad = 6;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(6, 6, widest + pad * 2, lines.length * (size + 3) + pad);
    ctx.fillStyle = "#fff";
    lines.forEach((l, i) => ctx.fillText(l, 6 + pad, 6 + pad / 2 + i * (size + 3)));
  };

  if (!frame || !frame.ok || !frame.img) {
    hud([`frame ${idx + 1}`, "no pose detected"]);
    return;
  }
  const img = frame.img;
  const px = (i: number): [number, number] => [img[i].x * w, img[i].y * h];

  if (opts.skeleton) {
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = Math.max(1.5, w / 300);
    for (const [a, b] of LEG_CONNECTIONS) {
      const [ax, ay] = px(a);
      const [bx, by] = px(b);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  }

  const lines = [`frame ${idx + 1}  t=${frame.t.toFixed(2)}s`];
  if (result) {
    const swap = result.swapLeftRight;
    for (const foot of FEET) {
      const model: Foot = swap ? (foot === "left" ? "right" : "left") : foot;
      const heel = model === "left" ? LM.L_HEEL : LM.R_HEEL;
      const toe = model === "left" ? LM.L_FOOT_INDEX : LM.R_FOOT_INDEX;
      const state = footState(result, idx, foot);
      const color = STATE_COLORS[state];
      const [hx, hy] = px(heel);
      const [tx, ty] = px(toe);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(3, w / 120);
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy, Math.max(3, w / 130), 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tx, ty, Math.max(4, w / 100), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(foot === "left" ? "L" : "R", tx + 8, ty - 8);
      lines.push(`${foot === "left" ? "L" : "R"}: ${state} (vis ${Math.min(img[heel].v, img[toe].v).toFixed(2)})`);
    }
    if (result.frames[idx]?.approach) lines.push("approaching ✓");
  }
  hud(lines);
}

/** Stance timeline: approach lane + one lane per foot. */
export function drawTimeline(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  result: AnalysisResult | null,
  n: number,
  idx: number,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(0, 0, w, h);
  if (!result || n === 0) return;
  const lane = h / 3;
  const cw = w / n;
  const labels = ["approach", "left", "right"];
  for (let i = 0; i < n; i++) {
    const f = result.frames[i];
    const x = i * cw;
    if (f.approach) {
      ctx.fillStyle = STATE_COLORS.approach;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x, 3, Math.ceil(cw), lane - 6);
      ctx.globalAlpha = 1;
    }
    FEET.forEach((foot, k) => {
      const s = footState(result, i, foot);
      if (s === "invalid") return;
      ctx.fillStyle = STATE_COLORS[s];
      ctx.globalAlpha = s === "swing" ? 0.18 : 0.95;
      const top = lane * (k + 1) + 3;
      ctx.fillRect(x, top, Math.ceil(cw), lane - 6);
      ctx.globalAlpha = 1;
    });
  }
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  labels.forEach((l, i) => ctx.fillText(l, 4, lane * i + lane / 2));
  const px = ((idx + 0.5) / n) * w;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px, 0);
  ctx.lineTo(px, h);
  ctx.stroke();
}

// ---------- top-down view ---------------------------------------------------------------------------

function drawBlob(
  ctx: CanvasRenderingContext2D,
  b: FootBlob,
  w: number,
  h: number,
  color: string,
  label: string,
  opts: { dashed?: boolean } = {},
) {
  const cx = b.cx * w;
  const cy = b.cy * h;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, w / 160);
  if (opts.dashed) ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(2, (b.length * h) / 2), Math.max(2, (b.width * h) / 2), Math.atan2(b.uy, b.ux), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // long axis, heel -> toe, with a dot at the toe end
  ctx.lineWidth = Math.max(2.5, w / 110);
  ctx.beginPath();
  ctx.moveTo(b.heelX * w, b.heelY * h);
  ctx.lineTo(b.toeX * w, b.toeY * h);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(b.toeX * w, b.toeY * h, Math.max(3, w / 90), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  ctx.fillText(label, cx + (b.width * h) / 2 + 4, cy - 8);
  ctx.restore();
}

/** Top-down overlay: the feet the analysis used (coloured by state), ignored blobs, the walking direction. */
export function drawTopDownOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: TopDownFrame | undefined,
  idx: number,
  result: AnalysisResult | null,
  clear = true,
) {
  if (clear) ctx.clearRect(0, 0, w, h);
  const size = Math.max(11, Math.round(w / 34));
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "top";
  const lines = [`frame ${idx + 1}  t=${frame ? frame.t.toFixed(2) : "?"}s`];

  if (frame && result) {
    const psi = (result.heading.psiDeg * Math.PI) / 180;
    const fx = Math.sin(psi);
    const fy = -Math.cos(psi);
    const used = new Set<number>();
    for (const foot of ["left", "right"] as Foot[]) {
      const tag = foot === "left" ? "L" : "R";
      const d = result.frames[idx]?.[foot];
      const bi = d?.blobIndex ?? -1;
      const blob = bi >= 0 ? frame.blobs[bi] : undefined;
      if (!blob) {
        lines.push(`${tag}: not found`);
        continue;
      }
      used.add(bi);
      const state = footState(result, idx, foot);
      // per-frame angle as the analysis computes it (without calibration offsets)
      const dot = blob.ux * fx + blob.uy * fy;
      const sg = dot >= 0 ? 1 : -1;
      const tx = sg * blob.ux;
      const ty = sg * blob.uy;
      const beta = (Math.atan2(fx * ty - fy * tx, fx * tx + fy * ty) * 180) / Math.PI;
      const fpa = (foot === "left" ? -1 : 1) * beta;
      drawBlob(ctx, blob, w, h, STATE_COLORS[state], `${tag} ${fpa >= 0 ? "+" : ""}${fpa.toFixed(1)}°`);
      lines.push(`${tag}: ${state}  ${fpa >= 0 ? "+" : ""}${fpa.toFixed(1)}°  score ${blob.score.toFixed(2)}${blob.clipped ? "  clipped" : ""}`);
    }
    frame.blobs.forEach((b, i) => {
      if (!used.has(i)) drawBlob(ctx, b, w, h, "rgba(210,210,210,0.8)", `ignored ${b.score.toFixed(2)}${b.clipped ? " clip" : ""}`, { dashed: true });
    });

    // walking direction
    const ax = w * 0.5;
    const ay = h * 0.14;
    const len = h * 0.07;
    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ax - fx * len, ay - fy * len);
    ctx.lineTo(ax + fx * len, ay + fy * len);
    ctx.stroke();
    ctx.beginPath();
    const hx = ax + fx * len;
    const hy = ay + fy * len;
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - fx * 10 - fy * 6, hy - fy * 10 + fx * 6);
    ctx.lineTo(hx - fx * 10 + fy * 6, hy - fy * 10 - fx * 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    lines.push(result.heading.fitted ? `walking ψ=${result.heading.psiDeg.toFixed(0)}°` : "standing: top of phone = forward");
  }

  const pad = 6;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(6, 6, widest + pad * 2, lines.length * (size + 3) + pad);
  ctx.fillStyle = "#fff";
  lines.forEach((l, i) => ctx.fillText(l, 6 + pad, 6 + pad / 2 + i * (size + 3)));
}

let maskCanvas: HTMLCanvasElement | null = null;
let workCanvas: HTMLCanvasElement | null = null;

/**
 * Segments the CURRENT video frame with the given settings and paints the candidate mask over it, so you can see
 * what the feet finder sees. Returns the segmentation (or null when the video has no decoded frame yet).
 */
export function drawMaskOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  video: HTMLVideoElement | null,
  seg: Partial<SegmentOptions>,
  workWidth = 240,
): FrameSegmentation | null {
  if (!video || video.readyState < 2 || !video.videoWidth) return null;
  const workH = Math.max(2, Math.round((workWidth * video.videoHeight) / video.videoWidth));
  workCanvas ??= document.createElement("canvas");
  maskCanvas ??= document.createElement("canvas");
  workCanvas.width = workWidth;
  workCanvas.height = workH;
  const wctx = workCanvas.getContext("2d", { willReadFrequently: true });
  if (!wctx) return null;
  wctx.drawImage(video, 0, 0, workWidth, workH);
  const { data } = wctx.getImageData(0, 0, workWidth, workH);
  const s = segmentFeet(data, workWidth, workH, seg);
  maskCanvas.width = workWidth;
  maskCanvas.height = workH;
  const mctx = maskCanvas.getContext("2d");
  if (!mctx) return s;
  const img = mctx.createImageData(workWidth, workH);
  for (let i = 0; i < s.mask.length; i++) {
    if (s.mask[i]) {
      img.data[i * 4] = 0;
      img.data[i * 4 + 1] = 220;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = 110;
    }
  }
  mctx.putImageData(img, 0, 0);
  ctx.drawImage(maskCanvas, 0, 0, w, h);
  return s;
}
