"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../ui";
import type { Player } from "./usePlayer";

/**
 * Video (when there is one) with a canvas overlay that the caller draws, plus frame controls. The canvas always
 * matches the picture's aspect ratio so normalised landmark coordinates map straight onto it.
 */
export function PlayerPanel({
  width,
  height,
  url,
  n,
  tAt,
  player,
  draw,
  children,
}: {
  /** source video size (only its aspect ratio matters) */
  width: number;
  height: number;
  url: string | null;
  n: number;
  /** timestamp of frame i in seconds */
  tAt: (i: number) => number;
  player: Player;
  /** repaint the overlay; keep it memoised (useCallback) so it only reruns when its inputs change */
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, idx: number) => void;
  children?: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tick, setTick] = useState(0);
  const { idx, videoRef } = player;
  const aspect = width / height;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  // repaint once a seek has finished, so overlays that read the video frame see the right picture
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const on = () => setTick((t) => t + 1);
    v.addEventListener("seeked", on);
    return () => v.removeEventListener("seeked", on);
  }, [url, videoRef]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, size.w, size.h, idx);
  }, [draw, idx, size, tick]);

  return (
    <section aria-label="Player" className="flex flex-col gap-3">
      <div
        ref={wrapRef}
        className="relative mx-auto overflow-hidden rounded-2xl border border-line bg-black"
        style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, calc(68dvh * ${aspect}))` }}
      >
        {url && (
          <video
            ref={videoRef}
            src={url}
            muted
            playsInline
            preload="auto"
            aria-label="Analysed video"
            className="absolute inset-0 h-full w-full"
          />
        )}
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={() => player.seek(idx - 1)} aria-label="Previous frame">
          ◀
        </Button>
        <Button variant="secondary" onClick={player.togglePlay} aria-label={player.playing ? "Pause" : "Play"} className="min-w-20">
          {player.playing ? "Pause" : "Play"}
        </Button>
        <Button variant="secondary" onClick={() => player.seek(idx + 1)} aria-label="Next frame">
          ▶
        </Button>
        <span className="ml-2 text-xs tabular-nums text-muted">
          {Math.min(idx + 1, n)}/{n} · {n ? tAt(Math.min(idx, n - 1)).toFixed(2) : "0.00"}s
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(0, n - 1)}
        value={idx}
        onChange={(e) => player.seek(Number(e.target.value))}
        aria-label="Frame"
        className="w-full accent-[var(--accent)]"
      />
      {children}
    </section>
  );
}
