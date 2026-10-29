/** Helpers for decoding a local video file frame by frame. Nothing here ever uploads the video. */

export interface LoadedVideo {
  video: HTMLVideoElement;
  /** seconds; may come from `durationHint` for MediaRecorder files */
  duration: number;
  width: number;
  height: number;
  dispose: () => void;
}

function once(target: EventTarget, ok: string, timeoutMs: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for the video (${what}).`));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error("This video could not be read. Try an MP4 or MOV recorded on your phone."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(ok, onOk);
      target.removeEventListener("error", onErr);
    };
    target.addEventListener(ok, onOk, { once: true });
    target.addEventListener("error", onErr, { once: true });
  });
}

/** Seek to `t` seconds and resolve once the browser has the frame (or after `timeoutMs`, best effort). */
export function seekTo(video: HTMLVideoElement, t: number, timeoutMs = 6000): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 1e-3 && video.readyState >= 2) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = t;
  });
}

/**
 * Files written by MediaRecorder (WebM) carry no duration, so `video.duration` is Infinity. Seeking far
 * past the end makes the browser scan the file and settle on the real duration.
 */
async function ensureDuration(video: HTMLVideoElement, hint?: number): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  await new Promise<void>((resolve) => {
    const check = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) done();
    };
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener("durationchange", check);
      video.removeEventListener("timeupdate", check);
      resolve();
    };
    const timer = setTimeout(done, 5000);
    video.addEventListener("durationchange", check);
    video.addEventListener("timeupdate", check);
    video.currentTime = 1e7;
  });
  const d = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (hint ?? NaN);
  await seekTo(video, 0);
  return d;
}

/**
 * Loads a video Blob/File into an off-screen <video>. The element is kept in the DOM (tiny and
 * transparent) because some mobile browsers do not decode frames for detached elements.
 */
export async function loadVideo(source: Blob, opts: { durationHint?: number } = {}): Promise<LoadedVideo> {
  const url = URL.createObjectURL(source);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("playsinline", "");
  video.setAttribute("aria-hidden", "true");
  Object.assign(video.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "2px",
    height: "2px",
    opacity: "0.01",
    pointerEvents: "none",
    zIndex: "-1",
  });
  document.body.appendChild(video);
  const dispose = () => {
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  };
  try {
    video.src = url;
    await once(video, "loadedmetadata", 20000, "metadata");
    if (video.readyState < 2) await once(video, "loadeddata", 20000, "first frame");
    const duration = await ensureDuration(video, opts.durationHint);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not determine the length of this video.");
    if (!video.videoWidth || !video.videoHeight) throw new Error("This file has no video picture.");
    return { video, duration, width: video.videoWidth, height: video.videoHeight, dispose };
  } catch (err) {
    dispose();
    throw err;
  }
}
