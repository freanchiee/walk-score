import { SENSOR_CONFIG } from "@/lib/config";
import { bubbleOffset, tiltClass } from "@/lib/sensors/tilt";

export type ChipState = "ok" | "warn" | "bad" | "na" | "wait";

export interface Chip {
  id: string;
  label: string;
  state: ChipState;
  /** what to fix, shown when the chip is not green */
  hint?: string;
}

const CHIP_STYLE: Record<ChipState, string> = {
  ok: "border-ok/70 bg-ok/20 text-ok",
  warn: "border-warn/70 bg-warn/20 text-warn",
  bad: "border-danger/70 bg-danger/20 text-danger",
  na: "border-white/30 bg-black/50 text-muted",
  wait: "border-white/30 bg-black/50 text-muted",
};
const STATE_WORD: Record<ChipState, string> = { ok: "OK", warn: "needs a little work", bad: "not OK", na: "not available", wait: "checking" };
const TILT_COLOR = { good: "#86efac", warn: "#fbbf24", bad: "#ffa3a3" } as const;

/** The status chips: Feet visible, Light OK, Level, Steady. Green when fine. */
export function ChipRow({ chips }: { chips: Chip[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Live checks">
      {chips.map((c) => (
        <li key={c.id} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold backdrop-blur-sm ${CHIP_STYLE[c.state]}`}>
          <span aria-hidden className="inline-block size-2 rounded-full bg-current" />
          {c.label}
          <span className="sr-only">: {STATE_WORD[c.state]}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Spirit level: the bubble drifts to the high side of the phone inside a target ring; the small inner ring is the
 * green zone. Colour follows SENSOR_CONFIG.tilt (green / amber / red).
 */
export function LevelBubble({ beta, gamma, tilt }: { beta: number; gamma: number; tilt: number }) {
  const R = 34;
  const cls = tiltClass(tilt);
  const b = bubbleOffset(beta, gamma);
  const reach = R - 6;
  const good = (R * SENSOR_CONFIG.tilt.goodDeg) / SENSOR_CONFIG.bubbleFullScaleDeg;
  return (
    <div className="flex flex-col items-center" role="img" aria-label={`Level: tilted ${tilt.toFixed(1)} degrees from flat`}>
      <svg width="76" height="76" viewBox="0 0 80 80" aria-hidden>
        <circle cx="40" cy="40" r={R} fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.55)" strokeWidth="2" />
        <circle cx="40" cy="40" r={good} fill="none" stroke={TILT_COLOR.good} strokeWidth="1.5" strokeDasharray="3 3" />
        <line x1="40" y1="6" x2="40" y2="74" stroke="rgba(255,255,255,0.18)" />
        <line x1="6" y1="40" x2="74" y2="40" stroke="rgba(255,255,255,0.18)" />
        <circle cx={40 + b.x * reach} cy={40 + b.y * reach} r="6" fill={TILT_COLOR[cls]} stroke="rgba(0,0,0,0.6)" strokeWidth="1.5" />
      </svg>
      <span className="-mt-1 rounded bg-black/55 px-1.5 text-[11px] font-bold tabular-nums" style={{ color: TILT_COLOR[cls] }}>
        {tilt.toFixed(1)}°
      </span>
    </div>
  );
}

/** Recording progress: a ring that fills over the recording, with the seconds left in the middle. */
export function RecordRing({ elapsed, total }: { elapsed: number; total: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, Math.max(0, elapsed / total));
  return (
    <div className="relative size-14" role="img" aria-label={`${Math.max(0, Math.ceil(total - elapsed))} seconds left`}>
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden className="-rotate-90">
        <circle cx="28" cy="28" r={r} fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.25)" strokeWidth="4" />
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-extrabold tabular-nums">{Math.max(0, Math.ceil(total - elapsed))}</span>
    </div>
  );
}
