"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SENSOR_CONFIG } from "@/lib/config";
import { SensorLog } from "@/lib/sensors/log";
import { StepDetector } from "@/lib/sensors/steps";
import { tiltDeg } from "@/lib/sensors/tilt";
import type { SensorStatus } from "@/lib/sensors/types";

/** iOS Safari asks for permission through a static method that other browsers do not have. */
interface PermissionApi {
  requestPermission?: () => Promise<"granted" | "denied">;
}
const apiOf = (ctor: unknown) => ctor as PermissionApi | undefined;

export interface SensorReadout {
  status: SensorStatus;
  /** why the sensors are not active, when they are not */
  reason: string | null;
  hasOrientation: boolean;
  hasMotion: boolean;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  /** angle between the camera axis and straight down, degrees */
  tilt: number | null;
  /** gyroscope magnitude, deg/s */
  rotation: number | null;
  /** acceleration magnitude (incl. gravity), m/s² */
  accel: number | null;
  /** the gyroscope stayed below the threshold for the last SENSOR_CONFIG.steady.holdMs */
  steady: boolean;
  /** steps counted since begin() */
  steps: number;
  orientationHz: number;
  motionHz: number;
}

export interface SensorEnd {
  status: SensorStatus;
  log: SensorLog;
  stepTimesMs: number[];
  hasOrientation: boolean;
  hasMotion: boolean;
  startMs: number;
  endMs: number;
}

export interface DeviceSensors {
  readout: SensorReadout;
  /** Ask for the sensors. Call it straight from a tap: iOS only shows its prompt for a user gesture. */
  request: () => Promise<SensorStatus>;
  /** Start logging samples (and counting steps) for a recording. */
  begin: () => void;
  /** Stop logging and hand over what was recorded (kept in memory only). */
  end: () => SensorEnd;
}

const EMPTY: SensorReadout = {
  status: "idle",
  reason: null,
  hasOrientation: false,
  hasMotion: false,
  alpha: null,
  beta: null,
  gamma: null,
  tilt: null,
  rotation: null,
  accel: null,
  steady: false,
  steps: 0,
  orientationHz: 0,
  motionHz: 0,
};

const hzOf = (stamps: number[]) => (stamps.length > 5 ? ((stamps.length - 1) / (stamps[stamps.length - 1] - stamps[0])) * 1000 : 0);

/**
 * The phone's orientation and motion sensors (DeviceOrientationEvent / DeviceMotionEvent): live tilt and steadiness for
 * the guide, and a timestamped in-memory log (performance.now()) of everything between begin() and end() so it can be
 * lined up with the video. Nothing is stored or sent anywhere.
 */
