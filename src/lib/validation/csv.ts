export interface LabelRow {
  video: string;
  leftDeg: number;
  rightDeg: number;
  /** 1-based line number in the file, for error messages */
  line: number;
}

export interface ParsedLabels {
  rows: LabelRow[];
  errors: string[];
}

/** Minimal CSV line splitter: commas, double-quoted fields, "" as an escaped quote. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const VIDEO_KEYS = ["video", "file", "filename", "clip", "name"];
const LEFT_KEYS = ["left_deg", "left", "l", "left_angle", "leftdeg"];
const RIGHT_KEYS = ["right_deg", "right", "r", "right_angle", "rightdeg"];

const num = (s: string) => {
  if (s === "") return NaN;
  return Number(s.replace(",", "."));
};

/**
 * Parses `video,left_deg,right_deg`. Angles are foot progression angles in degrees, toe-out positive,
 * toe-in negative, left/right being the person's own left and right foot.
 */
export function parseLabelsCsv(text: string): ParsedLabels {
  const rows: LabelRow[] = [];
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);

  let header: string[] | null = null;
  let iVideo = -1;
  let iLeft = -1;
  let iRight = -1;

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const line = lines[idx].trim();
    if (!line || line.startsWith("#")) continue;
    const cells = splitCsvLine(line);

    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      iVideo = header.findIndex((h) => VIDEO_KEYS.includes(h));
      iLeft = header.findIndex((h) => LEFT_KEYS.includes(h));
      iRight = header.findIndex((h) => RIGHT_KEYS.includes(h));
      if (iVideo < 0 || iLeft < 0 || iRight < 0) {
        errors.push(`Line ${lineNo}: the header must be "video,left_deg,right_deg".`);
        return { rows, errors }; // everything below would be misread
      }
      continue;
    }

    const video = cells[iVideo] ?? "";
    const l = num(cells[iLeft] ?? "");
    const r = num(cells[iRight] ?? "");
    if (!video) {
      errors.push(`Line ${lineNo}: empty video name.`);
      continue;
    }
    if (!Number.isFinite(l) || !Number.isFinite(r)) {
      errors.push(`Line ${lineNo} (${video}): left_deg and right_deg must be numbers.`);
      continue;
    }
    rows.push({ video, leftDeg: l, rightDeg: r, line: lineNo });
  }

  if (!header) errors.push("The CSV is empty.");
  return { rows, errors };
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const stem = (p: string) => baseName(p).replace(/\.[^.]+$/, "");

export interface MatchResult<T> {
  matches: Array<{ row: LabelRow; item: T }>;
  /** CSV rows that have no file */
  missing: LabelRow[];
  /** files that no CSV row refers to */
  unused: T[];
}

/** Matches CSV rows to files by file name (case-insensitive, directories ignored, extension optional). */
export function matchLabelsToFiles<T extends { name: string }>(rows: LabelRow[], items: T[]): MatchResult<T> {
  const used = new Set<T>();
  const matches: Array<{ row: LabelRow; item: T }> = [];
  const missing: LabelRow[] = [];
  for (const row of rows) {
    const want = baseName(row.video).toLowerCase();
    const wantStem = stem(row.video).toLowerCase();
    const free = items.filter((it) => !used.has(it));
    const hit =
      free.find((it) => baseName(it.name).toLowerCase() === want) ??
      free.find((it) => stem(it.name).toLowerCase() === wantStem);
    if (hit) {
      used.add(hit);
      matches.push({ row, item: hit });
    } else missing.push(row);
  }
  return { matches, missing, unused: items.filter((it) => !used.has(it)) };
}
