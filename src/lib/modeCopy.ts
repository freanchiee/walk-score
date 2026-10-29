import { CAPTURE_CONFIG, CAPTURE_MODE, type CaptureMode } from "./config";

/** Words the user reads, per capture mode. Keep the on-screen guide, capture hints and error tips in one place. */
export interface ModeCopy {
  /** one-line description under the headline on the landing screen */
  pitch: string;
  /** the on-screen guide */
  steps: string[];
  /** intro on the capture-choice screen */
  captureIntro: string;
  /** what to do while the camera preview is up */
  recordHint: string;
  /** shown over the preview during the countdown / while recording */
  countdownHint: string;
  recordingHint: string;
  errorTips: string[];
}

export const MODE_COPY: Record<CaptureMode, ModeCopy> = {
  topdown: {
    pitch: "Point your phone down at your feet, take a few steps, and get a score, a fun label and a card to show off.",
    steps: [
      "Stand barefoot on a plain, evenly lit floor. Busy rugs and patterned tiles confuse the camera.",
      "Hold your phone flat in front of you, screen up, back camera pointing at the floor, so both feet are in the picture and the top of the phone points the way you will walk. The bubble on screen shows when it is level.",
      `Tap Start. When Feet visible, Light OK, Level and Steady are all green, a 3-2-1 runs, then it records about ${CAPTURE_CONFIG.maxRecordSec} seconds. Glance at the screen during setup, then look ahead and walk normally in a straight line (about ${CAPTURE_CONFIG.maxRecordSec} m of clear floor).`,
      "Avoid shadows over your feet and walk at your usual relaxed pace. The score reads your steps.",
    ],
    captureIntro: `About ${CAPTURE_CONFIG.maxRecordSec} seconds of your bare feet seen from above while you walk normally. Your phone's motion sensors help check that it is level and steady.`,
    recordHint: `Hold the phone flat in front of you, glance at the screen during setup, then look ahead and walk normally. Tap Start: the countdown runs while all four checks are green, and recording stops by itself after ${CAPTURE_CONFIG.maxRecordSec} seconds.`,
    countdownHint: "Recording starts… hold the phone flat and steady",
    recordingHint: "Look ahead and walk normally in a straight line. Keep the phone flat and steady.",
    errorTips: [
      "Bare feet on a plain, evenly lit floor work best; avoid busy rugs, tiles and strong shadows.",
      "Hold the phone flat in front of you with the back camera at the floor and both feet fully in the picture; keep the level bubble in the green ring.",
      "Walk normally in a straight line for the whole recording (at least 6 steps) and keep the phone steady.",
      "Keep your feet away from the very edge of the picture so they are not cut off.",
    ],
  },
  front: {
    pitch: "Walk toward your phone for a few seconds and get a score, a fun label and a card to show off.",
    steps: [
      "Put your phone on the floor or a low surface at about knee height (~50 cm), facing you.",
      "Stand 3–4 m away so your whole body is in frame and your feet are clearly visible.",
      "Walk straight toward the phone at your normal pace for about 10 seconds.",
      "Use good light and a clear floor. Shoes are fine; long trousers that cover your feet make it harder.",
    ],
    captureIntro: "About 10 seconds of you walking straight toward the phone, with your feet in view. A few steps are enough.",
    recordHint: `Place the phone low and facing your walking path, then press Start. You get ${CAPTURE_CONFIG.countdownSec} seconds to walk back 3–4 m and turn round. Recording stops by itself after ${CAPTURE_CONFIG.maxRecordSec} seconds.`,
    countdownHint: "Recording starts… walk back to your spot",
    recordingHint: "Walk straight toward the phone at your normal pace.",
    errorTips: [
      "Phone on the floor or a low surface, about knee height, facing you and not moving.",
      "Stand 3–4 m away with your whole body and both feet in frame.",
      "Walk straight toward the phone at a relaxed pace for several steps.",
      "Good light, a clear floor, and one person in the shot.",
    ],
  },
};

export const copy: ModeCopy = MODE_COPY[CAPTURE_MODE];
