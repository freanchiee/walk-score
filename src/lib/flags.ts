import { DEFAULT_EXPERIMENTS, type ExperimentFlags } from "./config";

const ALIASES: Record<string, keyof ExperimentFlags> = {
  yaw: "yawCheck",
  yawcheck: "yawCheck",
  yawreject: "yawReject",
  flow: "floorFlow",
  floorflow: "floorFlow",
  tilt: "tiltCorrection",
  tiltcorrection: "tiltCorrection",
};

/**
 * The experimental switches: the defaults in config.ts, plus whatever `?exp=` on the page address turns on, e.g.
 * `?exp=yaw,flow,tilt`. `?exp=none` forces everything off. Only the address bar can change them: nothing is stored.
 */
export function parseExperiments(search: string, defaults: ExperimentFlags = DEFAULT_EXPERIMENTS): ExperimentFlags {
  const value = new URLSearchParams(search).get("exp");
  if (value === null) return { ...defaults };
  const out: ExperimentFlags = value.toLowerCase() === "none" ? { yawCheck: false, yawReject: false, floorFlow: false, tiltCorrection: false } : { ...defaults };
  for (const token of value.toLowerCase().split(/[,\s+]+/)) {
    const key = ALIASES[token];
    if (key) out[key] = true;
  }
  if (out.yawReject) out.yawCheck = true; // rejecting needs the check
  return out;
}

/** The flags in force on this page (the defaults on the server). */
export function experimentFlags(): ExperimentFlags {
  return typeof window === "undefined" ? { ...DEFAULT_EXPERIMENTS } : parseExperiments(window.location.search);
}
