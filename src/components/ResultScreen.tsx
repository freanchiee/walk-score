"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { TARGET_BAND } from "@/lib/config";
import { describeAngle, type ScoreResult } from "@/lib/scoring/score";
import { renderShareCard, shareCardAlt } from "@/lib/share/card";
import { useCountUp, useHeadingFocus } from "./hooks";
import { DownloadIcon, RefreshIcon, ShareIcon } from "./icons";
import { Button, Card, Disclaimer, PrivacyNote, ScreenShell } from "./ui";

function ScoreRing({ score }: { score: number }) {
  const shown = useCountUp(score);
  const gradId = useId();
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const R = 88;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative mx-auto size-64" role="img" aria-label={`Walk Score ${score} out of 100`}>
      <svg viewBox="0 0 200 200" className="size-full -rotate-90" aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r={R} fill="none" stroke="var(--surface-strong)" strokeWidth="14" />
        <circle
          cx="100"
          cy="100"
          r={R}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={filled ? C * (1 - Math.max(score, 1) / 100) : C}
          style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.2, 0.8, 0.2, 1)" }}
        />
      </svg>
      <div aria-hidden className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-7xl font-extrabold tabular-nums leading-none">{shown}</span>
        <span className="mt-1 text-sm text-muted">out of 100</span>
      </div>
    </div>
  );
}

