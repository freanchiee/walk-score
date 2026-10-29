"use client";

import { useMemo, useState } from "react";
import { MAX_OFFSET_DEG, fitOffsets, fitWarnings } from "@/lib/calibration/fit";
import { axisPairs, clipMeans, labelsCsv } from "@/lib/calibration/session";
import {
  HEADING_METHODS,
  clearCalibration,
  configSnippet,
  describeCalibration,
  saveCalibration,
  type Calibration,
  type HeadingMethod,
} from "@/lib/calibration/settings";
import { analyzeTopDown } from "@/lib/topdown/analyze";
import { Field, download, f1, inputCls } from "../debug/shared";
import { Button, Card } from "../ui";
import type { ClipAnalysis, ReadyClip } from "./types";

const mean =(v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

interface Props {
  clips: Array<{ clip: ReadyClip; analysis: ClipAnalysis }>;
  method: HeadingMethod;
  onMethod: (m: HeadingMethod) => void;
  /** the calibration saved on this device, if any */
  saved: Calibration | null;
  shipped: Calibration;
}

/** Step 3: the labels the marks give, the offsets they imply, a check of what the app would then read, and saving it. */
export function CalibrationResults({ clips, method, onMethod, saved, shipped }: Props) {
  const [edit, setEdit] = useState<{ left: string; right: string } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const fit = useMemo(() => fitOffsets(clips.flatMap((c) => axisPairs(c.analysis.readings))), [clips]);
  const warnings = fitWarnings(fit);
  const fittedLeft = Math.round(fit.left.offsetDeg * 10) / 10;
  const fittedRight = Math.round(fit.right.offsetDeg * 10) / 10;
  const fittedBy = { left: fittedLeft, right: fittedRight };
  // what is typed in the offset boxes (when anything is), else the fitted value; plain arithmetic so the memoised checks below can depend on it
  const typedLeft = edit && edit.left.trim() !== "" ? Number(edit.left) : NaN;
  const typedRight = edit && edit.right.trim() !== "" ? Number(edit.right) : NaN;
  const leftOffset = Number.isFinite(typedLeft) ? Math.max(-MAX_OFFSET_DEG, Math.min(MAX_OFFSET_DEG, typedLeft)) : fittedLeft;
  const rightOffset = Number.isFinite(typedRight) ? Math.max(-MAX_OFFSET_DEG, Math.min(MAX_OFFSET_DEG, typedRight)) : fittedRight;

  const marksTotal = clips.reduce((a, c) => a + c.analysis.readings.filter((r) => r.plausible).length, 0);
  const clipsWithMarks = clips.filter((c) => c.analysis.readings.some((r) => r.plausible)).length;
  const current: Calibration = {
    version: 1,
    leftOffsetDeg: leftOffset,
    rightOffsetDeg: rightOffset,
    method,
    basedOn: { clips: clipsWithMarks, marks: marksTotal },
  };

  // what the app reads on each clip now, with the offsets above, next to the person's own mean
  const rows = useMemo(
    () =>
      clips.map(({ clip, analysis }) => {
        const means = clipMeans(analysis.readings);
        const cal = analyzeTopDown(clip.frames, clip.video, {
          ...HEADING_METHODS[method].options,
          angleOffsetLeftDeg: leftOffset,
          angleOffsetRightDeg: rightOffset,
        });
        return { clip, analysis, means, cal };
      }),
    [clips, method, leftOffset, rightOffset],
  );

  const diffs = (which: "raw" | "cal") => {
    const out: number[] = [];
    for (const r of rows) {
      const res = which === "raw" ? r.analysis.result : r.cal;
      if (r.means.left && res.leftDeg !== null) out.push(Math.abs(res.leftDeg - r.means.left.mean));
      if (r.means.right && res.rightDeg !== null) out.push(Math.abs(res.rightDeg - r.means.right.mean));
    }
    return out;
  };

  // which way of finding the walking direction fits best: only fair on clips measured against the person's own line
  const methodRows = useMemo(() => {
    const own = clips.filter((c) => c.analysis.usingOwn);
    if (!own.length) return null;
    return (Object.keys(HEADING_METHODS) as HeadingMethod[]).map((m) => {
      const errs: number[] = [];
      for (const { clip, analysis } of own) {
        const means = clipMeans(analysis.readings);
        const r = analyzeTopDown(clip.frames, clip.video, {
          ...HEADING_METHODS[m].options,
          angleOffsetLeftDeg: leftOffset,
          angleOffsetRightDeg: rightOffset,
        });
        if (means.left && r.leftDeg !== null) errs.push(Math.abs(r.leftDeg - means.left.mean));
        if (means.right && r.rightDeg !== null) errs.push(Math.abs(r.rightDeg - means.right.mean));
      }
      return { m, n: errs.length, mae: mean(errs) };
    });
  }, [clips, leftOffset, rightOffset]);

  const apply = () => {
    const toSave: Calibration = { ...current, savedAt: new Date().toISOString() };
    if (saveCalibration(toSave)) {
      setMessage({ ok: true, text: `Saved on this device (${describeCalibration(toSave)}). Every new scan here now uses it.` });
    } else {
      setMessage({ ok: false, text: "This browser would not store it (private window or blocked site data). Paste the line below into src/lib/config.ts instead." });
    }
  };
  const reset = () => {
    clearCalibration();
    setEdit(null);
    setMessage({ ok: true, text: `Cleared. This device now uses the shipped calibration (${describeCalibration(shipped)}).` });
  };
  const copyLine = async () => {
    try {
      await navigator.clipboard.writeText(configSnippet(current));
      setMessage({ ok: true, text: "Copied. Paste it over DEFAULT_CALIBRATION in src/lib/config.ts to ship it to everyone." });
    } catch {
      setMessage({ ok: false, text: "Could not copy automatically. Select the line below and copy it." });
    }
  };
  const saveLabels = () =>
    download(
      labelsCsv(rows.map((r) => ({ name: r.clip.name, left: r.means.left?.mean ?? null, right: r.means.right?.mean ?? null }))),
      "labels.csv",
      "text/csv",
    );

  const hasMarks = marksTotal > 0;
  const rawMae = mean(diffs("raw"));
  const calMae = mean(diffs("cal"));
  const th = "border-b border-line px-2 py-1.5 font-semibold";
  const td = "border-b border-line/60 px-2 py-1.5";

  return (
    <Card>
      <h2 className="text-lg font-bold">3 · Labels and calibration</h2>
      {!hasMarks ? (
        <p className="mt-2 text-sm text-muted">Mark the heel centre and toe gap on a few frames of a clip (step 2) and the numbers appear here.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-6">
          <section aria-label="Offsets from your marks">
            <h3 className="text-sm font-bold">What your marks say about the app</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-left text-sm">
                <caption className="sr-only">Offset per foot, fitted from the marks</caption>
                <thead className="text-xs uppercase tracking-wider text-muted">
                  <tr>
                    {["Foot", "Marks", "Add to the app's reading", "Scatter (±)"].map((h) => (
                      <th key={h} scope="col" className={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {(["left", "right"] as const).map((s) => (
                    <tr key={s}>
                      <td className={`${td} capitalize`}>{s}</td>
                      <td className={td}>{fit[s].n}</td>
                      <td className={`${td} font-bold`}>
                        {fit[s].n ? `${f1(fit[s].offsetDeg, true)}°` : "—"}
                        {Number.isFinite(fit[s].seDeg) && <span className="ml-1 text-xs font-normal text-muted">(± {f1(fit[s].seDeg)} s.e.)</span>}
                      </td>
                      <td className={td}>{fit[s].n > 1 ? `${f1(fit[s].sdDeg)}°` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {warnings.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-warn">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted">
              The app reads the principal axis of each foot&apos;s silhouette; you measure heel centre → toe gap. The offset is the mean of (you − app) over your
              marks, in frames where both use the same walking direction. It comes from the feet you marked, and foot shapes differ: the more different
              feet you mark, the better it carries over to other people.
            </p>
          </section>

          <section aria-label="Check on each clip">
            <h3 className="text-sm font-bold">What the app would read on your clips, with these offsets</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <caption className="sr-only">Your mean per foot next to the app&apos;s reading without and with the offsets</caption>
                <thead className="text-xs uppercase tracking-wider text-muted">
                  <tr>
                    {["Clip", "Foot", "You (mean, n)", "App now", "App with offset", "Off by now → after"].map((h) => (
                      <th key={h} scope="col" className={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {rows.flatMap((r) =>
                    (["left", "right"] as const).map((s) => {
                      const you = r.means[s];
                      const raw = s === "left" ? r.analysis.result.leftDeg : r.analysis.result.rightDeg;
                      const cal = s === "left" ? r.cal.leftDeg : r.cal.rightDeg;
                      return (
                        <tr key={`${r.clip.id}-${s}`} className={you ? "" : "text-muted"}>
                          <td className={`${td} max-w-40 truncate`} title={r.clip.name}>
                            {s === "left" ? r.clip.name : ""}
                          </td>
                          <td className={`${td} capitalize`}>{s}</td>
                          <td className={td}>{you ? `${f1(you.mean, true)}° (${you.n}${you.n > 1 ? `, ±${f1(you.sd)}` : ""})` : "no marks"}</td>
                          <td className={td}>{raw === null ? "—" : `${f1(raw, true)}°`}</td>
                          <td className={td}>{cal === null ? "—" : `${f1(cal, true)}°`}</td>
                          <td className={td}>
                            {you && raw !== null && cal !== null ? `${f1(raw - you.mean, true)}° → ${f1(cal - you.mean, true)}°` : "—"}
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
            {Number.isFinite(rawMae) && (
              <p className="mt-2 text-sm" role="status">
                Mean absolute difference from your marks: <strong>{f1(rawMae)}°</strong> now → <strong>{f1(calMae)}°</strong> with these offsets
                (over {diffs("raw").length} foot readings, on the clips you marked).
                {diffs("raw").length < 6 && " That is too few readings to say which is closer: mark more frames and clips."}
              </p>
            )}
            <p className="mt-1 text-xs text-muted">
              The app&apos;s clip reading averages every stance it found; you marked a few frames, so some difference is real step-to-step variation, and
              if you drew your own walking line it also includes any error in the app&apos;s walking direction. This is a check on your clips, not a
              measurement of accuracy for other people.
            </p>
          </section>

          <section aria-label="Walking direction method">
            <h3 className="text-sm font-bold">How the app finds the walking direction</h3>
            {methodRows ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-left text-sm">
                  <caption className="sr-only">Each method&apos;s difference from your marks on clips measured against your own line</caption>
                  <thead className="text-xs uppercase tracking-wider text-muted">
                    <tr>
                      {["Method", "Readings", "Mean absolute difference"].map((h) => (
                        <th key={h} scope="col" className={th}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {methodRows.map((r) => (
                      <tr key={r.m} className={r.m === method ? "font-bold" : ""}>
                        <td className={td}>
                          {HEADING_METHODS[r.m].label}
                          {r.m === method ? " · selected" : ""}
                        </td>
                        <td className={td}>{r.n}</td>
                        <td className={td}>{Number.isFinite(r.mae) ? `${f1(r.mae)}°` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted">
                To compare the ways of finding the walking direction, draw your own walking line on at least one clip (step 2): with the app&apos;s direction
                the comparison would be circular.
              </p>
            )}
            <Field label="Method to use">
              <select
                id="cal-method"
                className={inputCls}
                value={method}
                onChange={(e) => onMethod(e.target.value as HeadingMethod)}
              >
                {(Object.keys(HEADING_METHODS) as HeadingMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {HEADING_METHODS[m].label} — {HEADING_METHODS[m].description}
                  </option>
                ))}
              </select>
            </Field>
          </section>

          <section aria-label="Use this calibration" className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="text-sm font-bold">Use it</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {(["left", "right"] as const).map((s) => (
                <Field key={s} label={`${s === "left" ? "Left" : "Right"} offset (°)`} hint={`Fitted from your marks: ${f1(fittedBy[s], true)}°`}>
                  <input
                    id={`cal-${s}`}
                    type="number"
                    step={0.1}
                    min={-MAX_OFFSET_DEG}
                    max={MAX_OFFSET_DEG}
                    className={inputCls}
                    value={edit ? edit[s] : String(fittedBy[s])}
                    onChange={(e) =>
                      setEdit((prev) => ({
                        left: prev?.left ?? String(fittedLeft),
                        right: prev?.right ?? String(fittedRight),
                        [s]: e.target.value,
                      }))
                    }
                  />
                </Field>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button onClick={apply} id="cal-apply">
                Use on this device
              </Button>
              <Button variant="secondary" onClick={() => void copyLine()}>
                Copy the line for config.ts
              </Button>
              <Button variant="secondary" onClick={saveLabels} disabled={!rows.some((r) => r.means.left && r.means.right)}>
                Download labels.csv
              </Button>
              {edit && (
                <Button variant="ghost" onClick={() => setEdit(null)}>
                  Use the fitted values
                </Button>
              )}
              {saved && (
                <Button variant="ghost" onClick={reset}>
                  Reset this device
                </Button>
              )}
            </div>
            {message && (
              <p role="status" className={`mt-3 rounded-xl border p-3 text-sm ${message.ok ? "border-ok/40 bg-ok/10" : "border-warn/40 bg-warn/10"}`}>
                {message.text}
              </p>
            )}
            <p className="mt-3 text-xs text-muted">To ship it to every user (a saved calibration only applies in this browser), paste this line over DEFAULT_CALIBRATION in src/lib/config.ts:</p>
            <pre className="mt-1 overflow-x-auto rounded-lg border border-line bg-black/30 p-2 text-xs">{configSnippet(current)}</pre>
            <p className="mt-2 text-xs text-muted">
              labels.csv has one row per clip with marks on both feet (your mean per foot), for <code>npm run validate</code>. Save recorded clips from the list in step 1 and put
              them next to it.
            </p>
          </section>
        </div>
      )}
    </Card>
  );
}
