"use client";

import type { ExtractProgress } from "@/lib/pose/landmarker";
import { useHeadingFocus } from "./hooks";
import { Button, PrivacyNote, ScreenShell } from "./ui";

export function Analyzing({ progress, onCancel }: { progress: ExtractProgress; onCancel: () => void }) {
  const h1 = useHeadingFocus();
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  return (
    <ScreenShell>
      <h1 ref={h1} tabIndex={-1} className="text-3xl font-extrabold leading-tight">
        Reading your walk…
      </h1>
      <p className="text-muted">
        This takes anywhere from a few seconds to under a minute, depending on your phone. Keep this tab open.
      </p>

      <div
        role="progressbar"
        aria-label="Analysis progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-4 w-full overflow-hidden rounded-full bg-surface-strong"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between text-sm text-muted">
        <span aria-live="polite">{progress.stage}</span>
        <span aria-hidden className="tabular-nums">
          {pct}%
        </span>
      </div>

      <PrivacyNote />
      <Button variant="secondary" onClick={onCancel} className="self-start">
        Cancel
      </Button>
    </ScreenShell>
  );
}
