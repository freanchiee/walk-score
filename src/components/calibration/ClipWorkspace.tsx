"use client";

import { useState } from "react";
import { MIN_MARKS_PER_FOOT } from "@/lib/calibration/fit";
import type { Side } from "@/lib/calibration/measure";
import { stanceFrames } from "@/lib/calibration/session";
import { CanvasTimeline } from "../debug/CanvasTimeline";
import { f1 } from "../debug/shared";
import { Button } from "../ui";
import { MeasureStage, type Tool } from "./MeasureStage";
import type { ClipAnalysis, ReadyClip } from "./types";

const SIDE_STYLE: Record<Side, string> = {
  left: "border-[#fbbf24] bg-[#fbbf24] text-black",
  right: "border-[#38bdf8] bg-[#38bdf8] text-black",
};

const small = "min-h-10 px-4 py-2 text-sm";

/** Marking one clip: pick a frame, pick a foot, click heel centre and toe gap; compare with what the app read. */
export function ClipWorkspace({
  clip,
  analysis,
  update,
}: {
  clip: ReadyClip;
  analysis: ClipAnalysis;
  update: (fn: (c: ReadyClip) => ReadyClip) => void;
}) {
  const { frames, loaded, marks, line } = clip;
  const { result, readings, fwd, fwdApp, usingOwn } = analysis;
  const n = frames.length;
  const [idx, setIdx] = useState(() => stanceFrames(result, "left")[0] ?? Math.floor(n / 2));
  const [side, setSide] = useState<Side>("left");
  const [tool, setTool] = useState<Tool>("mark");
  const [showApp, setShowApp] = useState(true);

  const go = (i: number) => setIdx(Math.min(n - 1, Math.max(0, i)));
  const stances = stanceFrames(result, side);
  const jump = (dir: 1 | -1) => {
    if (!stances.length) return;
    const next = dir === 1 ? stances.find((s) => s > idx) ?? stances[0] : [...stances].reverse().find((s) => s < idx) ?? stances[stances.length - 1];
    go(next);
  };
  const count = (s: Side) => readings.filter((r) => r.plausible && r.mark.side === s).length;
  const psi = result.heading.psiDeg;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <MeasureStage
          loaded={loaded}
          frames={frames}
          result={result}
          idx={idx}
          side={side}
          tool={tool}
          fwdApp={fwdApp}
          fwd={fwd}
          usingOwn={usingOwn}
          marks={marks}
          line={line}
          showApp={showApp}
          onAddMark={(m) =>
            update((c) => ({ ...c, marks: [...c.marks, { ...m, id: Math.max(0, ...c.marks.map((x) => x.id)) + 1 }] }))
          }
          onMoveMark={(id, which, p) => update((c) => ({ ...c, marks: c.marks.map((x) => (x.id === id ? { ...x, [which]: p } : x)) }))}
          onSetLine={(l) => update((c) => ({ ...c, line: l, useOwn: true }))}
          onMoveLine={(which, p) => update((c) => (c.line ? { ...c, line: { ...c.line, [which]: p } } : c))}
          onToolDone={() => setTool("mark")}
        />

        <div className="flex items-center gap-2">
          <Button variant="secondary" className={small} onClick={() => go(idx - 1)} aria-label="Previous frame">
            ◀
          </Button>
          <input
            type="range"
            min={0}
            max={Math.max(0, n - 1)}
            value={idx}
            onChange={(e) => go(Number(e.target.value))}
            aria-label="Frame"
            className="min-w-0 flex-1 accent-[var(--accent)]"
          />
          <Button variant="secondary" className={small} onClick={() => go(idx + 1)} aria-label="Next frame">
            ▶
          </Button>
        </div>
        <p className="text-center text-xs tabular-nums text-muted">
          frame {idx + 1}/{n} · {frames[idx]?.t.toFixed(2)} s
        </p>
        <CanvasTimeline result={result} n={n} idx={idx} onSeek={go} />
        <p className="text-xs text-muted">
          Timeline: green = a stance the app measured, amber = a stance it discarded, faint = the foot is moving. Click it to jump.
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <section aria-label="Foot and frame" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Marking the</span>
            {(["left", "right"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={side === s && tool === "mark"}
                onClick={() => {
                  setSide(s);
                  setTool("mark");
                }}
                className={`min-h-10 rounded-full border px-4 py-1.5 text-sm font-bold transition ${
                  side === s && tool === "mark" ? SIDE_STYLE[s] : "border-line bg-surface text-ink hover:bg-white/10"
                }`}
              >
                {s === "left" ? "Left" : "Right"} foot · {count(s)} mark{count(s) === 1 ? "" : "s"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" className={small} onClick={() => jump(-1)} disabled={!stances.length}>
              ◀ Previous {side} stance
            </Button>
            <Button variant="secondary" className={small} onClick={() => jump(1)} disabled={!stances.length}>
              Next {side} stance ▶
            </Button>
          </div>
          <p className="text-xs text-muted">
            {stances.length
              ? `The stance buttons jump to the middle of each ${side}-foot stance the app found, where the foot is flat on the floor. Aim for at least ${MIN_MARKS_PER_FOOT} marks per foot, from different steps.`
              : `The app found no ${side}-foot stance in this clip, so step through the frames yourself and pick ones where the foot is flat on the floor.`}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showApp} onChange={(e) => setShowApp(e.target.checked)} />
            Show the feet the app found (dashed lines)
          </label>
        </section>

        <section aria-label="Walking direction" className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-sm font-bold">Walking direction the angles are measured against</h3>
          <div className="mt-2 flex flex-col gap-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="radio" name={`dir-${clip.id}`} checked={!usingOwn} onChange={() => update((c) => ({ ...c, useOwn: false }))} />
              <span>
                The app&apos;s, from how the floor slides through the picture
                <span className="block text-xs text-muted">
                  {result.heading.fitted ? `${f1(psi, true)}° clockwise from the top of the picture` : "no ground motion found, so the top of the picture is assumed"}.
                  Because the app and you use the same direction, the offsets then show only the difference in how the foot axis is defined.
                </span>
              </span>
            </label>
            <label className={`flex items-start gap-2 ${line ? "" : "opacity-60"}`}>
              <input
                type="radio"
                name={`dir-${clip.id}`}
                checked={usingOwn}
                disabled={!line}
                onChange={() => update((c) => ({ ...c, useOwn: true }))}
              />
              <span>
                My own line
                <span className="block text-xs text-muted">
                  Draw it along a floor line or plank edge that runs the way you walked. Needed to check the app&apos;s walking direction itself.
                </span>
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className={small}
                aria-pressed={tool === "direction"}
                onClick={() => setTool(tool === "direction" ? "mark" : "direction")}
              >
                {tool === "direction" ? "Stop drawing" : line ? "Redraw my line" : "Draw my line"}
              </Button>
              {line && (
                <Button variant="ghost" className={small} onClick={() => update((c) => ({ ...c, line: null, useOwn: false }))}>
                  Clear my line
                </Button>
              )}
            </div>
          </div>
        </section>

        <section aria-label="Marks" className="min-w-0">
          <h3 className="text-sm font-bold">Your marks on this clip</h3>
          {readings.length === 0 ? (
            <p className="mt-1 text-sm text-muted">None yet. Pick a frame where the foot is flat, then click the heel centre and the toe gap.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-left text-sm">
                <caption className="sr-only">Hand marks and what the app read in the same frames</caption>
                <thead className="text-xs uppercase tracking-wider text-muted">
                  <tr>
                    {["Foot", "Time", "You °", "App °", "Δ °", ""].map((h, i) => (
                      <th key={`${h}-${i}`} scope="col" className="border-b border-line px-2 py-1.5 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {[...readings]
                    .sort((a, b) => a.mark.idx - b.mark.idx || a.mark.side.localeCompare(b.mark.side))
                    .map((r) => (
                      <tr key={r.mark.id} className={r.plausible ? "" : "text-warn"}>
                        <td className="border-b border-line/60 px-2 py-1 capitalize">{r.mark.side}</td>
                        <td className="border-b border-line/60 px-2 py-1">{frames[r.mark.idx]?.t.toFixed(2)} s</td>
                        <td className="border-b border-line/60 px-2 py-1 font-bold">
                          {f1(r.userDeg, true)}
                          {!r.plausible && <span className="ml-1 text-xs font-normal">heel and toe swapped?</span>}
                        </td>
                        <td className="border-b border-line/60 px-2 py-1">{r.appDeg === null ? "no foot found" : f1(r.appDeg, true)}</td>
                        <td className="border-b border-line/60 px-2 py-1">{r.appDeg === null || !r.plausible ? "—" : f1(r.userDeg - r.appDeg, true)}</td>
                        <td className="whitespace-nowrap border-b border-line/60 px-2 py-1 text-right">
                          <button
                            type="button"
                            className="rounded px-1.5 py-0.5 font-bold text-accent underline underline-offset-2"
                            onClick={() => {
                              setSide(r.mark.side);
                              setTool("mark");
                              go(r.mark.idx);
                            }}
                          >
                            show
                          </button>
                          <button
                            type="button"
                            className="ml-2 rounded px-1.5 py-0.5 font-bold text-danger underline underline-offset-2"
                            aria-label={`Delete the ${r.mark.side} mark at ${frames[r.mark.idx]?.t.toFixed(2)} seconds`}
                            onClick={() => update((c) => ({ ...c, marks: c.marks.filter((x) => x.id !== r.mark.id) }))}
                          >
                            delete
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted">
                You = heel centre → toe gap against the walking direction (toe-out +, toe-in −). App = what the foot finder reads in the same frame.
                Δ = You − App: the offset to add to the app.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
