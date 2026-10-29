import type { AnalysisResult, VideoInfo } from "@/lib/analysis/types";
import type { Pt } from "@/lib/calibration/measure";
import type { DirectionLine, Mark, MarkReading } from "@/lib/calibration/session";
import type { LoadedVideo } from "@/lib/pose/video";
import type { TopDownFrame } from "@/lib/topdown/analyze";

/** One clip on the calibration page, from the moment it is added until it is removed. */
export interface Clip {
  id: number;
  name: string;
  /** the video itself, so a recording made on this page can be saved and run through `npm run validate` */
  file: Blob;
  status: "working" | "ready" | "failed";
  progress?: { stage: string; done: number; total: number };
  error?: string;
  video?: VideoInfo;
  frames?: TopDownFrame[];
  /** the decoder the frames are drawn from while measuring (kept alive until the clip is removed) */
  loaded?: LoadedVideo;
  marks: Mark[];
  /** the walking direction the person drew, in video pixels */
  line: DirectionLine | null;
  /** measure against the person's own line instead of the app's direction */
  useOwn: boolean;
}

export interface ReadyClip extends Clip {
  status: "ready";
  video: VideoInfo;
  frames: TopDownFrame[];
  loaded: LoadedVideo;
}

export const isReady = (c: Clip): c is ReadyClip => c.status === "ready" && !!c.video && !!c.frames && !!c.loaded;

/** What the app says about a clip with the offsets switched off, and the person's marks read against the same direction. */
export interface ClipAnalysis {
  result: AnalysisResult;
  fwdApp: Pt;
  fwd: Pt;
  usingOwn: boolean;
  readings: MarkReading[];
}