export function useDeviceSensors(): DeviceSensors {
  const [readout, setReadout] = useState<SensorReadout>(EMPTY);
  const statusRef = useRef<{ status: SensorStatus; reason: string | null }>({ status: "idle", reason: null });
  const attached = useRef(false);
  const live = useRef({
    alpha: null as number | null,
    beta: null as number | null,
    gamma: null as number | null,
    rotation: null as number | null,
    accel: null as number | null,
    hasOrientation: false,
    hasMotion: false,
    oStamps: [] as number[],
    mStamps: [] as number[],
    rotWindow: [] as Array<{ t: number; mag: number }>,
  });
  const rec = useRef({ on: false, startMs: 0, log: new SensorLog(), steps: new StepDetector(), count: 0 });

  const setStatus = useCallback((status: SensorStatus, reason: string | null = null) => {
    statusRef.current = { status, reason };
  }, []);

  const onOrientation = useCallback((e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return; // some desktops fire an event with no data
    const t = performance.now();
    const l = live.current;
    l.hasOrientation = true;
    l.alpha = e.alpha;
    l.beta = e.beta;
    l.gamma = e.gamma;
    l.oStamps.push(t);
    if (l.oStamps.length > 60) l.oStamps.shift();
    if (rec.current.on) rec.current.log.addOrientation({ t, alpha: e.alpha, beta: e.beta, gamma: e.gamma });
  }, []);

  const onMotion = useCallback((e: DeviceMotionEvent) => {
    const t = performance.now();
    const l = live.current;
    const g = e.accelerationIncludingGravity ?? e.acceleration;
    const r = e.rotationRate;
    const ax = g?.x ?? NaN;
    const ay = g?.y ?? NaN;
    const az = g?.z ?? NaN;
    const hasAccel = Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(az);
    const rx = r?.beta ?? 0; // rotation about the device x axis (deg/s)
    const ry = r?.gamma ?? 0;
    const rz = r?.alpha ?? 0;
    const mag = Math.hypot(rx, ry, rz);
    if (!hasAccel && !r) return;
    l.hasMotion = true;
    l.accel = hasAccel ? Math.hypot(ax, ay, az) : l.accel;
    l.rotation = mag;
    l.mStamps.push(t);
    if (l.mStamps.length > 60) l.mStamps.shift();
    l.rotWindow.push({ t, mag });
    while (l.rotWindow.length && t - l.rotWindow[0].t > SENSOR_CONFIG.steady.holdMs) l.rotWindow.shift();
    if (rec.current.on && hasAccel) {
      rec.current.log.addMotion({ t, ax, ay, az, rx, ry, rz });
      if (rec.current.steps.push(t, ax, ay, az) !== null) rec.current.count++;
    }
  }, []);

  const attach = useCallback(() => {
    if (attached.current) return;
    attached.current = true;
    window.addEventListener("deviceorientation", onOrientation);
    window.addEventListener("devicemotion", onMotion);
  }, [onOrientation, onMotion]);

  // detach on unmount
  useEffect(
    () => () => {
      window.removeEventListener("deviceorientation", onOrientation);
      window.removeEventListener("devicemotion", onMotion);
      attached.current = false;
    },
    [onOrientation, onMotion],
  );

  // the numbers on screen: refreshed ten times a second from the refs (the log itself gets every sample)
  useEffect(() => {
    const id = window.setInterval(() => {
      const l = live.current;
      const { status, reason } = statusRef.current;
      const now = performance.now();
      const spanOk = l.rotWindow.length > 3 && now - l.rotWindow[0].t > SENSOR_CONFIG.steady.holdMs * 0.8;
      const steady = spanOk && l.rotWindow.every((s) => s.mag < SENSOR_CONFIG.steady.maxRotationDegPerSec);
      const fresh = l.oStamps.length > 0 && now - l.oStamps[l.oStamps.length - 1] < 1000;
      setReadout({
        status,
        reason,
        hasOrientation: l.hasOrientation,
        hasMotion: l.hasMotion,
        alpha: l.alpha,
        beta: fresh ? l.beta : null,
        gamma: fresh ? l.gamma : null,
        tilt: fresh && l.beta !== null && l.gamma !== null ? tiltDeg(l.beta, l.gamma) : null,
        rotation: l.rotation,
        accel: l.accel,
        steady,
        steps: rec.current.count,
        orientationHz: hzOf(l.oStamps),
        motionHz: hzOf(l.mStamps),
      });
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  const request = useCallback(async (): Promise<SensorStatus> => {
    if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") {
      setStatus("unavailable", "This browser has no motion sensors.");
      return "unavailable";
    }
    if (!window.isSecureContext) {
      setStatus("unavailable", "Motion sensors need a secure (https) page.");
      return "unavailable";
    }
    setStatus("requesting");
    try {
      // both prompts are started inside the same tap, before anything is awaited
      const asks: Array<Promise<string>> = [];
      const o = apiOf(DeviceOrientationEvent);
      const m = typeof DeviceMotionEvent === "undefined" ? undefined : apiOf(DeviceMotionEvent);
      if (typeof o?.requestPermission === "function") asks.push(o.requestPermission());
      if (typeof m?.requestPermission === "function") asks.push(m.requestPermission());
      if (asks.length && (await Promise.all(asks)).some((r) => r !== "granted")) {
        setStatus("denied", "Motion access was not allowed.");
        return "denied";
      }
    } catch {
      setStatus("denied", "Motion access was not allowed.");
      return "denied";
    }
    attach();
    // no event within a moment means this device has no sensors to give (a desktop, say)
    const deadline = performance.now() + 1500;
    while (performance.now() < deadline && !live.current.hasOrientation) await new Promise((r) => setTimeout(r, 50));
    if (live.current.hasOrientation) {
      setStatus("active");
      return "active";
    }
    setStatus("unavailable", "No motion data arrived from this device.");
    return "unavailable";
  }, [attach, setStatus]);

  const begin = useCallback(() => {
    rec.current = { on: true, startMs: performance.now(), log: new SensorLog(), steps: new StepDetector(), count: 0 };
  }, []);

  const end = useCallback((): SensorEnd => {
    const r = rec.current;
    r.on = false;
    return {
      status: statusRef.current.status,
      log: r.log,
      stepTimesMs: r.steps.steps.slice(),
      hasOrientation: r.log.orientation.length > 10,
      hasMotion: r.log.motion.length > 10,
      startMs: r.startMs,
      endMs: performance.now(),
    };
  }, []);

  return { readout, request, begin, end };
}
