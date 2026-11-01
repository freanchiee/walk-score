"use client";

import { useState } from "react";
import { DEFAULT_EXPERIMENTS, SENSOR_CONFIG } from "@/lib/config";
import { experimentFlags } from "@/lib/flags";
import { getLastCapture } from "@/lib/sensors/lastCapture";
import { bubbleOffset, tiltDeg } from "@/lib/sensors/tilt";
import { LevelBubble } from "../CaptureHud";
import { Button, Card } from "../ui";
import { useDeviceSensors } from "../useDeviceSensors";
import { download, f1 } from "./shared";

const POSES: Array<[string, number, number, number]> = [
  // name, beta, gamma, expected tilt (worked out by hand, independent of the code)
  ["flat, screen up (camera at the floor)", 0, 0, 0],
  ["top edge raised 10°", 10, 0, 10],
  ["top edge lowered 10°", -10, 0, 10],
  ["right edge lowered 10°", 0, 10, 10],
  ["left edge lowered 10°", 0, -10, 10],
  ["raised 10° and right edge lowered 10° (acos(cos10° cos10°))", 10, 10, 14.106],
  ["upright in portrait (camera looks straight ahead)", 90, 0, 90],
];

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${Math.round(v * 100)}%`);

/** /debug "Sensors": the live readout of the phone's motion sensors, the tilt maths checked against known poses, the experiment switches, and what the sensors said about the last scan. */
export function SensorsDebug() {
  const sensors = useDeviceSensors();
  const { readout } = sensors;
  const [logging, setLogging] = useState(false);
  const [flags] = useState(() => experimentFlags());
  const last = getLastCapture();
  const [, force] = useState(0);

  const toggleLog = () => {
    if (!logging) sensors.begin();
    else sensors.end();
    setLogging(!logging);
    force((n) => n + 1);
  };

  const saveLog = () => {
    if (!last?.info?.sensors) return;
    const { info, report } = last;
    const s = info.sensors!;
    download(
      JSON.stringify({
        version: 1,
        note: "Sensor log of one capture, kept on this device. Times are performance.now() milliseconds; the video starts at recStartMs. Never uploaded.",
        recStartMs: info.recStartMs,
        recEndMs: info.recEndMs,
        forcedStart: info.forcedStart,
        lens: info.lens,
        stepTimesMs: s.stepTimesMs,
        orientation: s.log.orientation,
        motion: s.log.motion,
        report,
      }),
      "walkscore-sensor-log.json",
      "application/json",
    );
  };

  // tilt over the last capture
  const tilts = (() => {
    const s = last?.info?.sensors;
    if (!s || !last?.info) return null;
    const o = s.log.orientation;
    const step = Math.max(1, Math.floor(o.length / 300));
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < o.length; i += step) pts.push([(o[i].t - last.info.recStartMs) / 1000, tiltDeg(o[i].beta, o[i].gamma)]);
    return pts;
  })();
  const duration = last?.info ? (last.info.recEndMs - last.info.recStartMs) / 1000 : 10;
  const yMax = 30;

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-muted">
        The phone&apos;s motion sensors, used to guide and check the capture. Tilt is the angle between the back camera&apos;s axis and straight down
        (0° = phone flat, screen up, camera at the floor). Nothing here is stored or sent anywhere; the sensor log stays in this page&apos;s memory.
      </p>

      <Card>
        <h2 className="text-lg font-bold">1 · Live readout</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button id="sensors-start" onClick={() => void sensors.request()} disabled={readout.status === "requesting"}>
            {readout.status === "active" ? "Sensors running" : "Start sensors (asks permission on iPhone)"}
          </Button>
          <Button id="sensors-log" variant="secondary" onClick={toggleLog} disabled={readout.status !== "active"}>
            {logging ? "Stop logging" : "Start logging + counting steps"}
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-start gap-6">
          {readout.tilt !== null && readout.beta !== null && readout.gamma !== null && <LevelBubble beta={readout.beta} gamma={readout.gamma} tilt={readout.tilt} />}
          <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-1 text-sm tabular-nums sm:grid-cols-3" id="sensors-readout">
            {(
              [
                ["Status", readout.status + (readout.reason ? ` (${readout.reason})` : "")],
                ["Tilt from flat", `${f1(readout.tilt)}°`],
                ["β (front-back)", `${f1(readout.beta)}°`],
                ["γ (left-right)", `${f1(readout.gamma)}°`],
                ["α (heading, relative)", `${f1(readout.alpha)}°`],
                ["Gyro", `${f1(readout.rotation)} °/s`],
                ["Acceleration |a|", `${f1(readout.accel)} m/s²`],
                ["Steady (1 s)", readout.steady ? "yes" : "no"],
                ["Steps counted", String(readout.steps)],
                ["Orientation rate", `${f1(readout.orientationHz)} Hz`],
                ["Motion rate", `${f1(readout.motionHz)} Hz`],
                ["Bubble (x, y)", readout.beta !== null && readout.gamma !== null ? `${f1(bubbleOffset(readout.beta, readout.gamma).x)}, ${f1(bubbleOffset(readout.beta, readout.gamma).y)}` : "–"],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-surface px-2 py-1.5">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="font-bold">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="mt-3 text-xs text-muted">
          Try it: lay the phone flat (tilt ≈ 0°, bubble in the middle), then lift the top edge (β rises, the bubble moves up), then lower the right edge (γ rises, the
          bubble moves left). Colours: green up to {SENSOR_CONFIG.tilt.goodDeg}°, amber up to {SENSOR_CONFIG.tilt.warnDeg}°, red beyond. Needs https (or localhost).
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">2 · The tilt maths against known poses</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm" id="sensors-poses">
            <caption className="sr-only">Tilt computed from beta and gamma for known poses, next to the hand-worked value</caption>
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr>
                {["Pose", "β", "γ", "Tilt (code)", "Expected", ""].map((h, i) => (
                  <th key={`${h}-${i}`} scope="col" className="border-b border-line px-2 py-1.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {POSES.map(([name, b, g, expected]) => {
                const t = tiltDeg(b, g);
                const ok = Math.abs(t - expected) < 0.01;
                return (
                  <tr key={name}>
                    <td className="border-b border-line/60 px-2 py-1">{name}</td>
                    <td className="border-b border-line/60 px-2 py-1">{b}°</td>
                    <td className="border-b border-line/60 px-2 py-1">{g}°</td>
                    <td className="border-b border-line/60 px-2 py-1 font-bold">{f1(t)}°</td>
                    <td className="border-b border-line/60 px-2 py-1">{expected}°</td>
                    <td className={`border-b border-line/60 px-2 py-1 font-bold ${ok ? "text-ok" : "text-danger"}`}>{ok ? "✓" : "✗"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">3 · Experiments (all off by default)</h2>
        <ul className="mt-2 space-y-1 text-sm" id="sensors-flags">
          {(
            [
              ["yawCheck", "Yaw check", "tracks how far the phone turns while you walk and warns"],
              ["yawReject", "…and reject", "turns the scan down when it turned beyond " + SENSOR_CONFIG.yaw.rejectDeg + "°"],
              ["floorFlow", "Floor optical flow", "estimates the walking direction from the floor texture (compare below, in the Top-down tab)"],
              ["tiltCorrection", "Tilt correction", "re-projects the feet to a straight-down view with the phone's pitch and roll"],
            ] as const
          ).map(([key, name, what]) => (
            <li key={key}>
              <span className={`font-bold ${flags[key] ? "text-ok" : "text-muted"}`}>{flags[key] ? "ON" : "off"}</span> · <strong>{name}</strong>: {what}
              {DEFAULT_EXPERIMENTS[key] !== flags[key] ? " (switched from the address)" : ""}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">
          Switch them on for a page load with <code>?exp=yaw,yawreject,flow,tilt</code> after the address (e.g. <code>/?exp=yaw,tilt</code>); <code>?exp=none</code> forces all off.
          The list above shows the flags in the current address. A scan uses the flags that were in the address when it was analysed (open the app with them and scan from
          there); section 4 says what was applied to the last scan.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">4 · What the sensors said about the last scan</h2>
        {!last?.report ? (
          <p className="mt-2 text-sm text-muted">No scan yet in this page session. Make one in the app, then come back here without reloading (the report lives in memory only).</p>
        ) : (
          <div className="mt-3 flex flex-col gap-4" id="sensors-last">
            <p className={`rounded-xl border p-3 text-sm ${last.failure ? "border-danger/40 bg-danger/10" : "border-ok/40 bg-ok/10"}`} role="status">
              {last.failure ? <>Turned down: {last.failure}</> : <strong>Accepted</strong>}
            </p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm tabular-nums sm:grid-cols-3">
              {(
                [
                  ["Capture quality", `${last.report.quality.score}/100 · ${last.report.quality.category}${last.report.lowConfidence ? " · low confidence" : ""}`],
                  ["Sensors", last.report.sensors],
                  ["Steps (accelerometer)", last.report.steps === null ? "–" : String(last.report.steps)],
                  ["Tilt median / p90", `${f1(last.report.tilt.medianDeg)}° / ${f1(last.report.tilt.p90Deg)}°`],
                  ["Frames over " + SENSOR_CONFIG.maxFrameTiltDeg + "°", pct(last.report.tilt.overShare)],
                  ["Reliable frames", pct(last.report.reliableShare)],
                  ["Gyro RMS", `${f1(last.report.rotationRmsDegPerSec)} °/s`],
                  ["Light OK while recording", pct(last.report.light.okShare)],
                  ["Both feet in view", pct(last.report.feet.share)],
                  ["Yaw", last.report.yaw.status + (last.report.yaw.maxAbsDeg !== null ? ` (max ${f1(last.report.yaw.maxAbsDeg)}°, sway ${f1(last.report.yaw.swayRmsDeg)}°)` : "")],
                  ["Started anyway", last.report.forcedStart ? "yes" : "no"],
                  ["Tilt corrected", last.report.tiltCorrected ? "yes" : "no"],
                  ["Camera", last.report.lens ?? "–"],
                  [
                    "Floor-flow heading",
                    last.report.floorFlow === undefined ? "off" : last.report.floorFlow === null ? "not available" : `${f1(last.report.floorFlow.psiDeg, true)}° (conf ${last.report.floorFlow.confidence.toFixed(2)}, ${last.report.floorFlow.samples} frames)`,
                  ],
                  ...(last.seed
                    ? ([
                        [
                          "Tapped foot",
                          `yes, ${last.seed.from === "preview" ? "on the camera preview" : last.seed.from === "video" ? "on a frame of the video" : "(where: unknown)"}: its colour replaced the skin test`,
                        ],
                        ["Tapped colour (Lab L / a / b)", last.seed.colour.map((v) => v.toFixed(0)).join(" / ")],
                        ["Frames: tapped colour / skin test", `${last.seed.seededFrames} / ${last.seed.fallbackFrames}`],
                        ["Tapped toes point", last.seed.toeAngleDeg === null ? "tap was not near the toes" : `${f1(last.seed.toeAngleDeg, true)}° from the top of the picture`],
                        ["Toes vs walking direction", last.seed.vsWalkingDeg === null ? "–" : `${f1(last.seed.vsWalkingDeg)}°`],
                        ["Forward taken from the toes", last.seed.setDirection ? "yes (no walking in the clip)" : "no"],
                      ] as const)
                    : ([["Tapped foot", "no (skin test only)"]] as const)),
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-line bg-surface px-2 py-1.5">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="font-bold">{v}</dd>
                </div>
              ))}
            </dl>
            {last.report.quality.reasons.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-warn">
                {last.report.quality.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            {tilts && tilts.length > 1 && (
              <figure>
                <svg viewBox="0 0 600 150" className="w-full rounded-lg border border-line bg-black/30" role="img" aria-label="Tilt of the phone over the recording">
                  {[SENSOR_CONFIG.tilt.goodDeg, SENSOR_CONFIG.tilt.warnDeg].map((th, i) => (
                    <g key={th}>
                      <line x1="0" x2="600" y1={140 - (th / yMax) * 130} y2={140 - (th / yMax) * 130} stroke={i ? "#fbbf24" : "#86efac"} strokeDasharray="4 4" strokeWidth="1" />
                      <text x="4" y={136 - (th / yMax) * 130} fill={i ? "#fbbf24" : "#86efac"} fontSize="10">
                        {th}°
                      </text>
                    </g>
                  ))}
                  <polyline
                    fill="none"
                    stroke="#c6f432"
                    strokeWidth="1.5"
                    points={tilts.map(([t, v]) => `${((t / duration) * 600).toFixed(1)},${(140 - (Math.min(v, yMax) / yMax) * 130).toFixed(1)}`).join(" ")}
                  />
                </svg>
                <figcaption className="mt-1 text-xs text-muted">Tilt over the recording (0–{yMax}°, {duration.toFixed(1)} s). Frames above the red-ish line were left out of the angle averaging.</figcaption>
              </figure>
            )}
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={saveLog} disabled={!last.info?.sensors}>
                Save the sensor log (.json, stays on this device)
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
