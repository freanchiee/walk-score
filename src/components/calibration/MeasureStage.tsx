"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AnalysisResult } from "@/lib/analysis/types";
import { markedAngleDeg, type Pt, type Side } from "@/lib/calibration/measure";
import type { DirectionLine, Mark } from "@/lib/calibration/session";
import { seekTo, type LoadedVideo } from "@/lib/pose/video";
import type { TopDownFrame } from "@/lib/topdown/analyze";
import { Button } from "../ui";

export type Tool = "mark" | "direction";

const COLORS = { left: "#fbbf24", right: "#38bdf8", app: "#ffffff", own: "#c4b5fd" } as const;
/** how close (screen pixels) a press has to be to a point to grab it instead of placing a new one */
const GRAB_CSS_PX = 22;
/** a second click closer than this (screen pixels) to the first is a double click, not a second point */
const MIN_SPAN_CSS_PX = 14;
const LOUPE_CSS_PX = 128;

type Handle = { kind: "heel" | "toe"; id: number } | { kind: "a" | "b" };

interface Pending {
  idx: number;
  side: Side;
  heel: Pt;
}

interface Props {
  loaded: LoadedVideo;
  frames: TopDownFrame[];
  result: AnalysisResult;
  idx: number;
  /** the foot being marked */
  side: Side;
  tool: Tool;
  /** the app's walking direction, and the one angles are measured against (the person's own line, when used) */
  fwdApp: Pt;
  fwd: Pt;
  /** true when `fwd` is the person's own line rather than the app's direction */
  usingOwn: boolean;
  marks: Mark[];
  line: DirectionLine | null;
  showApp: boolean;
  onAddMark: (m: { side: Side; idx: number; heel: Pt; toe: Pt }) => void;
  onMoveMark: (id: number, which: "heel" | "toe", p: Pt) => void;
  onSetLine: (line: DirectionLine) => void;
  onMoveLine: (which: "a" | "b", p: Pt) => void;
  onToolDone: () => void;
}

