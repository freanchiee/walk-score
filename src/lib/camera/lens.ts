/**
 * Choosing the main back camera. Phones with several back cameras expose them as separate devices (Android Chrome) or as
 * labelled devices (iOS Safari); the ultra-wide and telephoto lenses distort or crop the feet differently, so the plain
 * wide "main" lens is the one to use. Labels are only readable after camera permission was granted.
 */
export interface CameraDevice {
  deviceId: string;
  label: string;
  kind?: string;
}

/** Higher = more likely to be the main (wide) back camera; front cameras are far below. */
export function lensScore(label: string): number {
  const l = label.toLowerCase();
  if (/\bfront\b|facetime|selfie|\buser\b|facing front/.test(l)) return -100;
  let s = 0;
  if (/\bback\b|\brear\b|environment|facing back/.test(l)) s += 10;
  if (/ultra/.test(l) || /\b0\.5x?\b/.test(l)) s -= 50;
  if (/tele|zoom|periscope|\b[2-9]x\b/.test(l)) s -= 40;
  if (/macro|depth|infrared|\bir\b|\btof\b|mono/.test(l)) s -= 60;
  // Android Chrome: "camera2 0, facing back": camera 0 is conventionally the main one
  const id = /camera2? (\d+),? facing back/.exec(l);
  if (id) s += 20 - 5 * Number(id[1]);
  return s;
}

/** The best back camera among several, or null when there is one or none (nothing to choose from). */
export function pickMainBackCamera(devices: CameraDevice[]): CameraDevice | null {
  const back = devices.filter((d) => (d.kind ?? "videoinput") === "videoinput" && d.label && lensScore(d.label) > -100);
  if (back.length < 2) return null;
  return back.reduce((best, d) => (lensScore(d.label) > lensScore(best.label) ? d : best));
}

/** Whether switching from the camera in use to the picked one is worth it (a clear improvement, not a tie). */
export function shouldSwitchLens(currentLabel: string, best: CameraDevice | null): boolean {
  return !!best && lensScore(best.label) > lensScore(currentLabel) + 5;
}
