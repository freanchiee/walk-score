"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { loadVideo, seekTo, type LoadedVideo } from "@/lib/pose/video";
import { TOPDOWN_WORK_WIDTH } from "@/lib/topdown/extract";
import { learnFootSeed, type FootSeed, type SeedResult } from "@/lib/topdown/seed";
import { useHeadingFocus } from "./hooks";
import { Button, Disclaimer, PrivacyNote, ScreenShell } from "./ui";

interface Mark {
  /** the tap, normalised to the picture */
  tap: { x: number; y: number };
  result: SeedResult;
}

/** Start this far into the clip: the feet are usually in view and settled by then. */
const START_AT = 0.4;
const FRAME_STEP = 1 / 15;
const GREEN = "74, 222, 128";

function drawArrow(ctx: CanvasRenderingContext2D, from: [number, number], to: [number, number], unit: number) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const head = 13 * unit;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [color, extra] of [["rgba(0,0,0,0.55)", 2.5 * unit], ["#fff", 0]] as const) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3 * unit + extra;
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(to[0], to[1]);
    ctx.lineTo(to[0] - ux * head - uy * head * 0.6, to[1] - uy * head + ux * head * 0.6);
    ctx.lineTo(to[0] - ux * head + uy * head * 0.6, to[1] - uy * head - ux * head * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // a small tag at the toe end
  const tag = "toes";
  ctx.font = `700 ${12 * unit}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tx = to[0] + ux * 16 * unit;
  const ty = to[1] + uy * 16 * unit;
  const w = ctx.measureText(tag).width;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(tx - w / 2 - 4 * unit, ty - 9 * unit, w + 8 * unit, 18 * unit);
  ctx.fillStyle = "#fff";
  ctx.fillText(tag, tx, ty);
}

/** The video frame with what the tap found on it: the grown foot in green, an arrow along it toward the toes, a ring at the tap. */
function paintFrame(c: HTMLCanvasElement, video: HTMLVideoElement, mark: Mark | null, flipped: boolean) {
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(video, 0, 0, c.width, c.height);
  if (!mark) return;
  const unit = window.devicePixelRatio || 1;
  const r = mark.result;
  if (!("error" in r)) {
    const overlay = document.createElement("canvas");
    overlay.width = r.width;
    overlay.height = r.height;
    const octx = overlay.getContext("2d");
    if (octx) {
      const img = octx.createImageData(r.width, r.height);
      const [cr, cg, cb] = GREEN.split(",").map(Number);
      for (let i = 0; i < r.region.length; i++) {
        if (!r.region[i]) continue;
        img.data[4 * i] = cr;
        img.data[4 * i + 1] = cg;
        img.data[4 * i + 2] = cb;
        img.data[4 * i + 3] = 125;
      }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(overlay, 0, 0, c.width, c.height);
    }
    if (r.seed.toeDir) {
      const kx = c.width / r.width;
      const ky = c.height / r.height;
      const toe = flipped ? r.heel : r.toe;
      const heel = flipped ? r.toe : r.heel;
      drawArrow(ctx, [heel[0] * kx, heel[1] * ky], [toe[0] * kx, toe[1] * ky], unit);
    }
  }
  // the tap itself
  const cx = mark.tap.x * c.width;
  const cy = mark.tap.y * c.height;
  for (const [color, w] of [["rgba(0,0,0,0.6)", 4.5], ["#fff", 2]] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w * unit;
    ctx.beginPath();
    ctx.arc(cx, cy, 9 * unit, 0, Math.PI * 2);
    ctx.moveTo(cx - 14 * unit, cy);
    ctx.lineTo(cx + 14 * unit, cy);
    ctx.moveTo(cx, cy - 14 * unit);
    ctx.lineTo(cx, cy + 14 * unit);
    ctx.stroke();
  }
}

interface Props {
  /** the recorded or uploaded video */
  blob: Blob;
  durationHint?: number;
  /** set when the person comes here because a scan could not find their feet */
  reason?: string;
  /** the learned foot: toeDir already turned round when the person said the arrow pointed the wrong way */
  onConfirm: (seed: FootSeed) => void;
  onSkip: () => void;
  onBack: () => void;
}

/**
 * "Tap your foot": a frame of the video, and one tap on the gap between the big toe and the next toe. The tap teaches the feet
 * finder this person's foot (colour, size, which way the toes point; see lib/topdown/seed.ts). The found foot is shown at once, so a
 * tap on the wrong thing is seen and redone before anything is analysed. The frame is decoded on this device and never uploaded.
 */
export function MarkFoot({ blob, durationHint, reason, onConfirm, onSkip, onBack }: Props) {
  const h1 = useHeadingFocus();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const token = useRef(0);
  const ready = useRef(false);
  const pointerDown = useRef(false);
  const queued = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef(0);
  const [loaded, setLoaded] = useState<LoadedVideo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userTime, setUserTime] = useState<number | null>(null);
  const [cssW, setCssW] = useState(0);
  const [mark, setMark] = useState<Mark | null>(null);
  const [flipped, setFlipped] = useState(false);

  // decode the video on this device
  useEffect(() => {
    let alive = true;
    let got: LoadedVideo | null = null;
    loadVideo(blob, { durationHint })
      .then((l) => {
        if (!alive) {
          l.dispose();
          return;
        }
        got = l;
        setLoaded(l);
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(err instanceof Error ? err.message : "This video could not be read.");
      });
    return () => {
      alive = false;
      cancelAnimationFrame(raf.current);
      got?.dispose();
    };
  }, [blob, durationHint]);

  const duration = loaded?.duration ?? 0;
  const lastT = Math.max(0, duration - 0.1);
  const time = loaded ? Math.min(userTime ?? duration * START_AT, lastT) : 0;
  const W = loaded?.width ?? 9;
  const H = loaded?.height ?? 16;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCssW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);

  // size the canvas to the screen (a separate effect: resizing clears it, painting follows in the next one)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || cssW === 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(((cssW * H) / W) * dpr);
  }, [cssW, W, H]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !loaded || cssW === 0) return;
    const my = ++token.current;
    ready.current = false;
    void (async () => {
      await seekTo(loaded.video, time);
      if (my !== token.current) return;
      paintFrame(c, loaded.video, mark, flipped);
      ready.current = true;
    })();
  }, [loaded, cssW, time, mark, flipped]);

  /** learn the foot under a tap on the frame that is on screen */
  const place = (tap: { x: number; y: number }) => {
    if (!loaded || !ready.current) return;
    const workW = TOPDOWN_WORK_WIDTH;
    const workH = Math.max(2, Math.round((workW * loaded.height) / loaded.width));
    const work = workRef.current ?? (workRef.current = document.createElement("canvas"));
    work.width = workW;
    work.height = workH;
    const ctx = work.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(loaded.video, 0, 0, workW, workH);
    const { data } = ctx.getImageData(0, 0, workW, workH);
    const result = learnFootSeed(data, workW, workH, { x: tap.x * workW, y: tap.y * workH }, time);
    setFlipped(false);
    setMark({ tap, result });
  };

  /** while the finger drags, at most one foot search per screen refresh */
  const placeSoon = (tap: { x: number; y: number }) => {
    queued.current = tap;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const next = queued.current;
      queued.current = null;
      if (next) place(next);
    });
  };

  const toPicture = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const step = e.shiftKey ? 0.04 : 0.01;
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const from = mark?.tap ?? { x: 0.5, y: 0.5 };
    if (move[e.key]) {
      e.preventDefault();
      const [dx, dy] = move[e.key];
      place({ x: Math.min(1, Math.max(0, from.x + dx)), y: Math.min(1, Math.max(0, from.y + dy)) });
    } else if ((e.key === "Enter" || e.key === " ") && !mark) {
      e.preventDefault();
      place(from);
    }
  };

  const found = mark && !("error" in mark.result) ? mark.result : null;
  const seed = found?.seed ?? null;
  const confirm = () => {
    if (!seed) return;
    onConfirm(flipped && seed.toeDir ? { ...seed, toeDir: [-seed.toeDir[0], -seed.toeDir[1]] } : seed);
  };

  const status = loadError
    ? loadError
    : !loaded
      ? "Opening your video…"
      : !mark
        ? "Tap the gap between your big toe and the next toe."
        : "error" in mark.result
          ? mark.result.error
          : seed?.toeDir
            ? "Found your foot (green). The arrow points to your toes. Wrong way? Use the button below."
            : "Found your foot (green). Tapping closer to the toes also tells the app which way you face.";
  const isError = Boolean(loadError) || Boolean(mark && "error" in mark.result);

  return (
    <ScreenShell>
      <h1 ref={h1} tabIndex={-1} className="text-3xl font-extrabold leading-tight">
        Tap your foot
      </h1>
      <p className="text-muted">
        Pick a frame where one foot is flat on the floor and tap the gap between the big toe and the next toe. It shows the app
        what your foot looks like, which can help with socks, skin tone or light.
      </p>
      {reason && (
        <p role="status" className="rounded-2xl border border-warn/40 px-4 py-3 text-sm text-warn">
          {reason}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <div
          ref={wrapRef}
          className="relative mx-auto w-full overflow-hidden rounded-2xl border border-line bg-black"
          style={{ aspectRatio: `${W} / ${H}`, maxWidth: `calc(44dvh * ${W / H})` }}
        >
          <canvas
            ref={canvasRef}
            tabIndex={loaded ? 0 : -1}
            role="img"
            aria-label="A frame of your video. Tap the gap between your big toe and the next toe. With the keyboard, press Enter to put the marker in the middle, then move it with the arrow keys."
            className="absolute inset-0 h-full w-full cursor-crosshair touch-none outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pointerDown.current = true;
              place(toPicture(e));
            }}
            onPointerMove={(e) => {
              if (pointerDown.current) placeSoon(toPicture(e));
            }}
            onPointerUp={() => {
              pointerDown.current = false;
            }}
            onPointerCancel={() => {
              pointerDown.current = false;
            }}
            onKeyDown={onKeyDown}
          />
        </div>

        {loaded && (
          <label className="flex flex-col gap-1 text-sm text-muted">
            <span className="flex justify-between">
              <span>Pick another frame</span>
              <span className="tabular-nums">
                {time.toFixed(1)} s of {duration.toFixed(1)} s
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={lastT}
              step={FRAME_STEP}
              value={time}
              aria-label="Frame of your video"
              className="w-full accent-[var(--accent)]"
              onChange={(e) => {
                setUserTime(Number(e.target.value));
                setMark(null);
                setFlipped(false);
              }}
            />
          </label>
        )}

      </div>

      {/* pinned to the bottom of the screen with what the tap found, so the answer and "Use this point" are in reach together */}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-line bg-bg/90 px-4 pb-3 pt-3 backdrop-blur">
        <p
          role={isError ? "alert" : "status"}
          aria-live="polite"
          className={`flex min-h-10 items-center justify-center text-center text-sm font-semibold leading-snug ${isError ? "text-danger" : "text-ink"}`}
        >
          {status}
        </p>
        <Button onClick={confirm} disabled={!seed} className="w-full py-3 text-lg">
          Use this point
        </Button>
        <div className={`grid gap-2 ${seed?.toeDir ? "grid-cols-3" : "grid-cols-2"}`}>
          {seed?.toeDir && (
            <Button
              variant={flipped ? "secondary" : "ghost"}
              onClick={() => setFlipped((f) => !f)}
              aria-pressed={flipped}
              className="min-h-11 px-1 py-2 text-xs leading-tight"
            >
              Toes point the other way
            </Button>
          )}
          <Button variant="ghost" onClick={onSkip} className="min-h-11 px-1 py-2 text-xs leading-tight">
            Skip this step
          </Button>
          <Button variant="ghost" onClick={onBack} className="min-h-11 px-1 py-2 text-xs leading-tight">
            Record again
          </Button>
        </div>
      </div>
      <PrivacyNote />
      <Disclaimer />
    </ScreenShell>
  );
}
