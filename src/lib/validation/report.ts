import { VALIDATION_TARGET_MAE_DEG, type CaptureMode } from "../config";
import type { ClipOutcome, Metrics } from "./metrics";

export interface PresetRun {
  id: string;
  label: string;
  outcomes: ClipOutcome[];
  metrics: Metrics;
}

export interface Verdict {
  level: "pass" | "fail" | "insufficient";
  headline: string;
  details: string[];
  /** what to try next, most relevant first (empty on a pass) */
  proposals: string[];
}

export interface ValidationReport {
  generatedAt: string;
  settings: Record<string, string | number | boolean>;
  /** first entry is the app's default estimator; the verdict is about it */
  presets: PresetRun[];
  verdict: Verdict;
  notes: {
    csvErrors: string[];
    csvRowsWithoutFile: string[];
    filesWithoutCsvRow: string[];
    /** videos that could not even be decoded / parsed */
    loadErrors: string[];
  };
}

export const fmt = (v: number | null | undefined, digits = 1, signed = false): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = v.toFixed(digits);
  return signed && v > 0 ? `+${s}` : s;
};

/** Generic fixes to try, per capture mode (data-specific ones are added first by buildVerdict). */
const MODE_PROPOSALS: Record<CaptureMode, string[]> = {
  front: [
    "Camera placement: a lower camera sees feet almost edge-on, so the foot's depth direction is squeezed into a few pixels. Try ~0.8–1 m height tilted slightly down, 2–3 m start distance, 1080p or better, the person centred in the frame.",
    "Smoothing: increase smoothing and the stance trim, or lengthen the minimum stance, in /debug and look at whether the per-frame angles inside a step settle (the 'scatter' column). Re-run /validate on saved landmarks (no re-decode needed).",
    "Step filtering: require at least 3 steps per foot, drop steps measured far from the camera (tiny feet), and weight the closer steps more.",
    "Model: try the heavy pose model (npm run setup -- --model heavy). It is slower but localises feet better.",
  ],
  topdown: [
    "Segmentation first: open the worst videos in /debug (top-down view) and check that the axes sit on the feet. Wrong blobs (a rug, a shadow, shorts, a foot cut off by the frame edge) cause most big errors. Bare feet on a plain, evenly lit floor work best; the thresholds (floor distance, hue window, texture) are in src/lib/topdown/segment.ts.",
    "Keep the phone steady and pointing straight down: phone yaw sway and tilt feed almost one-for-one into the angles, and a wrong walking direction moves the left and right feet in OPPOSITE directions (so it also shows up as false asymmetry while the average toe-out stays right). Compare the walking direction ψ that /debug reports with how you actually walked.",
    "Axis definition: the app measures the foot's long axis (principal axis of the foot silhouette, ankle trimmed), which can differ by a few degrees from the hand-measured axis (heel centre to the point between the big toe and the next toe). If the errors are a consistent offset per foot, set angleOffsetLeftDeg / angleOffsetRightDeg in src/lib/topdown/analyze.ts (the report shows the bias per foot).",
    "More stance phases: record the full 10 seconds of normal walking (at least 6 steps) so each foot gets 3+ clean planted phases. A standing-still clip gives one reading per foot and no walking direction (the phone's top edge is then assumed to point forward).",
  ],
};

const SLOPE_ADVICE: Record<CaptureMode, string> = {
  front:
    "A larger heel–toe separation in the image should help: raise the phone to roughly 0.8–1 m and tilt it down slightly, and start closer (about 2–3 m).",
  topdown:
    "Check the foot shapes in /debug: if the ankle / shin or a rug stripe is included in a blob, or the trimming cut the foot short, the axis is pulled toward vertical.",
};

const FAILED_ADVICE: Record<CaptureMode, string> = {
  front: "usually the feet were clipped at the frame edge, the approach was too short, or visibility fell below the threshold.",
  topdown: "usually the feet were not found (floor too similar to skin, shadows, busy patterns) or were cut off by the frame edge.",
};

