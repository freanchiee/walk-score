import { track } from "@vercel/analytics";

/**
 * Anonymous product events (Vercel Web Analytics custom events). No video, landmark, angle or identifier is
 * ever sent - only these event names and a few coarse labels. Note: custom events need a Vercel plan that
 * includes them; on localhost the script only logs to the console.
 */
export type WalkEvent =
  | { name: "scan_started" }
  | { name: "score_shown"; props: { label: string; quality: string; source: "camera" | "upload" } }
  | { name: "share_clicked"; props: { method: "web_share" | "download" } }
  | { name: "second_scan" };

export function trackEvent(event: WalkEvent): void {
  try {
    if ("props" in event) track(event.name, event.props);
    else track(event.name);
  } catch {
    /* analytics must never break the app */
  }
}