interface PaintInput {
  W: number;
  H: number;
  dpr: number;
  video: HTMLVideoElement;
  frame: TopDownFrame | undefined;
  result: AnalysisResult;
  idx: number;
  fwdApp: Pt;
  fwd: Pt;
  usingOwn: boolean;
  marks: Mark[];
  line: DirectionLine | null;
  tool: Tool;
  side: Side;
  showApp: boolean;
  pending: Pending | null;
  dirPending: Pt | null;
  hover: Pt | null;
}

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}°`;

function paint(c: HTMLCanvasElement, o: PaintInput) {
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(o.video, 0, 0, c.width, c.height);
  const k = c.width / o.W; // device pixels per video pixel
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const px = (css: number) => (css * o.dpr) / k; // a length in screen pixels, in video pixels
  ctx.lineCap = "round";
  ctx.font = `700 ${px(13)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "middle";

  const label = (text: string, x: number, y: number, color: string) => {
    const w = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(x - px(3), y - px(9), w + px(6), px(18));
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  const dot = (p: Pt, color: string, hollow = false) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, px(6), 0, Math.PI * 2);
    ctx.fillStyle = hollow ? "rgba(0,0,0,0.35)" : color;
    ctx.fill();
    ctx.lineWidth = px(2);
    ctx.strokeStyle = hollow ? color : "#000";
    ctx.stroke();
    if (hollow) {
      ctx.beginPath();
      ctx.moveTo(p.x - px(10), p.y);
      ctx.lineTo(p.x + px(10), p.y);
      ctx.moveTo(p.x, p.y - px(10));
      ctx.lineTo(p.x, p.y + px(10));
      ctx.lineWidth = px(1);
      ctx.stroke();
    }
  };
  const seg = (a: Pt, b: Pt, color: string, width: number, dash?: number[]) => {
    ctx.beginPath();
    ctx.setLineDash(dash ? dash.map(px) : []);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = px(width);
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const arrow = (from: Pt, dir: Pt, len: number, color: string) => {
    const to = { x: from.x + dir.x * len, y: from.y + dir.y * len };
    seg(from, to, color, 3);
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - dir.x * px(14) - dir.y * px(8), to.y - dir.y * px(14) + dir.x * px(8));
    ctx.lineTo(to.x - dir.x * px(14) + dir.y * px(8), to.y - dir.y * px(14) - dir.x * px(8));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };

  // what the app found in this frame: each foot's long axis
  if (o.showApp && o.frame) {
    const sideOf = new Map<number, Side>();
    for (const s of ["left", "right"] as const) {
      const bi = o.result.frames[o.idx]?.[s]?.blobIndex;
      if (bi !== undefined && bi >= 0) sideOf.set(bi, s);
    }
    o.frame.blobs.forEach((b, i) => {
      const cx = b.cx * o.W;
      const cy = b.cy * o.H;
      const half = (b.length * o.H) / 2;
      const s = sideOf.get(i);
      const col = s ? COLORS[s] : "rgba(220,220,220,0.8)";
      seg({ x: cx - b.ux * half, y: cy - b.uy * half }, { x: cx + b.ux * half, y: cy + b.uy * half }, col, 2, [6, 4]);
      label(s ? `app ${s === "left" ? "L" : "R"}` : "app ?", cx + px(8), cy - half * 0.2, col);
    });
  }

  // walking direction: the app's, and the person's own line
  const origin = { x: o.W * 0.16, y: o.H * 0.1 }; // top left: the magnifier sits at the top right
  arrow(origin, o.fwdApp, o.H * 0.06, o.usingOwn ? "rgba(255,255,255,0.45)" : COLORS.app);
  label(o.usingOwn ? "app direction" : "walking direction (app)", origin.x + px(10), origin.y - px(4), "#fff");
  if (o.line) {
    seg(o.line.a, o.line.b, COLORS.own, 2.5);
    dot(o.line.a, COLORS.own, o.tool === "direction");
    dot(o.line.b, COLORS.own, o.tool === "direction");
    label(o.usingOwn ? "your direction (used)" : "your direction", Math.min(o.line.a.x, o.line.b.x) + px(8), (o.line.a.y + o.line.b.y) / 2, COLORS.own);
  }
  if (o.dirPending) {
    dot(o.dirPending, COLORS.own, true);
    if (o.hover) seg(o.dirPending, o.hover, COLORS.own, 2, [6, 4]);
  }

  // marks on this frame
  for (const m of o.marks) {
    if (m.idx !== o.idx) continue;
    const col = COLORS[m.side];
    const active = m.side === o.side;
    ctx.globalAlpha = active ? 1 : 0.6;
    seg(m.heel, m.toe, col, 2.5);
    dot(m.heel, col);
    dot(m.toe, col, true);
    label(`${m.side === "left" ? "L" : "R"} ${signed(markedAngleDeg(m.heel, m.toe, o.fwd, m.side))}`, m.toe.x + px(10), m.toe.y - px(4), col);
    ctx.globalAlpha = 1;
  }
  if (o.pending) {
    const col = COLORS[o.pending.side];
    dot(o.pending.heel, col);
    if (o.hover) {
      seg(o.pending.heel, o.hover, col, 2, [6, 4]);
      label(signed(markedAngleDeg(o.pending.heel, o.hover, o.fwd, o.pending.side)), o.hover.x + px(10), o.hover.y - px(4), col);
    }
  }
}

/**
 * The video frame with the marking tools on it: click the heel centre, then the point between the big toe and the next
 * toe. Every point can be dragged afterwards, and a magnifier follows the pointer. Points are kept in video pixels.
 */
