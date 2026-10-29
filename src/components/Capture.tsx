"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LIGHT_HINTS } from "@/lib/capture/lighting";
import { CAPTURE_CONFIG, CAPTURE_MODE, SENSOR_CONFIG } from "@/lib/config";
import { copy } from "@/lib/modeCopy";
import {
  cameraLabel,
  canRecord,
  openCamera,
  recordStream,
  stopStream,
  type ActiveRecording,
  type CameraFacing,
} from "@/lib/pose/recorder";
import type { CaptureInfo } from "@/lib/sensors/capture";
import { tiltClass } from "@/lib/sensors/tilt";
import { ChipRow, LevelBubble, RecordRing, type Chip } from "./CaptureHud";
import { FootGuideOverlay } from "./FootGuideOverlay";
import { useHeadingFocus } from "./hooks";
import { CameraIcon, SwitchCameraIcon, UploadIcon } from "./icons";
import { Button, Disclaimer, PrivacyNote, ScreenShell } from "./ui";
import { useDeviceSensors } from "./useDeviceSensors";
import { useLiveChecks } from "./useLiveChecks";

export type VideoSource = "camera" | "upload";

type CamState = "idle" | "starting" | "ready" | "countdown" | "recording";

function cameraErrorMessage(err: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "The camera only works on a secure (https) page. You can upload a video instead.";
  }
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was blocked. Allow it in your browser settings, or upload a video instead.";
  }
  if (name === "NotFoundError") return "No camera was found. You can upload a video instead.";
  if (name === "NotReadableError") return "The camera is busy in another app. Close it and try again, or upload a video.";
  return "We couldn't start the camera. You can upload a video instead.";
}

const fmt = (v: number | null, digits = 1) => (v === null || !Number.isFinite(v) ? "–" : v.toFixed(digits));

