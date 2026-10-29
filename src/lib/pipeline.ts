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
import { analyzeTopDown } from "./topdown/analyze";
import { extractFeet } from "./topdown/extract";
import { floorFlowHeading } from "./topdown/floorflow";

export interface ScanOptions {
  mode?: CaptureMode;
  /** top-down only: the calibration to apply (default: the one saved on this device, else the shipped one) */
  calibration?: Calibration;
  /**
   * top-down only: what the capture screen recorded about the phone while filming (tilt, steps, steadiness). Without it
   * (an uploaded video) the tilt cannot be checked and the scan is marked low confidence.
   */
  capture?: CaptureInfo | null;
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
    const ex = await extractFeet(blob, { ...opts, flow: flags.floorFlow });
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
    });

    const report = buildReport({
      capture: cap,
      frames,
      flags,
      tiltCorrected,
      floorFlow: flags.floorFlow ? floorFlowHeading(ex.frames) : undefined,
    });
    result.capture = report;
    const rejection = rejectionFor(report, result, flags);
    if (rejection) {
      result.ok = false;
      result.failure = rejection;
    }
    setLastCapture({ info: cap, report, failure: rejection?.message ?? null, at: performance.now() });
    return result;
  }
  const ex = await extractLandmarks(blob, opts);
  return analyze(ex.frames, ex.video);
}
