"use client";

import type { ReactNode } from "react";

export const inputCls = "rounded-lg border border-line bg-surface px-2 py-2 text-ink";

/** One-decimal number, "—" when missing; `signed` adds a leading "+". */
export const f1 = (v: number | null | undefined, signed = false) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : (signed && v > 0 ? "+" : "") + v.toFixed(1);

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function download(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
