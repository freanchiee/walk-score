"use client";

import { useEffect, useRef, useState } from "react";

/** Moves focus to the screen heading when a screen mounts, so keyboard / screen-reader users land on it. */
export function useHeadingFocus<T extends HTMLElement = HTMLHeadingElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Counts from 0 to `target` for a little reveal; jumps straight there with reduced motion. */
export function useCountUp(target: number, durationMs = 1100): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const reduce = prefersReducedMotion();
    const start = performance.now();
    const tick = (now: number) => {
      const p = reduce ? 1 : Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}
