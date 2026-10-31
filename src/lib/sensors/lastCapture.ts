import type { SeedSummary } from "../analysis/types";
import type { CaptureInfo, CaptureReport } from "./capture";

/**
 * The most recent camera capture of this page session, so /debug can show what the sensors said about it. Held in memory
 * only (a module variable): gone on reload, never stored, never uploaded.
 */
export interface LastCapture {
  info: CaptureInfo | null;
  report: CaptureReport | null;
  /** the rejection message when the scan was turned down */
  failure: string | null;
  /** what the person's tap on a toe gap taught the feet finder, when they tapped one */
  seed: SeedSummary | null;
  /** performance.now() when the analysis finished */
  at: number;
}

let last: LastCapture | null = null;

export const setLastCapture = (v: LastCapture | null): void => {
  last = v;
};

export const getLastCapture = (): LastCapture | null => last;
