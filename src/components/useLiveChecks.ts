"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { frameLighting, lightStatus, type LightStatus } from "@/lib/capture/lighting";
import { SENSOR_CONFIG } from "@/lib/config";
import { segmentFeet } from "@/lib/topdown/segment";

export interface LiveChecks {
  /** both feet found in the preview / one / none; null before the first check */
  feet: "both" | "one" | "none" | null;
  light: LightStatus | null;
  lightMean: number | null;
}

export interface LiveShares {
  lightOkShare: number | null;
  feetShare: number | null;
}

const WORK_WIDTH = 160;
/** a check passes when most of the last few looks agree, so one odd frame does not flicker the chip */
const WINDOW = 3;

/**
 * Looks at the camera preview a few times a second: are both feet in view (the same colour/shape feet finder the
 * analysis uses, on a small picture), and is the light fine (mean luminance and clipping)? Between begin() and end()
 * it also keeps the share of looks that passed, for the capture quality score.
 */
export function useLiveChecks(videoRef: RefObject<HTMLVideoElement | null>, active: boolean): { checks: LiveChecks; begin: () => void; end: () => LiveShares } {
  const [checks, setChecks] = useState<LiveChecks>({ feet: null, light: null, lightMean: null });
  const recent = useRef<Array<{ feet: number; light: LightStatus }>>([]);
  const tally = useRef({ on: false, looks: 0, lightOk: 0, feetOk: 0 });
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;
      const w = WORK_WIDTH;
      const h = Math.max(2, Math.round((w * v.videoHeight) / v.videoWidth));
      let c = canvas.current;
      if (!c) c = canvas.current = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const lighting = frameLighting(data);
      const light = lightStatus(lighting);
      const feet = segmentFeet(data, w, h).blobs.filter((b) => b.score >= 0.45 && !b.clipped).length;
      const r = recent.current;
      r.push({ feet, light });
      if (r.length > WINDOW) r.shift();
      if (tally.current.on) {
        tally.current.looks++;
        if (light === "ok") tally.current.lightOk++;
        if (feet >= 2) tally.current.feetOk++;
      }
      const most = (pass: (x: { feet: number; light: LightStatus }) => boolean) => r.filter(pass).length * 2 > r.length;
      const lastBad = [...r].reverse().find((x) => x.light !== "ok")?.light;
      setChecks({
        feet: most((x) => x.feet >= 2) ? "both" : most((x) => x.feet >= 1) ? "one" : "none",
        light: most((x) => x.light === "ok") ? "ok" : (lastBad ?? "ok"),
        lightMean: lighting.mean,
      });
    };
    const id = window.setInterval(tick, SENSOR_CONFIG.liveCheckMs);
    return () => window.clearInterval(id);
  }, [active, videoRef]);

  const begin = useCallback(() => {
    tally.current = { on: true, looks: 0, lightOk: 0, feetOk: 0 };
  }, []);
  const end = useCallback((): LiveShares => {
    const t = tally.current;
    t.on = false;
    return t.looks ? { lightOkShare: t.lightOk / t.looks, feetShare: t.feetOk / t.looks } : { lightOkShare: null, feetShare: null };
  }, []);

  return { checks, begin, end };
}
