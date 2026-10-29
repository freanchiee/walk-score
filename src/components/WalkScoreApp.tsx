"use client";

import { useCallback, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { scanVideo } from "@/lib/pipeline";
import type { ExtractProgress } from "@/lib/pose/landmarker";
import { computeScore, type ScoreResult } from "@/lib/scoring/score";
import type { CaptureInfo } from "@/lib/sensors/capture";
import { mergeQuality } from "@/lib/sensors/quality";
import { Analyzing } from "./Analyzing";
import { Capture, type VideoSource } from "./Capture";
import { ErrorScreen } from "./ErrorScreen";
import { Landing } from "./Landing";
import { ResultScreen } from "./ResultScreen";

type Screen =
  | { name: "landing" }
  | { name: "capture" }
  | { name: "analyzing"; progress: ExtractProgress }
  | { name: "result"; score: ScoreResult }
  | { name: "error"; message: string; detail?: string };

export function WalkScoreApp() {
  const [screen, setScreen] = useState<Screen>({ name: "landing" });
  const scoresShown = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const startScan = useCallback(() => {
    trackEvent({ name: "scan_started" });
    if (scoresShown.current > 0) trackEvent({ name: "second_scan" });
    setScreen({ name: "capture" });
  }, []);

  const handleVideo = useCallback(async (blob: Blob, source: VideoSource, durationHint?: number, capture?: CaptureInfo) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setScreen({ name: "analyzing", progress: { stage: "Starting…", done: 0, total: 1 } });
    try {
      const analysis = await scanVideo(blob, {
        durationHint,
        capture,
        signal: ctrl.signal,
        onProgress: (progress) => setScreen((s) => (s.name === "analyzing" ? { name: "analyzing", progress } : s)),
      });
      if (!analysis.ok || analysis.leftDeg === null || analysis.rightDeg === null) {
        setScreen({
          name: "error",
          message: analysis.failure?.message ?? "We couldn't measure your steps in that video.",
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
      trackEvent({ name: "score_shown", props: { label: score.label.id, quality: score.quality, source } });
      setScreen({ name: "result", score });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setScreen({ name: "capture" });
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

  switch (screen.name) {
    case "landing":
      return <Landing onStart={startScan} />;
    case "capture":
      return <Capture onVideo={handleVideo} onBack={() => setScreen({ name: "landing" })} />;
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
    case "error":
      return (
        <ErrorScreen
          message={screen.message}
          detail={screen.detail}
          onRetry={startScan}
          onBack={() => setScreen({ name: "landing" })}
        />
      );
  }
}
