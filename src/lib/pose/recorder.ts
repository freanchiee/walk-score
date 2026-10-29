import { pickMainBackCamera, shouldSwitchLens } from "../camera/lens";
import { CAPTURE_CONFIG } from "../config";

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
];

export function canRecord(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

export type CameraFacing = "environment" | "user";

/** The camera's own name for itself (readable once permission was granted), e.g. "Back Camera". */
export function cameraLabel(stream: MediaStream | null | undefined): string | null {
  return stream?.getVideoTracks()[0]?.label || null;
}

/**
 * Phones with several back cameras: make sure the plain main lens is the one in use, not the ultra-wide or a telephoto
 * (they frame and distort the feet differently), and ask for 1x zoom where the browser exposes zoom. Best effort: any
 * failure keeps the camera we already have.
 */
async function preferMainLens(stream: MediaStream): Promise<MediaStream> {
  let current = stream;
  try {
    const track = current.getVideoTracks()[0];
    if (!track) return current;
    const best = pickMainBackCamera(await navigator.mediaDevices.enumerateDevices());
    if (best && shouldSwitchLens(track.label, best)) {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: { exact: best.deviceId },
          width: { ideal: CAPTURE_CONFIG.idealWidth },
          height: { ideal: CAPTURE_CONFIG.idealHeight },
          frameRate: { ideal: 30 },
        },
      });
      stopStream(current);
      current = next;
    }
    const t = current.getVideoTracks()[0];
    const zoom = (t.getCapabilities?.() as { zoom?: { min: number; max: number } } | undefined)?.zoom;
    if (zoom && zoom.min < 1 && zoom.max >= 1) await t.applyConstraints({ advanced: [{ zoom: 1 }] } as unknown as MediaTrackConstraints).catch(() => undefined);
  } catch {
    /* keep the camera we have */
  }
  return current;
}

/** Opens the camera (video only; no microphone is ever requested). The back camera is the main lens where there is a choice. */
export async function openCamera(facing: CameraFacing): Promise<MediaStream> {
  const stream = await openCameraStream(facing);
  return facing === "environment" ? preferMainLens(stream) : stream;
}

async function openCameraStream(facing: CameraFacing): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: CAPTURE_CONFIG.idealWidth },
        height: { ideal: CAPTURE_CONFIG.idealHeight },
        frameRate: { ideal: 30 },
      },
    });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "OverconstrainedError" || err.name === "NotFoundError")) {
      return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }
    throw err;
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}

export interface Recording {
  blob: Blob;
  durationSec: number;
  mimeType: string;
}

export interface ActiveRecording {
  stop: () => void;
  done: Promise<Recording>;
}

/** Records the stream with MediaRecorder; stops by itself after `maxSeconds`. */
export function recordStream(stream: MediaStream, maxSeconds: number): ActiveRecording {
  const mimeType = pickMimeType();
  const rec = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 8_000_000,
  });
  const chunks: BlobPart[] = [];
  const startedAt = performance.now();
  const timer = setTimeout(() => {
    if (rec.state !== "inactive") rec.stop();
  }, maxSeconds * 1000);

  const done = new Promise<Recording>((resolve, reject) => {
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onerror = () => {
      clearTimeout(timer);
      reject(new Error("The recording failed."));
    };
    rec.onstop = () => {
      clearTimeout(timer);
      const type = rec.mimeType || mimeType || "video/webm";
      resolve({
        blob: new Blob(chunks, { type }),
        durationSec: (performance.now() - startedAt) / 1000,
        mimeType: type,
      });
    };
  });

  rec.start(250);

  return {
    stop: () => {
      if (rec.state !== "inactive") rec.stop();
    },
    done,
  };
}
