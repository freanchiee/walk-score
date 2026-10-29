"use client";

import Link from "next/link";
import { CAPTURE_MODE } from "@/lib/config";
import { copy } from "@/lib/modeCopy";
import { useHeadingFocus } from "./hooks";
import { GuideDiagram } from "./GuideDiagram";
import { TopDownGuideDiagram } from "./TopDownGuideDiagram";
import { Button, Card, Disclaimer, PrivacyNote, ScreenShell } from "./ui";

export function Landing({ onStart }: { onStart: () => void }) {
  const h1 = useHeadingFocus();
  return (
    <ScreenShell>
      <header className="pt-4">
        <p className="text-sm font-extrabold tracking-[0.32em] text-accent">WALK SCORE</p>
        <h1 ref={h1} tabIndex={-1} className="mt-4 text-[2.5rem] font-extrabold leading-[1.05] tracking-tight">
          Scan your walk. Get a foot-angle score worth sharing.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">{copy.pitch}</p>
      </header>

      <div className="flex flex-col gap-3">
        <Button onClick={onStart} className="w-full py-4 text-lg">
          Scan my walk
        </Button>
        <PrivacyNote />
      </div>

      <Card>
        <h2 className="text-lg font-bold">How to get a good scan</h2>
        <div className="mt-3">{CAPTURE_MODE === "topdown" ? <TopDownGuideDiagram /> : <GuideDiagram />}</div>
        <ol className="mt-4 space-y-3">
          {copy.steps.map((s, i) => (
            <li key={s} className="flex gap-3 text-[0.95rem] leading-snug">
              <span
                aria-hidden
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-extrabold text-accent-ink"
              >
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Disclaimer />

      <footer className="mt-auto flex items-center justify-between pt-2 text-xs text-muted">
        <span>Prototype · no account, no uploads</span>
        <span className="flex gap-4">
          <Link href="/settings/calibration" className="underline">
            Calibration
          </Link>
          <Link href="/debug" className="underline">
            Debug view
          </Link>
        </span>
      </footer>
    </ScreenShell>
  );
}