const LAST_RESORT: Record<CaptureMode, string> = {
  front:
    "If the correlation stays weak after these, a single phone camera at this angle may simply not carry enough information about foot rotation; consider a different viewpoint (side or rear) or dropping the numeric angle from the product.",
  topdown:
    "If the correlation stays weak after these, the colour-based foot finder is probably the limit: a learned foot segmentation model (for example a small model trained on top-down foot photos) would be the next step.",
};

/**
 * Turns metrics into a plain-language verdict. Never states more than the data supports: a pass is hedged
 * by the sample size, a fail says plainly what that means for the app.
 */
export function buildVerdict(
  presets: PresetRun[],
  target: number = VALIDATION_TARGET_MAE_DEG,
  mode: CaptureMode = "front",
): Verdict {
  const main = presets[0];
  const m = main.metrics;
  const details: string[] = [];
  const proposals: string[] = [];

  if (m.nAnalysed < 3) {
    return {
      level: "insufficient",
      headline: `Only ${m.nAnalysed} of ${m.nClips} videos could be analysed — too few to say anything about accuracy.`,
      details: m.nFailed ? [`${m.nFailed} video(s) produced no reading. Open them in /debug to see why.`] : [],
      proposals: [],
    };
  }

  if (m.nFailed > 0) {
    details.push(
      `${m.nFailed} of ${m.nClips} videos gave no reading and are NOT in the error figures below (the app would show those users a "try again" screen).`,
    );
  }
  if (Number.isFinite(m.baselineMae)) {
    const better = m.mae < m.baselineMae * 0.8;
    const followsPeople = Number.isFinite(m.correlation) && m.correlation >= 0.7 && m.maeAfterBias < m.baselineMae * 0.8;
    let tail: string;
    if (better) tail = " (clearly better than guessing).";
    else if (followsPeople) {
      tail = ", but the readings do follow real differences between people (see the correlation); most of the error is a constant offset (below).";
    } else {
      tail = " — that is not clearly better than guessing, so it is not yet tracking real differences between people.";
    }
    details.push(
      `Guessing the same average angle for everyone would give an MAE of ${fmt(m.baselineMae)}°; the estimator gives ${fmt(m.mae)}°${tail}`,
    );
  }
  if (Number.isFinite(m.correlation)) {
    details.push(`Correlation with the hand measurements: r = ${fmt(m.correlation, 2)}; slope ${fmt(m.slope, 2)} (1.00 would be a perfect scale).`);
  }
  details.push(
    `${Math.round(m.within5 * 100)}% of foot readings are within 5° of the hand measurement; the worst is off by ${fmt(m.maxAbs)}°. The left/right difference is read to within ${fmt(m.asymmetryMae)}° on average.`,
  );

  if (m.mae <= target) {
    // A pass is only meaningful if it beats "everyone has the average angle": real feet vary by several degrees
    // between people, so guessing the mean can already land under 5 degrees.
    const beatsGuessing = !Number.isFinite(m.baselineMae) || m.mae < m.baselineMae * 0.8;
    return {
      level: "pass",
      headline: beatsGuessing
        ? `Mean absolute error ${fmt(m.mae)}° is within the ~${target}° target on ${m.nAnalysed} videos. That is a small sample from one setup — promising, not proven.`
        : `Mean absolute error ${fmt(m.mae)}° is within the ~${target}° target on ${m.nAnalysed} videos, BUT it is not clearly better than guessing the same average angle for everyone (${fmt(m.baselineMae)}°), so this pass does not show that the estimator measures anything. Use videos with clearly different foot angles (toe-in, straight, toe-out) to test it.`,
      details,
      proposals: [],
    };
  }

  // ---- failing: say so plainly and propose fixes, data-specific ones first --------------------------------
  const alt = presets
    .slice(1)
    .filter((p) => p.metrics.nAnalysed >= 3)
    .sort((a, b) => a.metrics.mae - b.metrics.mae)[0];
  if (alt && alt.metrics.mae < m.mae - 0.5) {
    proposals.push(
      `Switch estimator: "${alt.label}" has MAE ${fmt(alt.metrics.mae)}° on these videos versus ${fmt(m.mae)}° for the current default. Change the defaults in src/lib/analysis/options.ts and re-validate.`,
    );
  }
  if (Math.abs(m.biasLeft) >= 2 || Math.abs(m.biasRight) >= 2) {
    proposals.push(
      `Systematic offset: left feet read ${fmt(m.biasLeft, 1, true)}° and right feet ${fmt(m.biasRight, 1, true)}° versus your measurements. Removing that offset would give MAE ${fmt(m.maeAfterBias)}° — but that is fitted on these same videos, so confirm it on fresh ones before trusting it. ${mode === "topdown" ? "A constant offset often comes from how the foot axis is defined (silhouette axis vs heel-to-second-toe), or from the phone being held rotated." : "A constant offset often comes from where the model puts the heel / foot-index points."}`,
    );
  }
  if (Number.isFinite(m.slope) && m.slope < 0.6) {
    proposals.push(
      `Readings are squashed toward the average (slope ${fmt(m.slope, 2)}): people with clearly turned-out or turned-in feet look nearly average. ${SLOPE_ADVICE[mode]}`,
    );
  }
  proposals.push(...MODE_PROPOSALS[mode]);
  if (m.nFailed > 0) {
    proposals.push(`Check the ${m.nFailed} failed video(s) in /debug — ${FAILED_ADVICE[mode]}`);
  }
  proposals.push(LAST_RESORT[mode]);

  return {
    level: "fail",
    headline: `Mean absolute error ${fmt(m.mae)}° is ABOVE the ~${target}° target on ${m.nAnalysed} videos. These angles are not accurate enough to present as measurements; the score is entertainment-grade only.`,
    details,
    proposals,
  };
}

