import { describe, expect, it } from "vitest";
import { generateSyntheticWalk } from "../analysis/synthetic";
import { parseLandmarkText, serializeBundle, serializeLandmarkFile, type LandmarkFile } from "../landmarkFile";
import { TOPDOWN_PRESETS, analyzeTopDown } from "../topdown/analyze";
import { generateBlobWalk } from "../topdown/synthetic";
import { matchLabelsToFiles, parseLabelsCsv, splitCsvLine } from "./csv";
import { computeMetrics, type ClipOutcome } from "./metrics";
import { formatCsv, formatMarkdown, formatTerminalTable } from "./report";
import { buildReport, clipToLandmarkFile, type ClipData, type ValidationEntry } from "./run";

describe("parseLabelsCsv", () => {
  it("parses the documented format, BOM, CRLF, comments and quoted names", () => {
    const text = '﻿video,left_deg,right_deg\r\n# comment\r\nwalk01.mp4,12,5\r\n"walk, 02.mov",-3.5,8\r\n';
    const { rows, errors } = parseLabelsCsv(text);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { video: "walk01.mp4", leftDeg: 12, rightDeg: 5, line: 3 },
      { video: "walk, 02.mov", leftDeg: -3.5, rightDeg: 8, line: 4 },
    ]);
  });

  it("accepts alternative header names", () => {
    const { rows, errors } = parseLabelsCsv("file,left,right\na.mp4,1,2");
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ video: "a.mp4", leftDeg: 1, rightDeg: 2 });
  });

  it("reports bad rows and a bad header", () => {
    const bad = parseLabelsCsv("video,left_deg,right_deg\na.mp4,x,2\n,1,2\nb.mp4,3,4");
    expect(bad.rows).toHaveLength(1);
    expect(bad.errors).toHaveLength(2);
    expect(parseLabelsCsv("a,b,c\n1,2,3").errors[0]).toMatch(/header/);
    expect(parseLabelsCsv("").errors[0]).toMatch(/empty/);
  });

  it("splits quoted fields with escaped quotes", () => {
    expect(splitCsvLine('a,"b ""q"" c",d')).toEqual(["a", 'b "q" c', "d"]);
  });
});

describe("matchLabelsToFiles", () => {
  const rows = [
    { video: "walk01.mp4", leftDeg: 1, rightDeg: 2, line: 2 },
    { video: "clips/Walk02", leftDeg: 1, rightDeg: 2, line: 3 },
    { video: "gone.mp4", leftDeg: 1, rightDeg: 2, line: 4 },
  ];
  it("matches by base name, case-insensitively, with optional extension", () => {
    const files = [{ name: "WALK01.MP4" }, { name: "walk02.mov" }, { name: "extra.mp4" }];
    const m = matchLabelsToFiles(rows, files);
    expect(m.matches.map((x) => x.item.name)).toEqual(["WALK01.MP4", "walk02.mov"]);
    expect(m.missing.map((r) => r.video)).toEqual(["gone.mp4"]);
    expect(m.unused.map((f) => f.name)).toEqual(["extra.mp4"]);
  });
});

const outcome = (tl: number, tr: number, pl: number | null, pr: number | null): ClipOutcome => ({
  video: `${tl}/${tr}`,
  trueL: tl,
  trueR: tr,
  predL: pl,
  predR: pr,
  stepsL: 3,
  stepsR: 3,
  quality: "good",
  warnings: [],
});

describe("computeMetrics", () => {
  it("computes MAE, bias, baseline and failures", () => {
    const m = computeMetrics([outcome(10, 0, 12, 1), outcome(0, 10, -2, 7), outcome(5, 5, null, null)]);
    expect(m.nClips).toBe(3);
    expect(m.nAnalysed).toBe(2);
    expect(m.nFailed).toBe(1);
    expect(m.nValues).toBe(4);
    // errors: +2, +1 (clip 1), -2, -3 (clip 2)
    expect(m.mae).toBeCloseTo(2);
    expect(m.maeLeft).toBeCloseTo(2);
    expect(m.maeRight).toBeCloseTo(2);
    expect(m.biasLeft).toBeCloseTo(0);
    expect(m.biasRight).toBeCloseTo(-1);
    expect(m.within5).toBe(1);
    expect(m.maxAbs).toBe(3);
    // truth 10,0,0,10 -> mean 5 -> baseline MAE 5
    expect(m.baselineMae).toBeCloseTo(5);
  });

  it("reports perfect agreement as slope 1 and correlation 1", () => {
    const m = computeMetrics([outcome(10, 0, 10, 0), outcome(0, 10, 0, 10), outcome(5, 15, 5, 15)]);
    expect(m.mae).toBe(0);
    expect(m.slope).toBeCloseTo(1);
    expect(m.correlation).toBeCloseTo(1);
  });

  it("flags compressed predictions via the slope", () => {
    const m = computeMetrics([outcome(0, 0, 5, 5), outcome(10, 10, 6, 6), outcome(20, 20, 7, 7)]);
    expect(m.slope).toBeLessThan(0.2);
  });

  it("handles empty input without throwing", () => {
    const m = computeMetrics([]);
    expect(m.nClips).toBe(0);
    expect(Number.isNaN(m.mae)).toBe(true);
  });
});

