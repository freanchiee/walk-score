import { SENSOR_CONFIG } from "../config";

export interface Lighting {
  /** mean luminance 0-255 */
  mean: number;
  /** share of (sampled) pixels at or above 250 */
  clippedHigh: number;
  /** share of (sampled) pixels at or below 5 */
  clippedLow: number;
}

/** Mean luminance and clipped shares of an RGBA frame, sampling every `step`-th pixel (the check runs a few times a second). */
export function frameLighting(rgba: ArrayLike<number>, step = 3): Lighting {
  const n = Math.floor(rgba.length / 4);
  let sum = 0;
  let hi = 0;
  let lo = 0;
  let count = 0;
  for (let p = 0; p < n; p += step) {
    const i = p * 4;
    const y = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    sum += y;
    if (y >= 250) hi++;
    else if (y <= 5) lo++;
    count++;
  }
  return count ? { mean: sum / count, clippedHigh: hi / count, clippedLow: lo / count } : { mean: 0, clippedHigh: 0, clippedLow: 1 };
}

export type LightStatus = "ok" | "dark" | "bright" | "clipped";

/** "Light OK": not too dark, not too bright, and not heavily clipped (blown highlights, or large crushed shadows). */
export function lightStatus(l: Lighting, cfg: { minMean: number; maxMean: number; maxClippedShare: number } = SENSOR_CONFIG.light): LightStatus {
  if (l.mean < cfg.minMean) return "dark";
  if (l.mean > cfg.maxMean) return "bright";
  if (l.clippedHigh > cfg.maxClippedShare || l.clippedLow > cfg.maxClippedShare * 2) return "clipped";
  return "ok";
}

export const LIGHT_HINTS: Record<LightStatus, string> = {
  ok: "Light is fine",
  dark: "Too dark: turn a light on",
  bright: "Too bright: avoid glare",
  clipped: "Harsh light or shadows: use even light",
};
