/**
 * The calibration the app applies to every scan: a per-foot offset (the app reads the principal axis of the foot
 * silhouette, the hand measurement is heel centre -> toe gap) and how the walking direction is found.
 *
 * It is stored on THIS device (localStorage). To ship one to everybody, paste the values the calibration page prints
 * into DEFAULT_CALIBRATION in src/lib/config.ts.
 */
import { DEFAULT_CALIBRATION } from "../config";
import type { TopDownOptions } from "../topdown/analyze";
import { MAX_OFFSET_DEG } from "./fit";

export type HeadingMethod = "balanced" | "single" | "hybrid";

export const HEADING_METHODS: Record<HeadingMethod, { label: string; description: string; options: Partial<TopDownOptions> }> = {
  balanced: {
    label: "Balanced (default)",
    description: "Walking direction = the average of the left and right foot's ground-flow clusters.",
    options: { balanceFeet: true, headingBlend: 0 },
  },
  single: {
    label: "Single cluster",
    description: "Walking direction = the densest ground-flow cluster (the old default).",
    options: { balanceFeet: false, headingBlend: 0 },
  },
  hybrid: {
    label: "Hybrid",
    description: "Half from each stance's own foot motion: cancels phone yaw sway, but trusts a few frames.",
    options: { balanceFeet: true, headingBlend: 0.5 },
  },
};

export interface Calibration {
  version: 1;
  /** degrees added to every left / right reading (toe-out positive) */
  leftOffsetDeg: number;
  rightOffsetDeg: number;
  method: HeadingMethod;
  /** where the numbers came from, shown on the page */
  basedOn?: { clips: number; marks: number };
  /** ISO time it was saved on this device */
  savedAt?: string;
}

export const NO_CALIBRATION: Calibration = { version: 1, leftOffsetDeg: 0, rightOffsetDeg: 0, method: "balanced" };

const STORAGE_KEY = "walkscore.calibration.v1";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clampOffset = (v: number) => Math.max(-MAX_OFFSET_DEG, Math.min(MAX_OFFSET_DEG, v));

/** Validates anything read from storage or typed in: unknown shapes give null, numbers are clamped. */
export function parseCalibration(raw: unknown): Calibration | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const left = num(r.leftOffsetDeg);
  const right = num(r.rightOffsetDeg);
  const method = r.method;
  if (left === null || right === null) return null;
  if (method !== "balanced" && method !== "single" && method !== "hybrid") return null;
  const out: Calibration = { version: 1, leftOffsetDeg: clampOffset(left), rightOffsetDeg: clampOffset(right), method };
  const b = r.basedOn as Record<string, unknown> | undefined;
  if (b && num(b.clips) !== null && num(b.marks) !== null) out.basedOn = { clips: num(b.clips) as number, marks: num(b.marks) as number };
  if (typeof r.savedAt === "string") out.savedAt = r.savedAt;
  return out;
}

/** The calibration shipped with the app (config.ts), as a full Calibration. */
export function shippedCalibration(): Calibration {
  return parseCalibration({ ...DEFAULT_CALIBRATION, version: 1 }) ?? NO_CALIBRATION;
}

/** What the scan flow uses: the one saved on this device, else the shipped one. */
export function loadCalibration(): Calibration {
  return loadSavedCalibration() ?? shippedCalibration();
}

/** The calibration saved on this device, or null. Never throws (storage can be blocked or empty). */
export function loadSavedCalibration(): Calibration | null {
  return parseCalibrationText(savedCalibrationText());
}

/** Returns false when the browser would not store it (private window, blocked site data). */
export function saveCalibration(c: Calibration): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...c, savedAt: c.savedAt ?? new Date().toISOString() }));
    emit();
    return true;
  } catch {
    return false;
  }
}

export function clearCalibration(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    emit();
  } catch {
    /* nothing to clear */
  }
}

// ---- change notifications, so a page can show the saved calibration without polling ------------------

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Calls `cb` whenever the saved calibration changes (here, or in another tab). Returns the unsubscribe function. */
export function subscribeCalibration(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) cb();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** The stored text itself (a stable snapshot for useSyncExternalStore), or null. */
export function savedCalibrationText(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function parseCalibrationText(text: string | null): Calibration | null {
  if (!text) return null;
  try {
    return parseCalibration(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The analysis options a calibration stands for. */
export function calibrationOptions(c: Calibration): Partial<TopDownOptions> {
  return { ...HEADING_METHODS[c.method].options, angleOffsetLeftDeg: c.leftOffsetDeg, angleOffsetRightDeg: c.rightOffsetDeg };
}

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}°`;

export function describeCalibration(c: Calibration): string {
  return `left ${signed(c.leftOffsetDeg)}, right ${signed(c.rightOffsetDeg)} · ${HEADING_METHODS[c.method].label.toLowerCase()}`;
}

/** The line to paste into src/lib/config.ts to ship this calibration to every user. */
export function configSnippet(c: Calibration): string {
  return `export const DEFAULT_CALIBRATION = { leftOffsetDeg: ${c.leftOffsetDeg.toFixed(1)}, rightOffsetDeg: ${c.rightOffsetDeg.toFixed(1)}, method: "${c.method}" } as const;`;
}
