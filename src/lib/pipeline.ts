import { analyze } from "./analysis/analyze";
import type { AnalysisResult } from "./analysis/types";
import { calibrationOptions, loadCalibration, type Calibration } from "./calibration/settings";
import { CAPTURE_MODE, SENSOR_CONFIG, type CaptureMode } from "./config";
import { experimentFlags } from "./flags";
import { extractLandmarks, type ExtractProgress } from "./pose/landmarker";
import type { CaptureInfo } from "./sensors/capture";
import { annotateFrames, buildReport, rejectionFor, sensorTimeMs, stepTimesSec } from "./sensors/gate";
import { setLastCapture } from "./sensors/lastCapture";
import { correctFramesForTilt } from "./sensors/tiltCorrection";
import { analyzeTopDown, bothFeetShare, cardinalDirection } from "./topdown/analyze";
import { extractFeet } from "./topdown/extract";
import { floorFlowHeading } from "./topdown/floorflow";
import { seedSummary, seedWarnings, type FootSeed } from "./topdown/seed";

export interface ScanOptions {
  mode?: CaptureMode;
  /** top-down only: the calibration to apply (default: the one saved on this device, else the shipped one) */
  calibration?: Calibration;
  /**
   * top-down only: what the capture screen recorded about the phone while filming (tilt, steps, steadiness). Without it
   * (an uploaded video) the tilt cannot be checked and the scan is marked low confidence.
   */
  capture?: CaptureInfo | null;
  /**
   * top-down only: what the person's tap on a toe gap taught the feet finder (see MarkFoot / topdown/seed.ts): their foot's
   * colour replaces the generic skin test. null or absent = the generic finder.
   */
  seed?: FootSeed | null;
  /** MediaRecorder duration, for containers that do not store one */
  durationHint?: number;
  onProgress?: (p: ExtractProgress) => void;
  signal?: AbortSignal;
}

/** Video blob -> analysis, entirely on this device, using the pipeline of the configured capture mode. */
export async function scanVideo(blob: Blob, opts: ScanOptions = {}): Promise<AnalysisResult> {
  const mode = opts.mode ?? CAPTURE_MODE;
  if (mode === "topdown") {
    const flags = experimentFlags();
    const seed = opts.seed ?? null;
    const ex = await extractFeet(blob, { ...opts, seed, flow: flags.floorFlow });
    const cap = opts.capture ?? null;

    // line the sensor log up with the frames: tilted frames stay out of the angle averaging
    let frames = annotateFrames(ex.frames, cap);
    let tiltCorrected = false;
    const log = cap?.sensors?.log;
    if (flags.tiltCorrection && cap && log && log.orientation.length) {
      frames = correctFramesForTilt(frames, ex.video, (t) => log.betaGammaAt(sensorTimeMs(cap, t)), SENSOR_CONFIG.fovLongSideDeg);
      tiltCorrected = true;
    }

    const result = analyzeTopDown(frames, ex.video, {
      ...calibrationOptions(opts.calibration ?? loadCalibration()),
      stepTimesSec: cap?.sensors ? stepTimesSec(cap, ex.video.duration) : null,
      seedToeDir: seed?.toeDir ?? null,
    });
    if (seed) {
      result.seed = seedSummary(seed, ex.meta, result.heading, cardinalDirection(seed.toeDir));
      result.warnings.push(...seedWarnings(result.seed));
    }

    const report = buildReport({
      capture: cap,
      frames,
      flags,
      tiltCorrected,
      floorFlow: flags.floorFlow ? floorFlowHeading(ex.frames) : undefined,
      // the live "Feet visible" check cannot see socks; once the person has tapped a foot, count what the scan itself found
      feetShare: seed ? bothFeetShare(frames) : undefined,
    });
    result.capture = report;
    const rejection = rejectionFor(report, result, flags);
    if (rejection) {
      result.ok = false;
      result.failure = rejection;
    }
    setLastCapture({ info: cap, report, failure: rejection?.message ?? null, seed: result.seed ?? null, at: performance.now() });
    return result;
  }
  const ex = await extractLandmarks(blob, opts);
  return analyze(ex.frames, ex.video);
}