export function Capture({
  onVideo,
  onBack,
}: {
  onVideo: (blob: Blob, source: VideoSource, durationHint?: number, capture?: CaptureInfo) => void;
  onBack: () => void;
}) {
  const h1 = useHeadingFocus();
  const [mode, setMode] = useState<"choose" | "camera">("choose");
  const [cam, setCam] = useState<CamState>("idle");
  const [facing, setFacing] = useState<CameraFacing>("environment");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number>(CAPTURE_CONFIG.countdownSec);
  const [elapsed, setElapsed] = useState(0);
  /** the countdown is holding because a check is not green */
  const [holding, setHolding] = useState(false);
  const [canForce, setCanForce] = useState(false);
  const [recordingSupported] = useState(() => canRecord());

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<ActiveRecording | null>(null);
  const timersRef = useRef<number[]>([]);
  const countdownRef = useRef({ remainingMs: 0, waitedMs: 0 });
  const allGreenRef = useRef(false);
  const lensRef = useRef<string | null>(null);
  const onVideoRef = useRef(onVideo);
  useEffect(() => {
    onVideoRef.current = onVideo;
  }, [onVideo]);

  const sensors = useDeviceSensors();
  const { readout } = sensors;
  const { begin: beginSensors, end: endSensors, request: requestSensors } = sensors;
  const cameraShowing = mode === "camera" && (cam === "ready" || cam === "countdown" || cam === "recording");
  const live = useLiveChecks(videoRef, cameraShowing);
  const { begin: beginLive, end: endLive } = live;

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => window.clearInterval(t));
    timersRef.current = [];
  }, []);

  // Stop everything when leaving the screen.
  useEffect(
    () => () => {
      clearTimers();
      recRef.current?.stop();
      recRef.current = null;
      stopStream(streamRef.current);
      streamRef.current = null;
    },
    [clearTimers],
  );

  // Attach the stream to the preview element.
  useEffect(() => {
    const v = videoRef.current;
    if (v && v.srcObject !== stream) {
      v.srcObject = stream;
      if (stream) v.play().catch(() => undefined);
    }
  }, [stream, mode]);

  // ---- the live checks ----------------------------------------------------------------------------------
  const sensorsOn = readout.status === "active";
  const tilt = sensorsOn ? readout.tilt : null;
  const chips: Chip[] = [
    {
      id: "feet",
      label: "Feet visible",
      state: live.checks.feet === null ? "wait" : live.checks.feet === "both" ? "ok" : live.checks.feet === "one" ? "warn" : "bad",
      hint: live.checks.feet === "one" ? "Keep both feet in the zones" : "Point the camera at your feet",
    },
    {
      id: "light",
      label: "Light OK",
      state: live.checks.light === null ? "wait" : live.checks.light === "ok" ? "ok" : "bad",
      hint: live.checks.light && live.checks.light !== "ok" ? LIGHT_HINTS[live.checks.light] : undefined,
    },
    {
      id: "level",
      label: "Level",
      state: !sensorsOn ? "na" : tilt === null ? "wait" : tiltClass(tilt) === "good" ? "ok" : tiltClass(tilt) === "warn" ? "warn" : "bad",
      hint: "Hold the phone flat, camera at the floor",
    },
    {
      id: "steady",
      label: "Steady",
      state: !sensorsOn || !readout.hasMotion ? "na" : readout.steady ? "ok" : "warn",
      hint: "Hold still for a second",
    },
  ];
  const allGreen = chips.every((c) => c.state === "ok" || c.state === "na");
  useEffect(() => {
    allGreenRef.current = allGreen;
  }, [allGreen]);
  const blockers = chips.filter((c) => c.state !== "ok" && c.state !== "na");

  // ---- camera -------------------------------------------------------------------------------------------
  const openStream = useCallback(async (f: CameraFacing) => {
    setError(null);
    setCam("starting");
    stopStream(streamRef.current);
    streamRef.current = null;
    setStream(null);
    try {
      const s = await openCamera(f);
      streamRef.current = s;
      setStream(s);
      setCam("ready");
    } catch (err) {
      setCam("idle");
      setMode("choose");
      setError(cameraErrorMessage(err));
    }
  }, []);

  const chooseCamera = () => {
    void requestSensors(); // inside the tap: iOS only shows its motion prompt for a user gesture
    setMode("camera");
    void openStream(facing);
  };

  const switchCamera = () => {
    const next: CameraFacing = facing === "environment" ? "user" : "environment";
    setFacing(next);
    void openStream(next);
  };

  const cancelCamera = () => {
    clearTimers();
    recRef.current?.stop();
    recRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    setStream(null);
    setCam("idle");
    setMode("choose");
  };

  const beginRecording = useCallback(
    (forcedStart: boolean) => {
      const s = streamRef.current;
      if (!s) return;
      if (!s.active) {
        // the camera stopped during the countdown (another app took it, the phone was locked): not a browser limitation
        stopStream(s);
        streamRef.current = null;
        setStream(null);
        setMode("choose");
        setCam("idle");
        setError("The camera stopped before recording could start. Press “Record with camera” to try again.");
        return;
      }
      lensRef.current = cameraLabel(s);
      let rec: ActiveRecording;
      const recStartMs = performance.now();
      beginSensors();
      beginLive();
      try {
        rec = recordStream(s, CAPTURE_CONFIG.maxRecordSec);
      } catch {
        endSensors();
        endLive();
        setError("Recording isn't supported in this browser. You can upload a video instead.");
        setMode("choose");
        setCam("idle");
        return;
      }
      recRef.current = rec;
      setCam("recording");
      setElapsed(0);
      const t0 = performance.now();
      timersRef.current.push(window.setInterval(() => setElapsed((performance.now() - t0) / 1000), 200));
      rec.done
        .then((r) => {
          clearTimers();
          stopStream(streamRef.current);
          streamRef.current = null;
          recRef.current = null;
          const sensed = endSensors();
          const capture: CaptureInfo = {
            sensors:
              sensed.hasOrientation || sensed.hasMotion
                ? {
                    status: sensed.status,
                    log: sensed.log,
                    stepTimesMs: sensed.stepTimesMs,
                    hasOrientation: sensed.hasOrientation,
                    hasMotion: sensed.hasMotion,
                  }
                : null,
            recStartMs,
            recEndMs: sensed.endMs,
            forcedStart,
            live: endLive(),
            lens: lensRef.current,
          };
          onVideoRef.current(r.blob, "camera", r.durationSec, capture);
        })
        .catch((err: unknown) => {
          clearTimers();
          recRef.current = null;
          endSensors();
          endLive();
          setCam("ready");
          setError(err instanceof Error ? err.message : "The recording failed.");
        });
    },
    [beginSensors, endSensors, beginLive, endLive, clearTimers],
  );

  // The 3-2-1 only runs while every live check is green; otherwise it holds at 3 (and, after a while, offers "Start anyway").
  useEffect(() => {
    if (cam !== "countdown") return;
    const id = window.setInterval(() => {
      const c = countdownRef.current;
      if (allGreenRef.current) {
        c.remainingMs -= 100;
        setHolding(false);
        setCount(Math.max(1, Math.ceil(c.remainingMs / 1000)));
        if (c.remainingMs <= 0) {
          window.clearInterval(id);
          beginRecording(false);
        }
      } else {
        c.remainingMs = CAPTURE_CONFIG.countdownSec * 1000;
        c.waitedMs += 100;
        setHolding(true);
        setCount(CAPTURE_CONFIG.countdownSec);
        if (c.waitedMs >= SENSOR_CONFIG.startAnywayAfterSec * 1000) setCanForce(true);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [cam, beginRecording]);

  const startCountdown = () => {
    setError(null);
    countdownRef.current = { remainingMs: CAPTURE_CONFIG.countdownSec * 1000, waitedMs: 0 };
    setCount(CAPTURE_CONFIG.countdownSec);
    setHolding(false);
    setCanForce(false);
    setCam("countdown");
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name)) {
      setError("That doesn't look like a video file. Choose an MP4 or MOV recorded on your phone.");
      return;
    }
    setError(null);
    onVideo(file, "upload");
  };

  if (mode === "camera") {
    const busy = cam === "starting";
    const sensorNote =
      readout.status === "denied"
        ? "Motion access was not allowed, so tilt and steadiness cannot be checked. You can still record; the result will be marked low confidence. (On iPhone: Settings → Safari → Motion & Orientation Access.)"
        : readout.status === "unavailable"
          ? `${readout.reason ?? "No motion sensors."} You can still record; the result will be marked low confidence.`
          : null;
    return (
      <ScreenShell>
        <h1 ref={h1} tabIndex={-1} className="text-2xl font-extrabold">
          {cam === "recording" ? "Recording…" : cam === "countdown" ? "Get into position" : "Set up your shot"}
        </h1>

        <div className="relative overflow-hidden rounded-3xl border border-line bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            aria-label="Camera preview"
            className="block max-h-[60dvh] w-full object-contain"
            style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
          />
          {CAPTURE_MODE === "topdown" && cam !== "starting" && <FootGuideOverlay feetFound={live.checks.feet === "both"} />}
          {CAPTURE_MODE === "topdown" && cam !== "starting" && (
            <>
              <div className="absolute inset-x-2 top-2">
                <ChipRow chips={chips} />
              </div>
              {tilt !== null && readout.beta !== null && readout.gamma !== null && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
                  <LevelBubble beta={readout.beta} gamma={readout.gamma} tilt={tilt} />
                </div>
              )}
              {cam === "recording" && (
                <>
                  <div className="absolute bottom-3 right-3">
                    <RecordRing elapsed={elapsed} total={CAPTURE_CONFIG.maxRecordSec} />
                  </div>
                  <div className="absolute bottom-3 left-3 rounded-full bg-black/65 px-3 py-1.5 text-sm font-bold" aria-live="off">
                    Steps <span className="tabular-nums">{readout.steps}</span>
                  </div>
                </>
              )}
            </>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-muted">Starting camera…</div>
          )}
          {cam === "countdown" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/45">
              <span aria-hidden className="text-8xl font-extrabold text-accent tabular-nums">
                {count}
              </span>
              <span className="mt-1 px-4 text-center text-sm text-ink">
                {holding ? `Waiting for: ${blockers.map((b) => b.label).join(", ")}` : copy.countdownHint}
              </span>
            </div>
          )}
        </div>

        <p className="text-sm text-muted" aria-live="polite">
          {cam === "ready" && copy.recordHint}
          {cam === "countdown" &&
            (holding
              ? blockers.map((b) => b.hint).filter(Boolean).slice(0, 2).join(". ") + "."
              : `Recording starts in ${count} second${count === 1 ? "" : "s"}.`)}
          {cam === "recording" && copy.recordingHint}
          {busy && "Starting camera…"}
        </p>

        {sensorNote && (
          <p role="status" className="rounded-2xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
            {sensorNote}
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-2xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-3">
          {cam === "ready" && (
            <>
              <Button onClick={startCountdown} className="w-full py-4 text-lg">
                Start
              </Button>
              <p className="-mt-1 text-center text-xs text-muted">
                A {CAPTURE_CONFIG.countdownSec}-2-1 countdown runs while Feet visible, Light OK, Level and Steady are all green.
              </p>
              {CAPTURE_MODE === "front" && (
                <Button variant="secondary" onClick={switchCamera}>
                  <SwitchCameraIcon /> {facing === "environment" ? "Use front camera" : "Use back camera"}
                </Button>
              )}
            </>
          )}
          {cam === "countdown" && canForce && (
            <Button
              variant="secondary"
              onClick={() => {
                clearTimers();
                beginRecording(true);
              }}
            >
              Start anyway (the result will be marked less certain)
            </Button>
          )}
          {cam === "recording" && (
            <Button onClick={() => recRef.current?.stop()} className="w-full py-4 text-lg">
              Stop and analyse
            </Button>
          )}
          {cam !== "recording" && (
            <Button variant="ghost" onClick={cancelCamera}>
              Cancel
            </Button>
          )}
        </div>

        <details className="rounded-2xl border border-line bg-surface p-3 text-xs">
          <summary className="cursor-pointer font-semibold">Sensor readout (for testing)</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
            {(
              [
                ["Status", readout.status],
                ["Tilt from flat", `${fmt(readout.tilt)}°`],
                ["α (heading) / β / γ", `${fmt(readout.alpha, 0)} / ${fmt(readout.beta)} / ${fmt(readout.gamma)}`],
                ["Gyro", `${fmt(readout.rotation, 0)} °/s`],
                ["Acceleration", `${fmt(readout.accel)} m/s²`],
                ["Steady", readout.steady ? "yes" : "no"],
                ["Steps (recording)", String(readout.steps)],
                ["Sample rates", `${fmt(readout.orientationHz, 0)} / ${fmt(readout.motionHz, 0)} Hz`],
                ["Light (mean)", fmt(live.checks.lightMean, 0)],
                ["Camera", stream?.getVideoTracks()[0]?.label || "–"],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </details>
        <PrivacyNote />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <h1 ref={h1} tabIndex={-1} className="text-3xl font-extrabold leading-tight">
        Record or upload your walk
      </h1>
      <p className="text-muted">{copy.captureIntro}</p>

      {error && (
        <p role="alert" className="rounded-2xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <Button onClick={chooseCamera} disabled={!recordingSupported} className="w-full py-4 text-lg">
          <CameraIcon /> Record with camera
        </Button>
        {!recordingSupported && (
          <p className="text-sm text-muted">
            In-page recording isn&apos;t available in this browser, but you can upload a video.
          </p>
        )}

        <input
          id="video-upload"
          type="file"
          accept="video/*"
          className="peer sr-only"
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <label
          htmlFor="video-upload"
          className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-line bg-surface-strong px-6 py-4 text-lg font-bold transition hover:bg-white/15 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-accent"
        >
          <UploadIcon /> Upload a video
        </label>
      </div>

      <PrivacyNote />
      <Disclaimer />
      <Button variant="ghost" onClick={onBack} className="self-start">
        ← Back
      </Button>
    </ScreenShell>
  );
}
