"use client";

import { useMemo, useSyncExternalStore } from "react";
import { parseCalibrationText, savedCalibrationText, subscribeCalibration, type Calibration } from "@/lib/calibration/settings";

/** The calibration saved on this device (null when none, and always null on the server / first paint, so hydration matches). */
export function useSavedCalibration(): Calibration | null {
  const text = useSyncExternalStore(subscribeCalibration, savedCalibrationText, () => null);
  return useMemo(() => parseCalibrationText(text), [text]);
}
