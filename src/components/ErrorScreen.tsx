"use client";

import Link from "next/link";
import { copy } from "@/lib/modeCopy";
import { useHeadingFocus } from "./hooks";
import { Button, Card, Disclaimer, PrivacyNote, ScreenShell } from "./ui";

const TIPS = copy.errorTips;

export function ErrorScreen({
  message,
  detail,
  onRetry,
  onBack,
  onMark,
}: {
  message: string;
  detail?: string;
  onRetry: () => void;
  onBack: () => void;
  /** when a tap on the foot could help (the feet were not found): go back to the tap screen with the same video */
  onMark?: () => void;
}) {
  const h1 = useHeadingFocus();
  return (
    <ScreenShell>
      <h1 ref={h1} tabIndex={-1} className="text-3xl font-extrabold leading-tight">
        We couldn&apos;t get a clear read
      </h1>
      <p role="alert" className="text-lg text-muted">
        {message}
      </p>
      {detail && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-2 break-words font-mono">{detail}</p>
        </details>
      )}
      <Card>
        <h2 className="font-bold">For a better scan</h2>
        <ul className="mt-3 space-y-2 text-[0.95rem]">
          {TIPS.map((t) => (
            <li key={t} className="flex gap-3">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="flex flex-col gap-3">
        {onMark && (
          <>
            <Button onClick={onMark} className="w-full py-4 text-lg">
              Tap your foot and try again
            </Button>
            <p className="text-center text-sm text-muted">
              Same video, no need to walk again: tap one foot in it so the app can learn what your foot looks like.
            </p>
          </>
        )}
        <Button variant={onMark ? "secondary" : "primary"} onClick={onRetry} className="w-full py-4 text-lg">
          {onMark ? "Record again" : "Try again"}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back to start
        </Button>
        <Link href="/debug" className="self-center text-xs underline">
          What the sensors saw (debug view)
        </Link>
      </div>
      <PrivacyNote />
      <Disclaimer />
    </ScreenShell>
  );
}
