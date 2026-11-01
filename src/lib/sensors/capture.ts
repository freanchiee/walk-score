import type { FootSeed } from "../topdown/seed";
import type { SensorLog } from "./log";
import type { CaptureQuality } from "./quality";
import type { SensorStatus } from "./types";
import type { YawReport } from "./yaw";

/**
 * What the capture screen hands to the analysis besides the video. Everything here lives in memory only: it is
 * never uploaded and never written to storage.
 */
export interface CaptureInfo {
  /** null when the capture had no sensor data at all (uploaded video, sensors unavailable or denied) */
  sensors: {
    status: SensorStatus;
    log: SensorLog;
    /** accelerometer step times, ms on the performance.now() clock */
    stepTimesMs: number[];
    hasOrientation: boolean;
    hasMotion: boolean;
  } | null;
  /** performance.now() when the recording started and stopped (the video clock starts at recStartMs) */
  recStartMs: number;
  recEndMs: number;
  /** recording was started with "Start anyway" before the live checks were all green */
  forcedStart: boolean;
  /** share of the live checks (taken while recording) that passed */
  live: { lightOkShare: number | null; feetShare: number | null };
  /** label of the camera that was used, when the browser told us */
  lens: string | null;
  /**
   * The foot the person tapped on the live preview before recording (lib/topdown/seed.ts), when they did. It makes the live
   * Feet visible check see socks and is then used for the analysis too, so the tap screen after recording is skipped.
   */
  seed?: FootSeed | null;
}

/** The gating report attached to every analysis of a camera capture. */
export interface CaptureReport {
  sensors: "ok" | "partial" | "unavailable";
  /** the sensors could not vouch for this capture: always shown as a rough read */
  lowConfidence: boolean;
  /** accelerometer steps; null = not counted */
  steps: number | null;
  tilt: { medianDeg: number | null; p90Deg: number | null; overShare: number | null };
  /** share of frames whose tilt was within the limit (frames without a tilt reading count as reliable) */
  reliableShare: number | null;
  rotationRmsDegPerSec: number | null;
  light: { okShare: number | null };
  feet: { share: number | null };
  /** experimental: how far the phone turned about the vertical (status "off" unless the yaw check is switched on) */
  yaw: { status: "off" | YawReport["status"]; maxAbsDeg: number | null; swayRmsDeg: number | null };
  forcedStart: boolean;
  /** the experimental tilt correction was applied to the feet before measuring */
  tiltCorrected: boolean;
  lens: string | null;
  quality: CaptureQuality;
  /** experimental: walking direction from the floor texture's optical flow (when switched on) */
  floorFlow?: { psiDeg: number; confidence: number; samples: number } | null;
}
