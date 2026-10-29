"use client";

import type { AnalysisResult } from "@/lib/analysis/types";

const f1 = (v: number, signed = false) => (Number.isFinite(v) ? (signed && v > 0 ? "+" : "") + v.toFixed(1) : "—");

export function StepsTable({ result, onSeek }: { result: AnalysisResult; onSeek: (index: number) => void }) {
  if (!result.steps.length) {
    return <p className="text-sm text-muted">No stance phases were detected.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <caption className="sr-only">Detected steps and the foot angle measured for each</caption>
        <thead className="text-xs uppercase tracking-wider text-muted">
          <tr>
            {["#", "Foot", "Time (s)", "≈Dist (m)", "Frames", "Angle °", "Camera-view °", "Heading °", "Scatter °", "Conf.", "Status"].map((h) => (
              <th key={h} scope="col" className="border-b border-line px-2 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {result.steps.map((s, i) => (
            <tr key={`${s.foot}-${s.startIdx}`} className={s.used ? "" : "text-muted"}>
              <td className="border-b border-line/60 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => onSeek(Math.round((s.usedStartIdx + s.usedEndIdx) / 2))}
                  className="rounded px-1.5 py-0.5 font-bold text-accent underline underline-offset-2"
                  aria-label={`Jump to step ${i + 1}`}
                >
                  {i + 1}
                </button>
              </td>
              <td className="border-b border-line/60 px-2 py-1.5 capitalize">{s.foot}</td>
              <td className="border-b border-line/60 px-2 py-1.5">
                {s.tStart.toFixed(2)}–{s.tEnd.toFixed(2)}
              </td>
              <td className="border-b border-line/60 px-2 py-1.5">{f1(s.approxDistanceM)}</td>
              <td className="border-b border-line/60 px-2 py-1.5">{s.nFrames}</td>
              <td className="border-b border-line/60 px-2 py-1.5 font-bold">{f1(s.angleDeg, true)}</td>
              <td className="border-b border-line/60 px-2 py-1.5">{f1(s.losAngleDeg, true)}</td>
              <td className="border-b border-line/60 px-2 py-1.5">{f1(s.headingDeg, true)}</td>
              <td className="border-b border-line/60 px-2 py-1.5">{f1(s.spreadDeg)}</td>
              <td className="border-b border-line/60 px-2 py-1.5">{s.confidence.toFixed(2)}</td>
              <td className="border-b border-line/60 px-2 py-1.5">
                {s.used ? <span className="font-semibold text-ok">used</span> : <span className="text-warn">discarded: {s.discardReason}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">
        Angle = foot progression angle (toe-out +). Camera-view = before the walking-direction correction. Heading = the
        correction subtracted. Scatter = robust spread of the per-frame angles inside the step.
      </p>
    </div>
  );
}
