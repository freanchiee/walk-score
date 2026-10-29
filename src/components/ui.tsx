import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LockIcon } from "./icons";

type Variant = "primary" | "secondary" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 active:brightness-95 shadow-[0_8px_30px_-8px_rgb(198_244_50/0.55)]",
  secondary: "bg-surface-strong text-ink border border-line hover:bg-white/15",
  ghost: "text-muted hover:text-ink hover:bg-white/5",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-6 py-3 text-base font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-line bg-surface p-5 ${className}`}>{children}</div>;
}

/** The on-screen statement that video never leaves the device. */
export function PrivacyNote({ className = "" }: { className?: string }) {
  return (
    <p className={`flex items-start gap-2 text-sm text-muted ${className}`}>
      <LockIcon className="mt-0.5 shrink-0 text-accent-2" />
      <span>
        <strong className="font-semibold text-ink">Processed on your device.</strong> Your video never leaves your phone or
        gets uploaded.
      </span>
    </p>
  );
}

export function Disclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs leading-relaxed text-muted ${className}`}>
      Walk Score is for entertainment and general curiosity only. It is not a medical device or assessment, does not
      diagnose or treat anything, and is no substitute for professional advice. Angles read from a single phone camera are
      approximate.
    </p>
  );
}

export function ScreenShell({
  children,
  wide = false,
  as: Tag = "main",
}: {
  children: ReactNode;
  wide?: boolean;
  /** use "div" when the screen is embedded inside another <main> */
  as?: "main" | "div";
}) {
  return (
    <Tag className={`mx-auto flex w-full flex-1 flex-col gap-6 px-4 pb-10 pt-8 ${wide ? "max-w-6xl" : "max-w-md"}`}>
      {children}
    </Tag>
  );
}