export function MeasureStage(p: Props) {
  const { loaded, frames, idx } = p;
  const W = loaded.width;
  const H = loaded.height;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const token = useRef(0);
  const drag = useRef<Handle | null>(null);
  const [cssW, setCssW] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dirPending, setDirPending] = useState<Pt | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const [painted, setPainted] = useState(0);

  const pend = p.tool === "mark" && pending && pending.idx === idx && pending.side === p.side ? pending : null;
  const dirPend = p.tool === "direction" ? dirPending : null;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCssW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // size the canvas to the screen (a separate effect: resizing clears it, painting follows in the next one)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || cssW === 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(((cssW * H) / W) * dpr);
  }, [cssW, W, H]);

  const { fwd, fwdApp, usingOwn, marks, line, tool, side, showApp, result } = p;
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || cssW === 0 || !frames[idx]) return;
    const my = ++token.current;
    void (async () => {
      await seekTo(loaded.video, frames[idx].t);
      if (my !== token.current) return;
      paint(c, {
        W,
        H,
        dpr: window.devicePixelRatio || 1,
        video: loaded.video,
        frame: frames[idx],
        result,
        idx,
        fwdApp,
        fwd,
        usingOwn,
        marks,
        line,
        tool,
        side,
        showApp,
        pending: pend,
        dirPending: dirPend,
        hover,
      });
      setPainted((n) => n + 1);
    })();
  }, [cssW, loaded, frames, idx, W, H, result, fwdApp, fwd, usingOwn, marks, line, tool, side, showApp, pend, dirPend, hover]);

  // magnifier: the raw pixels around the pointer, four times larger
  useEffect(() => {
    const l = loupeRef.current;
    if (!l || !hover) return;
    const dpr = window.devicePixelRatio || 1;
    const s = Math.round(LOUPE_CSS_PX * dpr);
    l.width = s;
    l.height = s;
    const ctx = l.getContext("2d");
    if (!ctx) return;
    const R = W * 0.04;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, s, s);
    ctx.drawImage(loaded.video, hover.x - R, hover.y - R, 2 * R, 2 * R, 0, 0, s, s);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.moveTo(s / 2, 0);
    ctx.lineTo(s / 2, s);
    ctx.moveTo(0, s / 2);
    ctx.lineTo(s, s / 2);
    ctx.stroke();
  }, [hover, loaded, W, painted]);

  const toVideo = (e: ReactPointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const cssToVideo = () => (cssW > 0 ? W / cssW : 1);

  /** the point under a press, if any: marks on this frame while marking, the two ends of the direction line while drawing it */
  const handleAt = (pt: Pt): Handle | null => {
    const reach = GRAB_CSS_PX * cssToVideo();
    const candidates: Array<{ h: Handle; q: Pt }> = [];
    if (tool === "mark") {
      for (const m of marks) {
        if (m.idx !== idx) continue;
        candidates.push({ h: { kind: "heel", id: m.id }, q: m.heel }, { h: { kind: "toe", id: m.id }, q: m.toe });
      }
    } else if (line) {
      candidates.push({ h: { kind: "a" }, q: line.a }, { h: { kind: "b" }, q: line.b });
    }
    let found: Handle | null = null;
    let nearest = reach;
    for (const c of candidates) {
      const d = Math.hypot(c.q.x - pt.x, c.q.y - pt.y);
      if (d <= nearest) {
        nearest = d;
        found = c.h;
      }
    }
    return found;
  };

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const pt = toVideo(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    setHover(pt);
    const h = handleAt(pt);
    if (h) {
      drag.current = h;
      return;
    }
    const minSpan = MIN_SPAN_CSS_PX * cssToVideo();
    if (tool === "mark") {
      if (!pend) setPending({ idx, side, heel: pt });
      else if (Math.hypot(pt.x - pend.heel.x, pt.y - pend.heel.y) >= minSpan) {
        p.onAddMark({ side, idx, heel: pend.heel, toe: pt });
        setPending(null);
      }
    } else if (!dirPend) setDirPending(pt);
    else if (Math.hypot(pt.x - dirPend.x, pt.y - dirPend.y) >= minSpan) {
      p.onSetLine({ a: dirPend, b: pt });
      setDirPending(null);
      p.onToolDone();
    }
  };

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const pt = toVideo(e);
    setHover(pt);
    const d = drag.current;
    if (!d) return;
    if (d.kind === "heel" || d.kind === "toe") p.onMoveMark(d.id, d.kind, pt);
    else p.onMoveLine(d.kind, pt);
  };

  const onUp = () => {
    drag.current = null;
  };

  const hint =
    tool === "direction"
      ? dirPend
        ? "Now click a second point further along the same line."
        : "Click a point on a floor line (or any line that runs the way you walked), then a second point further along it."
      : pend
        ? "Now click the point between the big toe and the next toe."
        : `Click the heel centre of the ${side} foot.`;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={wrapRef}
        className="relative mx-auto overflow-hidden rounded-2xl border border-line bg-black"
        style={{ aspectRatio: `${W} / ${H}`, width: `min(100%, calc(72dvh * ${W / H}))` }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Video frame. Click to place the heel centre, then the point between the big toe and the next toe."
          className="absolute inset-0 h-full w-full cursor-crosshair"
          style={{ touchAction: "none" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => {
            if (!drag.current) setHover(null);
          }}
        />
        {hover && (
          <canvas
            ref={loupeRef}
            aria-hidden
            className="pointer-events-none absolute right-2 top-2 rounded-full border-2 border-white/80 shadow-lg"
            style={{ width: LOUPE_CSS_PX, height: LOUPE_CSS_PX }}
          />
        )}
      </div>
      <p className="text-center text-sm" aria-live="polite">
        <span className="font-semibold" style={{ color: tool === "direction" ? COLORS.own : COLORS[side] }}>
          {hint}
        </span>
      </p>
      {(pend || dirPend) && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            className="min-h-10 px-4 py-2 text-sm"
            onClick={() => {
              setPending(null);
              setDirPending(null);
            }}
          >
            Cancel this point
          </Button>
        </div>
      )}
    </div>
  );
}
