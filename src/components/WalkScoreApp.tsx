"use client";

import { useCallback, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { CAPTURE_MODE, MARK_STEP } from "@/lib/config";
import { scanVideo } from "@/lib/pipeline";
import type { ExtractProgress } from "@/lib/pose/landmarker";
import { computeScore, type ScoreResult } from "@/lib/scoring/score";
import type { CaptureInfo } from "@/lib/sensors/capture";
import { mergeQuality } from "@/lib/sensors/quality";
import { TAP_CAN_HELP, type FootSeed } from "@/lib/topdown/seed";
import { Analyzing } from "./Analyzing";
import { Capture, type VideoSource } from "./Capture";
import { ErrorScreen } from "./ErrorScreen";
import { Landing } from "./Landing";
import { MarkFoot } from "./MarkFoot";
import { ResultScreen } from "./ResultScreen";

/** A recorded or uploaded video, kept in memory while the person taps their foot and until the scan is read. Never uploaded. */
interface Clip {
  blob: Blob;
  source: VideoSource;
  durationHint?: number;
  capture?: CaptureInfo;
}

type Screen =
  | { name: "landing" }
  | { name: "capture" }
  | { name: "mark"; clip: Clip; reason?: string }
  | { name: "analyzing"; progress: ExtractProgress }
  | { name: "result"; score: ScoreResult }
  /** `retryClip` is set when tapping a foot in the same video could help (the feet were not found) */
  | { name: "error"; message: string; detail?: string; retryClip?: Clip };

/** The tap on the foot belongs to the top-down view; the front view reads a pose model instead. */
const TAP_ENABLED = CAPTURE_MODE === "topdown" && MARK_STEP !== "off";

export function WalkScoreApp() {
  const [screen, setScreen] = useState<Screen>({ name: "landing" });
  const scoresShown = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const startScan = useCallback(() => {
    trackEvent({ name: "scan_started" });
    if (scoresShown.current > 0) trackEvent({ name: "second_scan" });
    setScreen({ name: "capture" });
  }, []);

  const analyse = useCallback(async (clip: Clip, seed: FootSeed | null) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setScreen({ name: "analyzing", progress: { stage: "Starting…", done: 0, total: 1 } });
    try {
      const analysis = await scanVideo(clip.blob, {
        durationHint: clip.durationHint,
        capture: clip.capture,
        seed,
        signal: ctrl.signal,
        onProgress: (progress) => setScreen((s) => (s.name === "analyzing" ? { name: "analyzing", progress } : s)),
      });
      if (!analysis.ok || analysis.leftDeg === null || analysis.rightDeg === null) {
        const code = analysis.failure?.code;
        setScreen({
          name: "error",
          message: analysis.failure?.message ?? "We couldn't measure your steps in that video.",
          retryClip: TAP_ENABLED && code && TAP_CAN_HELP.has(code) ? clip : undefined,
        });
        return;
      }
      // the badge is the worse of what the analysis found and what the phone's sensors could vouch for
      const cq = analysis.capture?.quality;
      const score = computeScore({
        leftDeg: analysis.leftDeg,
        rightDeg: analysis.rightDeg,
        leftSteps: analysis.leftSteps,
        rightSteps: analysis.rightSteps,
        quality: mergeQuality(analysis.quality, cq),
        standing: analysis.standing,
        lowConfidence: cq?.lowConfidence,
        captureNote: cq && !cq.lowConfidence && cq.category !== "good" ? cq.reasons[0] : undefined,
      });
      scoresShown.current += 1;
      trackEvent({ name: "score_shown", props: { label: score.label.id, quality: score.quality, source: clip.source } });
      setScreen({ name: "result", score });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // cancelled: back to the tap screen when there is one (same video), else to the camera
        setScreen(TAP_ENABLED ? { name: "mark", clip } : { name: "capture" });
        return;
      }
      const detail = err instanceof Error ? err.message : String(err);
      setScreen({
        name: "error",
        message: "Something went wrong while reading the video on this device.",
        detail,
      });
    } finally {
      abortRef.current = null;
    }
  }, []);

  const handleVideo = useCallback(
    (blob: Blob, source: VideoSource, durationHint?: number, capture?: CaptureInfo) => {
      const clip: Clip = { blob, source, durationHint, capture };
      // a foot tapped on the live preview is used as it is: no need to ask for a second tap
      const liveSeed = capture?.seed ?? null;
      if (TAP_ENABLED && MARK_STEP === "always" && !liveSeed) setScreen({ name: "mark", clip });
      else void analyse(clip, liveSeed);
    },
    [analyse],
  );

  switch (screen.name) {
    case "landing":
      return <Landing onStart={startScan} />;
    case "capture":
      return <Capture footTap={TAP_ENABLED} onVideo={handleVideo} onBack={() => setScreen({ name: "landing" })} />;
    case "mark": {
      const clip = screen.clip;
      return (
        <MarkFoot
          blob={clip.blob}
          durationHint={clip.durationHint}
          reason={screen.reason}
          onConfirm={(seed) => void analyse(clip, seed)}
          onSkip={() => void analyse(clip, null)}
          onBack={() => setScreen({ name: "capture" })}
        />
      );
    }
    case "analyzing":
      return <Analyzing progress={screen.progress} onCancel={() => abortRef.current?.abort()} />;
    case "result":
      return (
        <ResultScreen
          score={screen.score}
          onShareClick={(method) => trackEvent({ name: "share_clicked", props: { method } })}
          onScanAgain={startScan}
        />
      );
    case "error": {
      const retryClip = screen.retryClip;
      return (
        <ErrorScreen
          message={screen.message}
          detail={screen.detail}
          onRetry={startScan}
          onBack={() => setScreen({ name: "landing" })}
          onMark={retryClip ? () => setScreen({ name: "mark", clip: retryClip, reason: "We couldn't find your feet last time. Tapping one foot can help." }) : undefined}
        />
      );
    }
  }
}