function syntheticEntries(truthShift = 0): ValidationEntry[] {
  const cases: Array<[number, number]> = [[12, 5], [-3, 8], [6, 6], [18, 9], [0, 4], [10, -2]];
  return cases.map(([l, r], i) => {
    const g = generateSyntheticWalk({ leftDeg: l, rightDeg: r, noisePx: 2, noiseWorldM: 0.01, seed: 40 + i, startX: (i - 2.5) * 0.3 });
    const clip: ClipData = { kind: "pose", name: `walk${i + 1}.mp4`, video: g.video, frames: g.frames };
    return { row: { video: clip.name, leftDeg: l + truthShift, rightDeg: r + truthShift, line: i + 2 }, clip };
  });
}

describe("validation report on synthetic clips", () => {
  const notes = { csvErrors: [], csvRowsWithoutFile: [], filesWithoutCsvRow: [], loadErrors: [] };

  it("passes when predictions match the (synthetic) truth, and hedges the claim", () => {
    const report = buildReport(syntheticEntries(), { mode: "front", settings: { source: "synthetic" }, notes });
    expect(report.presets).toHaveLength(5);
    expect(report.presets[0].metrics.nAnalysed).toBe(6);
    expect(report.verdict.level).toBe("pass");
    expect(report.presets[0].metrics.mae).toBeLessThan(3);
    expect(report.verdict.headline).toMatch(/small sample/);
    expect(report.verdict.proposals).toEqual([]);
  });

  it("fails plainly and proposes fixes (incl. the bias) when predictions are off by 8°", () => {
    const report = buildReport(syntheticEntries(8), { mode: "front", settings: {}, notes });
    expect(report.verdict.level).toBe("fail");
    expect(report.verdict.headline).toMatch(/ABOVE/);
    expect(report.verdict.headline).toMatch(/entertainment-grade/);
    const text = report.verdict.proposals.join("\n");
    expect(text).toMatch(/Systematic offset/);
    expect(text).toMatch(/Camera placement/);
    expect(text).toMatch(/Smoothing/);
    expect(text).toMatch(/Step filtering/);
    // a constant offset must not be reported as "not tracking people": correlation stays high
    const details = report.verdict.details.join("\n");
    expect(details).toMatch(/constant offset/);
    expect(details).not.toMatch(/not yet tracking real differences/);
  });

  it("says the estimator is not tracking people when readings are uncorrelated with the truth", () => {
    // shuffle the truth so predictions are unrelated to it
    const entries = syntheticEntries();
    const truths = entries.map((e) => [e.row.leftDeg, e.row.rightDeg]);
    const shuffled = [3, 0, 5, 1, 4, 2].map((i) => truths[i]);
    entries.forEach((e, i) => {
      e.row = { ...e.row, leftDeg: shuffled[i][0] + 6, rightDeg: shuffled[i][1] + 6 };
    });
    const report = buildReport(entries, { mode: "front", settings: {}, notes });
    expect(report.verdict.level).toBe("fail");
    expect(report.verdict.details.join("\n")).toMatch(/not yet tracking real differences/);
  });

  it("is insufficient with fewer than 3 analysable clips", () => {
    const report = buildReport(syntheticEntries().slice(0, 2), { mode: "front", settings: {}, notes });
    expect(report.verdict.level).toBe("insufficient");
  });

  it("counts clips that fail to load as failures, not as zero error", () => {
    const entries = syntheticEntries();
    entries[0] = { ...entries[0], clip: null, loadError: "could not decode" };
    const report = buildReport(entries, { mode: "front", settings: {}, notes });
    expect(report.presets[0].metrics.nFailed).toBe(1);
    expect(report.presets[0].outcomes[0].failure).toBe("could not decode");
  });

  it("renders markdown, CSV and terminal tables", () => {
    const report = buildReport(syntheticEntries(), { mode: "front", settings: { model: "full" }, notes, generatedAt: "2026-01-01T00:00:00Z" });
    const md = formatMarkdown(report);
    expect(md).toContain("# Walk Score validation");
    expect(md).toContain("| Video | True L | True R |");
    expect(md).toContain("Estimator presets compared");
    expect(md).toContain("model: full");
    const csv = formatCsv(report.presets[0].outcomes);
    expect(csv.split("\n")).toHaveLength(7);
    expect(csv.split("\n")[0]).toMatch(/^video,true_left_deg/);
    const table = formatTerminalTable(report.presets[0].outcomes, report.presets[0].metrics);
    expect(table).toContain("walk1.mp4");
    expect(table).toContain("MAE");
  });
});

