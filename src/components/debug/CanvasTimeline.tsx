"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisResult } from "@/lib/analysis/types";
import { drawTimeline } from "./overlay";

const HEIGHT = 96;

export function CanvasTimeline({
  result,
  n,
  idx,
  onSeek,
}: {
  result: AnalysisResult | null;
  n: number;
  idx: number;
  onSeek: (index: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(100, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(HEIGHT * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTimeline(ctx, width, HEIGHT, result, n, idx);
  }, [width, result, n, idx]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="Timeline of detected stance phases for the left and right foot. Click to jump to a frame."
      className="w-full cursor-pointer rounded-lg"
      style={{ height: HEIGHT }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(Math.floor(((e.clientX - r.left) / r.width) * n));
      }}
    />
  );
}