const SCALE_MIN = -20;
const SCALE_MAX = 30;
const pct = (deg: number) => ((Math.min(SCALE_MAX, Math.max(SCALE_MIN, deg)) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;

/** Where each foot sits relative to the target band. Numbers are also written out for screen readers. */
function AngleScale({ left, right }: { left: number; right: number }) {
  const l = describeAngle(left);
  const r = describeAngle(right);
  const say = (d: ReturnType<typeof describeAngle>) =>
    d.direction === "straight" ? "straight ahead" : `${d.text} ${d.direction === "out" ? "outward" : "inward"}`;
  return (
    <div
      role="img"
      aria-label={`Left foot ${say(l)}, right foot ${say(r)}. Sweet spot is ${TARGET_BAND.minDeg} to ${TARGET_BAND.maxDeg} degrees outward.`}
      className="relative mx-3 mt-3 h-[8.5rem] select-none"
    >
      {/* track (y 52-64) with the sweet-spot band */}
      <div className="absolute inset-x-0 top-[52px] h-3 rounded-full bg-surface-strong" />
      <div
        className="absolute top-[52px] h-3 rounded-full bg-accent/60"
        style={{ left: `${pct(TARGET_BAND.minDeg)}%`, width: `${pct(TARGET_BAND.maxDeg) - pct(TARGET_BAND.minDeg)}%` }}
      />
      {/* left foot above the track, right foot below it, each with a stem to its exact position */}
      {[
        { letter: "L", deg: left, markerTop: 0, stemTop: 32, stemH: 20 },
        { letter: "R", deg: right, markerTop: 76, stemTop: 64, stemH: 12 },
      ].map((m) => (
        <span key={m.letter} aria-hidden>
          <span
            className="absolute w-0.5 -translate-x-1/2 bg-accent"
            style={{ left: `${pct(m.deg)}%`, top: m.stemTop, height: m.stemH }}
          />
          <span
            className="absolute flex size-8 -translate-x-1/2 items-center justify-center rounded-full bg-accent text-sm font-extrabold text-accent-ink shadow-lg"
            style={{ left: `${pct(m.deg)}%`, top: m.markerTop }}
          >
            {m.letter}
          </span>
        </span>
      ))}
      {[
        { deg: SCALE_MIN, label: `${SCALE_MIN}° in` },
        { deg: 0, label: "0°" },
        { deg: 10, label: "10°" },
        { deg: SCALE_MAX, label: `${SCALE_MAX}° out` },
      ].map((t) => (
        <span
          key={t.deg}
          aria-hidden
          className="absolute -translate-x-1/2 whitespace-nowrap text-[0.7rem] text-muted"
          style={{ left: `${pct(t.deg)}%`, top: 116 }}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3 text-center">
      <div className="text-xs font-semibold uppercase tracking-widest text-muted">{label}</div>
      <div className="mt-1 text-3xl font-extrabold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{sub}</div>
    </div>
  );
}

const QUALITY_TEXT = {
  good: { text: "Clean read", cls: "text-ok border-ok/40" },
  ok: { text: "Decent read", cls: "text-warn border-warn/40" },
  rough: { text: "Rough read", cls: "text-warn border-warn/40" },
  standing: { text: "Standing read", cls: "text-warn border-warn/40" },
} as const;

function localHost(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const h = window.location.hostname;
  if (!h || /^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.)/.test(h)) return undefined;
  return window.location.host;
}

export function ResultScreen({
  score,
  onShareClick,
  onScanAgain,
  preview = false,
}: {
  score: ScoreResult;
  onShareClick: (method: "web_share" | "download") => void;
  onScanAgain: () => void;
  /** used by the debug page: no "scan again" */
  preview?: boolean;
}) {
  const h1 = useHeadingFocus();
  const [card, setCard] = useState<{ blob: Blob; url: string } | null>(null);
  const [cardError, setCardError] = useState(false);
  const [canShareFiles] = useState(() => {
    if (typeof navigator === "undefined" || !navigator.canShare) return false;
    try {
      return navigator.canShare({ files: [new File([""], "x.png", { type: "image/png" })] });
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    renderShareCard(score, { host: localHost() })
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setCard({ blob, url: objectUrl });
      })
      .catch(() => alive && setCardError(true));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [score]);

  const download = () => {
    if (!card) return;
    onShareClick("download");
    const a = document.createElement("a");
    a.href = card.url;
    a.download = `walk-score-${score.score}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const share = async () => {
    if (!card) return;
    onShareClick("web_share");
    const file = new File([card.blob], `walk-score-${score.score}.png`, { type: "image/png" });
    try {
      await navigator.share({
        files: [file],
        title: "My Walk Score",
        text: `I scored ${score.score}/100 on Walk Score - "${score.label.title}"!`,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // user closed the share sheet
      // sharing failed for another reason: fall back to saving the image
      const a = document.createElement("a");
      a.href = card.url;
      a.download = `walk-score-${score.score}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  };

  const l = describeAngle(score.leftDeg);
  const r = describeAngle(score.rightDeg);
  const dirText = (d: ReturnType<typeof describeAngle>) =>
    d.direction === "straight" ? "straight" : d.direction === "out" ? "toe-out" : "toe-in";
  const q = score.standing
    ? QUALITY_TEXT.standing
    : score.lowConfidence
      ? { text: "Rough read · low confidence", cls: QUALITY_TEXT.rough.cls }
      : QUALITY_TEXT[score.quality];

  return (
    <ScreenShell as={preview ? "div" : "main"}>
      <h1 ref={h1} tabIndex={-1} className="sr-only">
        Your Walk Score: {score.score} out of 100, {score.label.title}
      </h1>

      <section className="flex flex-col items-center gap-4 pt-2 text-center" aria-label="Your score">
        <ScoreRing score={score.score} />
        <div>
          <p className="text-3xl font-extrabold tracking-tight">{score.label.title}</p>
          <p className="mx-auto mt-1 max-w-xs text-muted">{score.label.tagline}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${q.cls}`}>{q.text}</span>
      </section>

      <Card>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">Your foot angles</h2>
        <AngleScale left={score.leftDeg} right={score.rightDeg} />
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="Left" value={l.text} sub={dirText(l)} />
          <Stat label="Right" value={r.text} sub={dirText(r)} />
          <Stat label="Symmetry" value={`${score.symmetryScore}%`} sub="match" />
        </div>
        <p className="mt-3 text-xs text-muted">
          Sweet spot: {TARGET_BAND.minDeg}–{TARGET_BAND.maxDeg}° toe-out (our best guess, just for fun).
        </p>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">What we saw</h2>
        <ul className="mt-3 space-y-3">
          {score.cues.map((c) => (
            <li key={c} className="flex gap-3 leading-snug">
              <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col items-center gap-4">
        <h2 className="self-start text-sm font-semibold uppercase tracking-widest text-muted">Your share card</h2>
        {card ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, not optimisable by next/image
          <img
            src={card.url}
            alt={shareCardAlt(score)}
            width={1080}
            height={1920}
            className="w-52 rounded-2xl border border-line shadow-2xl"
          />
        ) : cardError ? (
          <p role="alert" className="text-sm text-danger">
            We couldn&apos;t draw the share card in this browser.
          </p>
        ) : (
          <div
            aria-busy
            className="aspect-[9/16] w-52 animate-[shimmer_1.6s_linear_infinite] rounded-2xl border border-line bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.08),transparent)] bg-[length:200%_100%]"
          />
        )}
        <p className="text-center text-xs text-muted">No face, no video - just your score, label and foot angles.</p>
        <div className="flex w-full flex-col gap-3">
          {canShareFiles && (
            <Button onClick={share} disabled={!card} className="w-full">
              <ShareIcon /> Share
            </Button>
          )}
          <Button variant={canShareFiles ? "secondary" : "primary"} onClick={download} disabled={!card} className="w-full">
            <DownloadIcon /> Save image
          </Button>
        </div>
      </Card>

      {!preview && (
        <Button variant="secondary" onClick={onScanAgain} className="w-full">
          <RefreshIcon /> Scan again
        </Button>
      )}
      {!preview && (
        <Link href="/debug" className="self-center text-xs underline">
          What the sensors saw (debug view)
        </Link>
      )}

      <PrivacyNote />
      <Disclaimer />
    </ScreenShell>
  );
}