describe("landmark files", () => {
  const g = generateSyntheticWalk({ leftDeg: 9, rightDeg: 3 });
  const poseClip: ClipData = { kind: "pose", name: "demo.mp4", video: g.video, frames: g.frames, meta: { model: "full" } };
  const clip = clipToLandmarkFile(poseClip);

  it("round-trips a pose clip (to 4 decimals)", () => {
    const [back] = parseLandmarkText(serializeLandmarkFile(clip));
    expect(back.kind).toBe("pose");
    if (back.kind !== "pose" || clip.kind !== "pose") throw new Error("expected pose clips");
    expect(back.name).toBe("demo.mp4");
    expect(back.frames).toHaveLength(clip.frames.length);
    expect(back.frames[10].img?.[29].x).toBeCloseTo(clip.frames[10].img?.[29].x ?? 0, 3);
    expect(back.video.width).toBe(clip.video.width);
  });

  it("round-trips a bundle and frames without a pose", () => {
    if (clip.kind !== "pose") throw new Error("expected a pose clip");
    const withMissing: LandmarkFile = {
      ...clip,
      frames: clip.frames.map((f, i) => (i === 3 ? { t: f.t, ok: false, img: null, world: null } : f)),
    };
    const clips = parseLandmarkText(serializeBundle([withMissing, clip]));
    expect(clips).toHaveLength(2);
    const first = clips[0];
    if (first.kind !== "pose") throw new Error("expected a pose clip");
    expect(first.frames[3].ok).toBe(false);
    expect(first.frames[4].ok).toBe(true);
  });

  it("treats files written before `kind` existed as pose files", () => {
    const old = JSON.parse(serializeLandmarkFile(clip));
    delete old.kind;
    expect(parseLandmarkText(JSON.stringify(old))[0].kind).toBe("pose");
  });

  it("round-trips a top-down clip (feet blobs, clipped flag, to 5 decimals)", () => {
    const td = generateBlobWalk({ leftDeg: 12, rightDeg: 4, coverage: 1.0 });
    const file = clipToLandmarkFile({ kind: "topdown", name: "feet.mp4", video: td.video, frames: td.frames });
    const [back] = parseLandmarkText(serializeLandmarkFile(file));
    expect(back.kind).toBe("topdown");
    if (back.kind !== "topdown") throw new Error("expected a top-down clip");
    expect(back.frames).toHaveLength(td.frames.length);
    const i = td.frames.findIndex((f) => f.blobs.length === 2);
    expect(back.frames[i].blobs[1].ux).toBeCloseTo(td.frames[i].blobs[1].ux, 4);
    expect(back.frames[i].blobs.map((b) => b.clipped)).toEqual(td.frames[i].blobs.map((b) => b.clipped));
    // and the analysis gives the same answer before and after saving
    const before = analyzeTopDown(td.frames, td.video);
    const after = analyzeTopDown(back.frames, back.video);
    expect(after.leftDeg).toBeCloseTo(before.leftDeg ?? NaN, 1);
  });

  it("rejects things that are not landmark files", () => {
    expect(() => parseLandmarkText("not json")).toThrow(/JSON/);
    expect(() => parseLandmarkText('{"hello":1}')).toThrow(/Walk Score landmark file/);
  });
});

