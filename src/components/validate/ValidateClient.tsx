"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CAPTURE_MODE,
  POSE_ASSETS,
  VALIDATION_TARGET_MAE_DEG,
  analysisFps,
  type CaptureMode,
  type ModelVariant,
} from "@/lib/config";
import { serializeBundle } from "@/lib/landmarkFile";
import type { DelegateChoice, ExtractProgress } from "@/lib/pose/landmarker";
import { matchLabelsToFiles, parseLabelsCsv } from "@/lib/validation/csv";
import { formatCsv, formatMarkdown, formatTerminalTable, fmt, type ValidationReport } from "@/lib/validation/report";
import {
  buildReport,
  clipToLandmarkFile,
  extractClip,
  isLandmarkJson,
  readLandmarkJson,
  type ClipData,
  type ValidationEntry,
} from "@/lib/validation/run";
import { Button, Card, ScreenShell } from "../ui";

const inputCls = "rounded-lg border border-line bg-surface px-2 py-2 text-ink";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

function download(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Status = "idle" | "running" | "done" | "error";

interface RunProgress {
  current: number;
  total: number;
  name: string;
  frame: ExtractProgress | null;
}

interface RunSettings {
  mode: CaptureMode;
  model: ModelVariant;
  delegate: DelegateChoice;
  fps: number;
}

const errCls = (e: number) => (Math.abs(e) <= 5 ? "text-ok" : Math.abs(e) <= 10 ? "text-warn" : "text-danger");

export function ValidateClient() {
  const [csvText, setCsvText] = useState<string | null>(null);
  const [csvName, setCsvName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [cfg, setCfg] = useState<RunSettings & { swap: boolean }>({
    mode: CAPTURE_MODE,
    model: POSE_ASSETS.defaultVariant,
    delegate: "auto",
    fps: analysisFps(CAPTURE_MODE),
    swap: false,
  });
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ValidationEntry[] | null>(null);
  const [notes, setNotes] = useState<ValidationReport["notes"] | null>(null);
  const [runSettings, setRunSettings] = useState<RunSettings | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const report = useMemo<ValidationReport | null>(() => {
    if (!entries || !notes || !runSettings) return null;
    const delegates = [...new Set(entries.map((e) => e.clip?.meta?.delegate).filter(Boolean))].join(", ");
    return buildReport(entries, {
      mode: runSettings.mode,
      options: { pose: { swapLeftRight: cfg.swap }, topdown: { swapLeftRight: cfg.swap } },
      notes,
      settings: {
        ...(runSettings.mode === "front"
          ? {
              "pose model": runSettings.model,
              "delegate requested": runSettings.delegate,
              "delegate used": delegates || "n/a (saved landmarks)",
            }
          : {}),
        "analysis frames per second": runSettings.fps,
        "left/right swapped (mirrored videos)": cfg.swap,
        "target MAE (degrees)": VALIDATION_TARGET_MAE_DEG,
        browser: typeof navigator === "undefined" ? "" : navigator.userAgent,
      },
    });
  }, [entries, notes, runSettings, cfg.swap]);

  // Machine-readable result for scripts/validate.mjs (headless runs).
  useEffect(() => {
    const main = report?.presets[0];
    (window as unknown as { __WALKSCORE_VALIDATION__?: unknown }).__WALKSCORE_VALIDATION__ = {
      status,
      error,
      progress: progress ? { current: progress.current, total: progress.total, name: progress.name } : null,
      verdict: report?.verdict ?? null,
      mae: main?.metrics.mae ?? null,
      markdown: report ? formatMarkdown(report) : null,
      csv: main ? formatCsv(main.outcomes) : null,
      table: main ? formatTerminalTable(main.outcomes, main.metrics) : null,
    };
  }, [status, error, progress, report]);

  const run = async () => {
    setError(null);
    setEntries(null);
    setNotes(null);
    setStatus("running");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const settings: RunSettings = { mode: cfg.mode, model: cfg.model, delegate: cfg.delegate, fps: cfg.fps };
    try {
      if (!csvText) throw new Error("Choose the labels CSV first (video,left_deg,right_deg).");
      if (!files.length) throw new Error("Choose the videos (or saved landmark .json files).");
      const parsed = parseLabelsCsv(csvText);
      if (!parsed.rows.length) throw new Error(parsed.errors[0] ?? "The CSV has no rows.");

      const loadErrors: string[] = [];
      const sources: Array<{ name: string; file?: File; clip?: ClipData }> = [];
      for (const f of files) {
        if (isLandmarkJson(f)) {
          try {
            for (const c of await readLandmarkJson(f)) sources.push({ name: c.name, clip: c });
          } catch (e) {
            loadErrors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else sources.push({ name: f.name, file: f });
      }

      const m = matchLabelsToFiles(parsed.rows, sources);
      const out: ValidationEntry[] = [];
      let i = 0;
      for (const { row, item } of m.matches) {
        i++;
        const current = i;
        setProgress({ current, total: m.matches.length, name: row.video, frame: null });
        if (item.clip) {
          out.push({ row, clip: item.clip });
          continue;
        }
        try {
          const clip = await extractClip(item.file as File, {
            mode: settings.mode,
            fps: settings.fps,
            variant: settings.model,
            delegate: settings.delegate,
            maxSeconds: 60,
            signal: ctrl.signal,
            onProgress: (frame) => setProgress({ current, total: m.matches.length, name: row.video, frame }),
          });
          out.push({ row, clip: { ...clip, name: row.video } });
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") throw e;
          const msg = e instanceof Error ? e.message : String(e);
          out.push({ row, clip: null, loadError: msg });
          loadErrors.push(`${row.video}: ${msg}`);
        }
      }
      for (const row of m.missing) out.push({ row, clip: null, loadError: "no matching file selected" });
      out.sort((a, b) => a.row.line - b.row.line);

      setRunSettings(settings);
      setNotes({
        csvErrors: parsed.errors,
        csvRowsWithoutFile: m.missing.map((r) => r.video),
        filesWithoutCsvRow: m.unused.map((s) => s.name),
        loadErrors,
      });
      setEntries(out);
      setStatus("done");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setStatus("idle");
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const main = report?.presets[0];
  const v = report?.verdict;
  const verdictCls =
    v?.level === "pass" ? "border-ok/50 bg-ok/10" : v?.level === "fail" ? "border-danger/50 bg-danger/10" : "border-warn/50 bg-warn/10";

  return (
    <ScreenShell wide>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-extrabold tracking-[0.3em] text-accent">WALK SCORE · VALIDATION</p>
          <h1 className="mt-1 text-3xl font-extrabold">Validate against hand measurements</h1>
        </div>
        <Link href="/" className="text-sm underline">
          ← Back to the app
        </Link>
      </header>

      <Card>
        <h2 className="text-lg font-bold">What this does</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Runs the exact analysis the app uses on your test videos and compares it with your hand-measured angles. It reports the
          mean absolute error (MAE), a per-video table, and says plainly if the error is above ~{VALIDATION_TARGET_MAE_DEG}°. Videos
          are decoded in this browser and never uploaded.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>
            CSV columns: <code className="font-mono text-ink">video,left_deg,right_deg</code>. Angles are foot progression angles in
            degrees: <strong className="text-ink">toe-out positive, toe-in negative</strong>, measured against the walking direction,
            left/right = the person&apos;s own feet.
          </li>
          <li>Pick the capture mode that matches how the videos were recorded (top-down, phone held over the feet, is the default).</li>
          <li>Select the videos together (file names must match the CSV). Saved .json files from /debug or an earlier run also work and run instantly.</li>
          <li>Prefer a terminal? <code className="font-mono text-ink">npm run validate</code> drives this page headlessly (see README).</li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">1 · Inputs</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Labels CSV" hint={csvName ? `Loaded: ${csvName}` : "video,left_deg,right_deg"}>
            <input
              id="labels-input"
              type="file"
              accept=".csv,text/csv,text/plain"
              className={inputCls}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setCsvText(await f.text());
                  setCsvName(f.name);
                }
              }}
            />
          </Field>
          <Field label="Videos (or landmark .json files)" hint={files.length ? `${files.length} file(s) selected` : "Select all of them at once"}>
            <input
              id="clips-input"
              type="file"
              multiple
              accept="video/*,.json,application/json"
              className={inputCls}
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </Field>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Capture mode" hint="Which kind of video these are">
            <select
              id="val-mode"
              className={inputCls}
              value={cfg.mode}
              onChange={(e) => {
                const mode = e.target.value as CaptureMode;
                setCfg((c) => ({ ...c, mode, fps: analysisFps(mode) }));
              }}
            >
              <option value="topdown">Top-down: phone held over the feet</option>
              <option value="front">Front view: phone on the floor (pose model)</option>
            </select>
          </Field>
          {cfg.mode === "front" && (
            <>
              <Field label="Pose model">
                <select id="val-model" className={inputCls} value={cfg.model} onChange={(e) => setCfg((c) => ({ ...c, model: e.target.value as ModelVariant }))}>
                  <option value="lite">lite</option>
                  <option value="full">full</option>
                  <option value="heavy">heavy</option>
                </select>
              </Field>
              <Field label="Delegate">
                <select id="val-delegate" className={inputCls} value={cfg.delegate} onChange={(e) => setCfg((c) => ({ ...c, delegate: e.target.value as DelegateChoice }))}>
                  <option value="auto">auto (GPU, then CPU)</option>
                  <option value="GPU">GPU</option>
                  <option value="CPU">CPU</option>
                </select>
              </Field>
            </>
          )}
          <Field label="Frames per second">
            <input
              id="val-fps"
              type="number"
              min={10}
              max={60}
              className={inputCls}
              value={cfg.fps}
              onChange={(e) => setCfg((c) => ({ ...c, fps: Math.min(60, Math.max(10, Number(e.target.value) || analysisFps(c.mode))) }))}
            />
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input id="val-swap" type="checkbox" checked={cfg.swap} onChange={(e) => setCfg((c) => ({ ...c, swap: e.target.checked }))} />
              Videos are mirrored (swap L/R)
            </label>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button id="run-validation" onClick={() => void run()} disabled={status === "running"}>
            {status === "running" ? "Running…" : "Run validation"}
          </Button>
          {status === "running" && (
            <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
              Cancel
            </Button>
          )}
          {progress && (
            <span className="text-sm text-muted" aria-live="polite">
              Video {progress.current}/{progress.total}: {progress.name}
              {progress.frame ? ` — ${progress.frame.stage} ${progress.frame.done}/${progress.frame.total}` : ""}
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </p>
        )}
      </Card>

      {report && main && v && (
        <>
          <section aria-label="Verdict" className={`rounded-3xl border p-5 ${verdictCls}`}>
            <h2 className="text-xl font-extrabold">
              {v.level === "pass" ? "Within target" : v.level === "fail" ? "Above target" : "Not enough data"}
            </h2>
            <p className="mt-2 text-base font-semibold">{v.headline}</p>
            {v.details.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {v.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
            {v.proposals.length > 0 && (
              <>
                <h3 className="mt-4 font-bold">Suggested fixes</h3>
                <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
                  {v.proposals.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ol>
              </>
            )}
          </section>

          <Card>
            <h2 className="text-lg font-bold">Headline numbers (default estimator)</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-6">
              {[
                ["MAE (all feet)", `${fmt(main.metrics.mae)}°`],
                ["MAE left / right", `${fmt(main.metrics.maeLeft)}° / ${fmt(main.metrics.maeRight)}°`],
                ["Bias left / right", `${fmt(main.metrics.biasLeft, 1, true)}° / ${fmt(main.metrics.biasRight, 1, true)}°`],
                ["Within 5°", Number.isFinite(main.metrics.within5) ? `${Math.round(main.metrics.within5 * 100)}%` : "—"],
                ["Guess-the-average MAE", `${fmt(main.metrics.baselineMae)}°`],
                ["Correlation r", fmt(main.metrics.correlation, 2)],
                ["Slope", fmt(main.metrics.slope, 2)],
                ["L–R difference error", `${fmt(main.metrics.asymmetryMae)}°`],
                ["Worst reading", `${fmt(main.metrics.maxAbs)}°`],
                ["Analysed", `${main.metrics.nAnalysed}/${main.metrics.nClips}`],
              ].map(([k, val]) => (
                <div key={k} className="rounded-xl border border-line bg-surface p-2">
                  <dt className="text-xs uppercase tracking-wider text-muted">{k}</dt>
                  <dd className="mt-0.5 text-lg font-bold tabular-nums">{val}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-bold">Per-video results — {main.label}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <caption className="sr-only">Hand-measured versus estimated foot angles for each video</caption>
                <thead className="text-xs uppercase tracking-wider text-muted">
                  <tr>
                    {["Video", "True L", "True R", "Pred L", "Pred R", "Err L", "Err R", "Steps L/R", "Status"].map((h) => (
                      <th key={h} scope="col" className="border-b border-line px-2 py-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {main.outcomes.map((o) => (
                    <tr key={o.video}>
                      <th scope="row" className="border-b border-line/60 px-2 py-1.5 font-semibold">
                        {o.video}
                      </th>
                      <td className="border-b border-line/60 px-2 py-1.5">{fmt(o.trueL)}</td>
                      <td className="border-b border-line/60 px-2 py-1.5">{fmt(o.trueR)}</td>
                      <td className="border-b border-line/60 px-2 py-1.5">{fmt(o.predL)}</td>
                      <td className="border-b border-line/60 px-2 py-1.5">{fmt(o.predR)}</td>
                      <td className={`border-b border-line/60 px-2 py-1.5 font-bold ${o.predL === null ? "" : errCls(o.predL - o.trueL)}`}>
                        {o.predL === null ? "—" : fmt(o.predL - o.trueL, 1, true)}
                      </td>
                      <td className={`border-b border-line/60 px-2 py-1.5 font-bold ${o.predR === null ? "" : errCls(o.predR - o.trueR)}`}>
                        {o.predR === null ? "—" : fmt(o.predR - o.trueR, 1, true)}
                      </td>
                      <td className="border-b border-line/60 px-2 py-1.5">
                        {o.stepsL}/{o.stepsR}
                      </td>
                      <td className="border-b border-line/60 px-2 py-1.5">
                        {o.failure ? <span className="text-danger">failed: {o.failure}</span> : o.quality}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <th scope="row" className="px-2 py-2">
                      Mean absolute error
                    </th>
                    <td colSpan={4} />
                    <td className="px-2 py-2 tabular-nums">{fmt(main.metrics.maeLeft)}</td>
                    <td className="px-2 py-2 tabular-nums">{fmt(main.metrics.maeRight)}</td>
                    <td colSpan={2} className="px-2 py-2 tabular-nums">
                      overall {fmt(main.metrics.mae)}°
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">Errors are prediction − hand measurement, in degrees. Green ≤ 5°, amber ≤ 10°, red above.</p>
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-bold">Estimators compared on the same landmarks</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted">
                  <tr>
                    {["Preset", "Analysed", "MAE", "Bias L / R", "r", "Within 5°"].map((h) => (
                      <th key={h} scope="col" className="border-b border-line px-2 py-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {report.presets.map((p, i) => (
                    <tr key={p.id} className={i === 0 ? "font-semibold" : ""}>
                      <th scope="row" className="border-b border-line/60 px-2 py-1.5 text-left font-inherit">
                        {p.label}
                      </th>
                      <td className="border-b border-line/60 px-2 py-1.5">
                        {p.metrics.nAnalysed}/{p.metrics.nClips}
                      </td>
                      <td className="border-b border-line/60 px-2 py-1.5">{fmt(p.metrics.mae)}°</td>
                      <td className="border-b border-line/60 px-2 py-1.5">
                        {fmt(p.metrics.biasLeft, 1, true)} / {fmt(p.metrics.biasRight, 1, true)}
                      </td>
                      <td className="border-b border-line/60 px-2 py-1.5">{fmt(p.metrics.correlation, 2)}</td>
                      <td className="border-b border-line/60 px-2 py-1.5">
                        {Number.isFinite(p.metrics.within5) ? `${Math.round(p.metrics.within5 * 100)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {(report.notes.csvErrors.length > 0 ||
            report.notes.csvRowsWithoutFile.length > 0 ||
            report.notes.filesWithoutCsvRow.length > 0 ||
            report.notes.loadErrors.length > 0) && (
            <Card>
              <h2 className="text-lg font-bold">Input problems</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-warn">
                {report.notes.csvErrors.map((e) => (
                  <li key={`c${e}`}>CSV: {e}</li>
                ))}
                {report.notes.csvRowsWithoutFile.map((e) => (
                  <li key={`m${e}`}>CSV row without a selected file: {e}</li>
                ))}
                {report.notes.filesWithoutCsvRow.map((e) => (
                  <li key={`u${e}`}>Selected file without a CSV row (ignored): {e}</li>
                ))}
                {report.notes.loadErrors.map((e) => (
                  <li key={`l${e}`}>Could not load {e}</li>
                ))}
              </ul>
            </Card>
          )}

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => download(formatMarkdown(report), "walkscore-validation.md", "text/markdown")}>
              Download report (.md)
            </Button>
            <Button variant="secondary" onClick={() => download(formatCsv(main.outcomes), "walkscore-validation.csv", "text/csv")}>
              Download results (.csv)
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                download(
                  serializeBundle((entries ?? []).flatMap((e) => (e.clip ? [clipToLandmarkFile({ ...e.clip, name: e.row.video })] : []))),
                  "walkscore-landmarks.json",
                  "application/json",
                )
              }
            >
              Download landmarks (.json)
            </Button>
          </div>
          <p className="text-xs text-muted">
            The landmarks file lets you re-run this page (or /debug) instantly after changing thresholds, with no video decoding. It
            holds coordinates only: no pixels, no faces.
          </p>
        </>
      )}
    </ScreenShell>
  );
}