// ---------- formatting ----------------------------------------------------------------------------------

const pad = (s: string, n: number) => s.padEnd(n);

/** Plain-text table for the terminal. */
export function formatTerminalTable(outcomes: ClipOutcome[], m: Metrics): string {
  const head = ["video", "true L", "true R", "pred L", "pred R", "err L", "err R", "steps L/R", "status"];
  const rows = outcomes.map((o) => [
    o.video,
    fmt(o.trueL),
    fmt(o.trueR),
    fmt(o.predL),
    fmt(o.predR),
    o.predL === null ? "—" : fmt(o.predL - o.trueL, 1, true),
    o.predR === null ? "—" : fmt(o.predR - o.trueR, 1, true),
    `${o.stepsL}/${o.stepsR}`,
    o.failure ? `FAILED: ${o.failure}` : o.quality,
  ]);
  rows.push(["MAE", "", "", "", "", fmt(m.maeLeft), fmt(m.maeRight), "", `overall ${fmt(m.mae)}°`]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => pad(c, widths[i])).join("  ");
  return [line(head), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

export function formatCsv(outcomes: ClipOutcome[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = ["video,true_left_deg,true_right_deg,pred_left_deg,pred_right_deg,err_left_deg,err_right_deg,steps_left,steps_right,quality,failure"];
  for (const o of outcomes) {
    lines.push(
      [
        q(o.video),
        o.trueL,
        o.trueR,
        o.predL === null ? "" : o.predL.toFixed(2),
        o.predR === null ? "" : o.predR.toFixed(2),
        o.predL === null ? "" : (o.predL - o.trueL).toFixed(2),
        o.predR === null ? "" : (o.predR - o.trueR).toFixed(2),
        o.stepsL,
        o.stepsR,
        q(o.quality),
        q(o.failure ?? ""),
      ].join(","),
    );
  }
  return lines.join("\n");
}

export function formatMarkdown(report: ValidationReport): string {
  const main = report.presets[0];
  const m = main.metrics;
  const out: string[] = [];
  out.push("# Walk Score validation", "");
  out.push(`Generated ${report.generatedAt} · ${m.nClips} videos (${m.nAnalysed} analysed, ${m.nFailed} without a reading)`, "");

  out.push("## Verdict", "", `**${report.verdict.level.toUpperCase()} — ${report.verdict.headline}**`, "");
  report.verdict.details.forEach((d) => out.push(`- ${d}`));
  if (report.verdict.proposals.length) {
    out.push("", "### Suggested fixes", "");
    report.verdict.proposals.forEach((p, i) => out.push(`${i + 1}. ${p}`));
  }

  out.push("", `## Per-video results — ${main.label}`, "");
  out.push("| Video | True L | True R | Pred L | Pred R | Err L | Err R | Steps L/R | Status |");
  out.push("|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const o of main.outcomes) {
    out.push(
      `| ${o.video} | ${fmt(o.trueL)} | ${fmt(o.trueR)} | ${fmt(o.predL)} | ${fmt(o.predR)} | ${o.predL === null ? "—" : fmt(o.predL - o.trueL, 1, true)} | ${o.predR === null ? "—" : fmt(o.predR - o.trueR, 1, true)} | ${o.stepsL}/${o.stepsR} | ${o.failure ? `FAILED: ${o.failure}` : o.quality} |`,
    );
  }
  out.push(`| **MAE** | | | | | **${fmt(m.maeLeft)}** | **${fmt(m.maeRight)}** | | **overall ${fmt(m.mae)}°** |`);

  out.push("", "## Metrics (default estimator)", "", "| Metric | Value |", "|---|---:|");
  const rows: Array<[string, string]> = [
    ["Mean absolute error (all feet)", `${fmt(m.mae)}°`],
    ["MAE left / right", `${fmt(m.maeLeft)}° / ${fmt(m.maeRight)}°`],
    ["Bias left / right (prediction − truth)", `${fmt(m.biasLeft, 1, true)}° / ${fmt(m.biasRight, 1, true)}°`],
    ["RMSE", `${fmt(m.rmse)}°`],
    ["Worst single reading", `${fmt(m.maxAbs)}°`],
    ["Readings within 5°", `${Math.round(m.within5 * 100)}%`],
    ["No-skill baseline MAE (guess the average)", `${fmt(m.baselineMae)}°`],
    ["MAE after removing bias (in-sample)", `${fmt(m.maeAfterBias)}°`],
    ["Correlation r / slope", `${fmt(m.correlation, 2)} / ${fmt(m.slope, 2)}`],
    ["Left–right difference error", `${fmt(m.asymmetryMae)}°`],
  ];
  rows.forEach(([k, v]) => out.push(`| ${k} | ${v} |`));

  out.push("", "## Estimator presets compared", "", "| Preset | Clips analysed | MAE | Bias L / R | r | Within 5° |", "|---|---:|---:|---:|---:|---:|");
  for (const p of report.presets) {
    const pm = p.metrics;
    out.push(
      `| ${p.label} | ${pm.nAnalysed}/${pm.nClips} | ${fmt(pm.mae)}° | ${fmt(pm.biasLeft, 1, true)} / ${fmt(pm.biasRight, 1, true)} | ${fmt(pm.correlation, 2)} | ${Number.isFinite(pm.within5) ? Math.round(pm.within5 * 100) + "%" : "—"} |`,
    );
  }

  const n = report.notes;
  if (n.csvErrors.length || n.csvRowsWithoutFile.length || n.filesWithoutCsvRow.length || n.loadErrors.length) {
    out.push("", "## Input problems", "");
    n.csvErrors.forEach((e) => out.push(`- CSV: ${e}`));
    n.csvRowsWithoutFile.forEach((e) => out.push(`- CSV row without a file: ${e}`));
    n.filesWithoutCsvRow.forEach((e) => out.push(`- File without a CSV row (ignored): ${e}`));
    n.loadErrors.forEach((e) => out.push(`- Could not load: ${e}`));
  }

  out.push("", "## Settings", "");
  Object.entries(report.settings).forEach(([k, v]) => out.push(`- ${k}: ${String(v)}`));
  out.push(
    "",
    "_Angles are foot progression angles in degrees, toe-out positive, toe-in negative. Errors are prediction − hand measurement._",
  );
  return out.join("\n");
}