describe("validation report in top-down mode", () => {
  const notes = { csvErrors: [], csvRowsWithoutFile: [], filesWithoutCsvRow: [], loadErrors: [] };

  function topdownEntries(shift = 0): ValidationEntry[] {
    const cases: Array<[number, number]> = [[12, 5], [-3, 8], [6, 6], [18, 9], [0, 4], [10, -2]];
    return cases.map(([l, r], i) => {
      const g = generateBlobWalk({ leftDeg: l, rightDeg: r, angleNoiseDeg: 1.5, posNoisePx: 0.6, seed: 70 + i });
      const clip: ClipData = { kind: "topdown", name: `feet${i + 1}.mp4`, video: g.video, frames: g.frames };
      return { row: { video: clip.name, leftDeg: l + shift, rightDeg: r + shift, line: i + 2 }, clip };
    });
  }

  it("uses the top-down presets and passes on clean synthetic clips", () => {
    const report = buildReport(topdownEntries(), { mode: "topdown", settings: {}, notes });
    expect(report.presets.map((p) => p.id)).toEqual(TOPDOWN_PRESETS.map((p) => p.id));
    expect(report.settings["capture mode"]).toMatch(/top-down/);
    expect(report.presets[0].metrics.nAnalysed).toBe(6);
    expect(report.verdict.level).toBe("pass");
    expect(report.presets[0].metrics.mae).toBeLessThan(2);
  });

  it("gives top-down advice (segmentation, phone steadiness), not front-view camera advice", () => {
    const report = buildReport(topdownEntries(8), { mode: "topdown", settings: {}, notes });
    expect(report.verdict.level).toBe("fail");
    const text = report.verdict.proposals.join("\n");
    expect(text).toMatch(/Segmentation first/);
    expect(text).toMatch(/phone steady/);
    expect(text).toMatch(/OPPOSITE/);
    expect(text).not.toMatch(/Camera placement/);
    expect(text).not.toMatch(/heavy pose model/);
  });

  it("does not call a pass meaningful when the videos barely differ and guessing the average would pass too", () => {
    // everyone has nearly the same angles, so "guess the mean" has a tiny error; our readings are ~2.5 degrees off
    const entries: ValidationEntry[] = [0, 1, 2, 3, 4, 5].map((i) => {
      const l = 5 + (i % 2) * 0.6;
      const r = 5 + (i % 3) * 0.4;
      const g = generateBlobWalk({ leftDeg: l, rightDeg: r, angleNoiseDeg: 1, seed: 90 + i });
      const clip: ClipData = { kind: "topdown", name: `same${i}.mp4`, video: g.video, frames: g.frames };
      return { row: { video: clip.name, leftDeg: l - 2.5, rightDeg: r - 2.5, line: i + 2 }, clip };
    });
    const report = buildReport(entries, { mode: "topdown", settings: {}, notes });
    const m = report.presets[0].metrics;
    expect(m.baselineMae).toBeLessThan(1);
    expect(m.mae).toBeLessThan(5);
    expect(report.verdict.level).toBe("pass");
    expect(report.verdict.headline).toMatch(/not clearly better than guessing/);
  });

  it("counts a clip of the wrong kind as a failure with a clear reason", () => {
    const entries = topdownEntries();
    const g = generateSyntheticWalk({ leftDeg: 5, rightDeg: 5 });
    entries[0] = { ...entries[0], clip: { kind: "pose", name: "front.mp4", video: g.video, frames: g.frames } };
    const report = buildReport(entries, { mode: "topdown", settings: {}, notes });
    expect(report.presets[0].outcomes[0].failure).toMatch(/front-view landmark file but the run is in top-down mode/);
    expect(report.presets[0].metrics.nFailed).toBe(1);
  });

  it("marks standing clips in the status column", () => {
    const g = generateBlobWalk({ leftDeg: 5, rightDeg: 5, speed: 0 });
    const entries: ValidationEntry[] = [0, 1, 2].map((i) => ({
      row: { video: `stand${i}.mp4`, leftDeg: 5, rightDeg: 5, line: i + 2 },
      clip: { kind: "topdown", name: `stand${i}.mp4`, video: g.video, frames: g.frames },
    }));
    const report = buildReport(entries, { mode: "topdown", settings: {}, notes });
    expect(report.presets[0].outcomes[0].quality).toBe("standing");
  });
});
