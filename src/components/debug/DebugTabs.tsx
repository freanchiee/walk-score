"use client";

import Link from "next/link";
import { useState } from "react";
import { CAPTURE_MODE, type CaptureMode } from "@/lib/config";
import { ScreenShell } from "../ui";
import { DebugClient } from "./DebugClient";
import { SensorsDebug } from "./SensorsDebug";
import { TopDownDebugClient } from "./TopDownDebugClient";

type TabId = CaptureMode | "sensors";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "topdown", label: "Top-down feet" },
  { id: "sensors", label: "Phone sensors" },
  { id: "front", label: "Front view (pose model)" },
];

/** /debug: one tab per capture mode, starting on the app's configured mode, plus the phone-sensor tab. */
export function DebugTabs() {
  const [mode, setMode] = useState<TabId>(CAPTURE_MODE);
  return (
    <ScreenShell wide>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-extrabold tracking-[0.3em] text-accent">WALK SCORE · DEBUG</p>
          <h1 className="mt-1 text-3xl font-extrabold">Debug view</h1>
        </div>
        <Link href="/" className="text-sm underline">
          ← Back to the app
        </Link>
      </header>

      <div role="tablist" aria-label="Capture mode" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={mode === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setMode(t.id)}
            className={`min-h-11 rounded-full border px-4 py-2 text-sm font-bold transition ${
              mode === t.id ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-ink hover:bg-white/10"
            }`}
          >
            {t.label}
            {t.id === CAPTURE_MODE ? " · app default" : ""}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${mode}`} aria-labelledby={`tab-${mode}`}>
        {mode === "topdown" ? <TopDownDebugClient /> : mode === "sensors" ? <SensorsDebug /> : <DebugClient />}
      </div>
    </ScreenShell>
  );
}
