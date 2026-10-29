import { POSE_LANDMARK_COUNT } from "./analysis/landmarks";
import type { Lm, PoseFrame, VideoInfo } from "./analysis/types";
import type { TopDownFrame } from "./topdown/analyze";
import type { FootBlob } from "./topdown/segment";

/**
 * Saved extraction results let you re-run the analysis (different thresholds, estimators, code changes) without
 * decoding the video again - the slow part. They contain coordinates only: no pixels, no faces.
 *
 *  - kind "pose":    MediaPipe landmarks per frame (front-view capture)
 *  - kind "topdown": the feet found per frame (top-down capture)
 * Files written before `kind` existed are pose files.
 */
export type ClipKind = "pose" | "topdown";

interface Base {
  format: "walkscore-landmarks";
  version: 1;
  name: string;
  createdAt: string;
  video: VideoInfo;
  meta?: Record<string, string | number | boolean>;
}

export type LandmarkFile = (Base & { kind: "pose"; frames: PoseFrame[] }) | (Base & { kind: "topdown"; frames: TopDownFrame[] });

export interface LandmarkBundle {
  format: "walkscore-landmarks-bundle";
  version: 1;
  createdAt: string;
  clips: LandmarkFile[];
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

// ---- pose frames -------------------------------------------------------------------------------------

type PackedLm = [number, number, number, number];
interface PackedFrame {
  t: number;
  ok: boolean;
  img?: PackedLm[];
  world?: PackedLm[];
}

const pack = (p: Lm): PackedLm => [r4(p.x), r4(p.y), r4(p.z), r4(p.v)];
const unpack = (a: PackedLm): Lm => ({ x: a[0], y: a[1], z: a[2], v: a[3] });

function packFrames(frames: PoseFrame[]): PackedFrame[] {
  return frames.map((f) =>
    f.ok && f.img && f.world
      ? { t: r4(f.t), ok: true, img: f.img.map(pack), world: f.world.map(pack) }
      : { t: r4(f.t), ok: false },
  );
}

function unpackFrames(packed: unknown): PoseFrame[] {
  if (!Array.isArray(packed)) throw new Error("Landmark file has no frames.");
  return (packed as PackedFrame[]).map((f, i) => {
    if (typeof f?.t !== "number") throw new Error(`Frame ${i} has no timestamp.`);
    if (!f.ok || !f.img || !f.world) return { t: f.t, ok: false, img: null, world: null };
    if (f.img.length !== POSE_LANDMARK_COUNT || f.world.length !== POSE_LANDMARK_COUNT) {
      throw new Error(`Frame ${i} does not have ${POSE_LANDMARK_COUNT} landmarks.`);
    }
    return { t: f.t, ok: true, img: f.img.map(unpack), world: f.world.map(unpack) };
  });
}

// ---- top-down frames ---------------------------------------------------------------------------------

type PackedBlob = number[]; // 16 numbers + clipped flag
interface PackedTopDownFrame {
  t: number;
  b: PackedBlob[];
}

const packBlob = (b: FootBlob): PackedBlob => [
  r5(b.cx),
  r5(b.cy),
  r5(b.area),
  r5(b.length),
  r5(b.width),
  r5(b.ux),
  r5(b.uy),
  r4(b.elongation),
  r5(b.toeX),
  r5(b.toeY),
  r5(b.heelX),
  r5(b.heelY),
  r4(b.score),
  r4(b.L),
  r4(b.a),
  r4(b.b),
  b.clipped ? 1 : 0,
];

function unpackBlob(a: PackedBlob): FootBlob {
  if (a.length !== 17) throw new Error("A top-down blob record is malformed.");
  return {
    cx: a[0],
    cy: a[1],
    area: a[2],
    length: a[3],
    width: a[4],
    ux: a[5],
    uy: a[6],
    elongation: a[7],
    toeX: a[8],
    toeY: a[9],
    heelX: a[10],
    heelY: a[11],
    score: a[12],
    L: a[13],
    a: a[14],
    b: a[15],
    clipped: a[16] === 1,
  };
}

function packTopDown(frames: TopDownFrame[]): PackedTopDownFrame[] {
  return frames.map((f) => ({ t: r4(f.t), b: f.blobs.map(packBlob) }));
}

function unpackTopDown(packed: unknown): TopDownFrame[] {
  if (!Array.isArray(packed)) throw new Error("Landmark file has no frames.");
  return (packed as PackedTopDownFrame[]).map((f, i) => {
    if (typeof f?.t !== "number" || !Array.isArray(f.b)) throw new Error(`Frame ${i} is malformed.`);
    return { t: f.t, blobs: f.b.map(unpackBlob) };
  });
}

// ---- files ---------------------------------------------------------------------------------------------

function toPlain(file: LandmarkFile) {
  return { ...file, frames: file.kind === "pose" ? packFrames(file.frames) : packTopDown(file.frames) };
}

export function serializeLandmarkFile(file: LandmarkFile): string {
  return JSON.stringify(toPlain(file));
}

export function serializeBundle(clips: LandmarkFile[]): string {
  const bundle = {
    format: "walkscore-landmarks-bundle",
    version: 1,
    createdAt: new Date().toISOString(),
    clips: clips.map(toPlain),
  };
  return JSON.stringify(bundle);
}

function parseClip(raw: unknown): LandmarkFile {
  const o = raw as Partial<Base> & { kind?: string; frames?: unknown };
  if (!o || o.format !== "walkscore-landmarks" || o.version !== 1) {
    throw new Error("Not a Walk Score landmark file.");
  }
  const v = o.video;
  if (!v || !(v.width > 0) || !(v.height > 0) || !(v.fps > 0)) throw new Error("Landmark file has invalid video info.");
  const base = {
    format: "walkscore-landmarks" as const,
    version: 1 as const,
    name: typeof o.name === "string" ? o.name : "clip",
    createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
    video: { width: v.width, height: v.height, fps: v.fps, duration: v.duration },
    meta: o.meta,
  };
  return o.kind === "topdown"
    ? { ...base, kind: "topdown", frames: unpackTopDown(o.frames) }
    : { ...base, kind: "pose", frames: unpackFrames(o.frames) };
}

/** Parses one landmark file or a bundle of them (returned as an array either way). */
export function parseLandmarkText(text: string): LandmarkFile[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const o = raw as { format?: string; clips?: unknown[] };
  if (o?.format === "walkscore-landmarks-bundle") {
    if (!Array.isArray(o.clips)) throw new Error("Bundle has no clips.");
    return o.clips.map(parseClip);
  }
  return [parseClip(raw)];
}
