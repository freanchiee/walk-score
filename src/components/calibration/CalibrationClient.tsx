"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { forwardFromPsi } from "@/lib/calibration/measure";
import { clipForward, readMarks } from "@/lib/calibration/session";
import { HEADING_METHODS, describeCalibration, shippedCalibration, type HeadingMethod } from "@/lib/calibration/settings";
import { loadVideo } from "@/lib/pose/video";
import { analyzeTopDown } from "@/lib/topdown/analyze";
import { extractFeet } from "@/lib/topdown/extract";
import { Capture } from "../Capture";
import { Button, Card, Disclaimer, PrivacyNote, ScreenShell } from "../ui";
import { CalibrationResults } from "./CalibrationResults";
import { ClipWorkspace } from "./ClipWorkspace";
import { isReady, type Clip, type ClipAnalysis, type ReadyClip } from "./types";
import { useSavedCalibration } from "./useSavedCalibration";

const small = "min-h-10 px-4 py-2 text-sm";

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * /settings/calibration: bring a clip (record or upload), mark the heel centre and toe gap of each foot on a few
 * mid-stance frames against the walking direction, and the page works out the per-foot offset between the app's foot
 * axis and yours, writes labels.csv, and saves the calibration for this device (or prints the line to ship it).
 */
export function CalibrationClient() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [methodChoice, setMethodChoice] = useState<HeadingMethod | null>(null);
  const [view, setView] = useState<"main" | "record">("main");
  const [shipped] = useState(() => shippedCalibration());
  const saved = useSavedCalibration();
  const method = methodChoice ?? saved?.method ?? shipped.method;

  const nextId = useRef(0);
  const recordings = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const removed = useRef(new Set<number>());
  const clipsRef = useRef<Clip[]>([]);
  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);
  // free the video decoders when the page is left
  useEffect(
    () => () => {
      clipsRef.current.forEach((c) => c.loaded?.dispose());
    },
    [],
  );

  const patch = (id: number, p: Partial<Clip>) => setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const addClip = (file: Blob, name: string, durationHint?: number) => {
    const id = ++nextId.current;
    setClips((cs) => [
      ...cs,
      {
        id,
        name,
        file,
        status: "working",
        progress: { stage: "Waiting…", done: 0, total: 1 },
        marks: [],
        line: null,
        useOwn: false,
      },
    ]);
    setActiveId(id);
    queue.current = queue.current.then(async () => {
      if (removed.current.has(id)) return;
      try {
        const ex = await extractFeet(file, { durationHint, maxSeconds: 60, onProgress: (p) => patch(id, { progress: p }) });
        const loaded = await loadVideo(file, { durationHint });
        if (removed.current.has(id)) {
          loaded.dispose();
          return;
        }
        patch(id, { status: "ready", video: ex.video, frames: ex.frames, loaded, progress: undefined });
      } catch (e) {
        patch(id, { status: "failed", error: e instanceof Error ? e.message : String(e), progress: undefined });
      }
    });
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name)) continue;
      addClip(f, f.name);
    }
  };

  const removeClip = (id: number) => {
    removed.current.add(id);
    const gone = clips.find((c) => c.id === id);
    gone?.loaded?.dispose();
    const rest = clips.filter((c) => c.id !== id);
    setClips(rest);
    if (activeId === id) setActiveId(rest.find(isReady)?.id ?? rest[0]?.id ?? null);
  };

  const updateReady = (id: number) => (fn: (c: ReadyClip) => ReadyClip) =>
    setClips((cs) => cs.map((c) => (c.id === id && isReady(c) ? fn(c) : c)));

  // what the app reads on every clip with the offsets off, and the marks read against the same walking direction
  const analyses = useMemo(() => {
    const raw = { ...HEADING_METHODS[method].options, angleOffsetLeftDeg: 0, angleOffsetRightDeg: 0 };
    return clips.filter(isReady).map((clip): { clip: ReadyClip; analysis: ClipAnalysis } => {
      const result = analyzeTopDown(clip.frames, clip.video, raw);
      const { fwd, own } = clipForward(result, clip.line, clip.useOwn);
      return {
        clip,
        analysis: { result, fwdApp: forwardFromPsi(result.heading.psiDeg), fwd, usingOwn: own, readings: readMarks(clip.marks, clip.frames, result, fwd) },
      };
    });
  }, [clips, method]);

  const active = analyses.find((a) => a.clip.id === activeId) ?? null;

  if (view === "record") {
    return (
      <Capture
        onBack={() => setView("main")}
        onVideo={(blob, source, durationHint) => {
          setView("main");
          const ext = blob.type.includes("mp4") ? "mp4" : "webm";
          addClip(blob, source === "camera" ? `recording-${++recordings.current}.${ext}` : `upload-${++recordings.current}.${ext}`, durationHint);
        }}
      />
    );
  }

  const counts = (c: Clip) => {
    const a = analyses.find((x) => x.clip.id === c.id)?.analysis;
    const n = (s: "left" | "right") => a?.readings.filter((r) => r.plausible && r.mark.side === s).length ?? 0;
    return a ? `L ${n("left")} · R ${n("right")} marks` : "";
  };

  return (
    <ScreenShell wide>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-extrabold tracking-[0.3em] text-accent">WALK SCORE · SETTINGS</p>
          <h1 className="mt-1 text-3xl font-extrabold">Calibration</h1>
        </div>
        <Link href="/" className="text-sm underline">
          ← Back to the app
        </Link>
      </header>

      <p className="max-w-3xl text-sm text-muted">
        The app reads the main axis of each foot&apos;s silhouette. You measure the foot from the heel centre to the point between the big toe and the next toe.
        Here you mark a few frames by hand, and the page works out how much to add to the app&apos;s angles so the two agree. Three steps: bring a clip, mark it,
        save the result.
      </p>
      <PrivacyNote />

      <Card>
        <h2 className="text-lg font-bold">Calibration in use</h2>
        <p className="mt-2 text-sm" role="status" id="cal-current">
          {saved ? (
            <>
              <strong>Saved on this device:</strong> {describeCalibration(saved)}
              {saved.basedOn ? ` · from ${saved.basedOn.clips} clip${saved.basedOn.clips === 1 ? "" : "s"}, ${saved.basedOn.marks} marks` : ""}
              {saved.savedAt ? ` · ${new Date(saved.savedAt).toLocaleString()}` : ""}
            </>
          ) : (
            <>
              <strong>Shipped with the app:</strong> {describeCalibration(shipped)}
              {shipped.leftOffsetDeg === 0 && shipped.rightOffsetDeg === 0 ? " (no correction yet)" : ""}
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-muted">
          The scan flow uses the calibration saved on this device, else the one shipped in <code>src/lib/config.ts</code>. /debug and /validate always show the raw
          readings.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">1 · The clip</h2>
        <p className="mt-1 text-sm text-muted">
          About 10 seconds of normal walking in a straight line, phone held flat in front of you, back camera pointing at the floor, both feet in view. Record it here or add video files you already have.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => setView("record")} id="cal-record">
            Record a clip
          </Button>
          <input
            id="cal-upload"
            type="file"
            accept="video/*"
            multiple
            className="peer sr-only"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <label
            htmlFor="cal-upload"
            className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-line bg-surface-strong px-6 py-3 text-base font-bold transition hover:bg-white/15 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-accent"
          >
            Add video files
          </label>
        </div>

        {clips.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2" aria-label="Clips">
            {clips.map((c) => (
              <li
                key={c.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border p-3 text-sm ${c.id === activeId ? "border-accent bg-white/5" : "border-line bg-surface"}`}
              >
                <button
                  type="button"
                  onClick={() => setActiveId(c.id)}
                  aria-pressed={c.id === activeId}
                  disabled={c.status !== "ready"}
                  className="min-w-0 max-w-full truncate text-left font-bold underline-offset-2 hover:underline disabled:no-underline"
                  title={c.name}
                >
                  {c.name}
                </button>
                <span className="text-xs text-muted" role="status">
                  {c.status === "working" &&
                    `${c.progress?.stage ?? "Working…"} ${c.progress ? Math.round((c.progress.done / Math.max(1, c.progress.total)) * 100) : 0}%`}
                  {c.status === "ready" && counts(c)}
                  {c.status === "failed" && <span className="text-danger">{c.error}</span>}
                </span>
                <span className="ml-auto flex gap-2">
                  {c.name.startsWith("recording-") && (
                    <Button variant="ghost" className={small} onClick={() => saveBlob(c.file, c.name)}>
                      Save video
                    </Button>
                  )}
                  <Button variant="ghost" className={small} onClick={() => removeClip(c.id)} aria-label={`Remove ${c.name}`}>
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-bold">2 · Mark the feet</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Pause on a frame where the foot is flat on the floor (the stance buttons jump to the middle of each stance the app found).</li>
          <li>
            Pick the foot, click the <strong className="text-ink">heel centre</strong>, then the <strong className="text-ink">point between the big toe and the next toe</strong>.
            Drag a point to adjust it; the magnifier shows the pixels under your pointer.
          </li>
          <li>
            Repeat on at least 3 frames per foot, from different steps. Each mark is measured against the walking direction (the way the floor slides through the
            picture), never the picture edge.
          </li>
        </ol>
        <div className="mt-5">
          {active ? (
            <ClipWorkspace key={active.clip.id} clip={active.clip} analysis={active.analysis} update={updateReady(active.clip.id)} />
          ) : (
            <p className="text-sm text-muted">{clips.length ? "Waiting for the clip to finish loading…" : "Add a clip first."}</p>
          )}
        </div>
      </Card>

      {clips.length > 0 && (
        <CalibrationResults clips={analyses} method={method} onMethod={setMethodChoice} saved={saved} shipped={shipped} />
      )}

      <Disclaimer />
    </ScreenShell>
  );
}
