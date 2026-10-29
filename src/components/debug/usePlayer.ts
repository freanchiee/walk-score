"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface Player {
  videoRef: RefObject<HTMLVideoElement | null>;
  idx: number;
  playing: boolean;
  seek: (i: number) => void;
  togglePlay: () => void;
  reset: () => void;
}

/**
 * Frame cursor for the debug views. Follows the <video> while it plays (frame = currentTime x fps) or, for
 * landmark-only data without a video, steps through the frames on a timer.
 */
export function usePlayer(n: number, fps: number): Player {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || n === 0) return;
    const v = videoRef.current;
    let raf = 0;
    let timer: number | undefined;
    if (v) {
      const loop = () => {
        setIdx(Math.min(n - 1, Math.max(0, Math.round(v.currentTime * fps))));
        if (v.ended || v.paused) {
          setPlaying(false);
          return;
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    } else {
      timer = window.setInterval(
        () =>
          setIdx((i) => {
            if (i >= n - 1) {
              setPlaying(false);
              return i;
            }
            return i + 1;
          }),
        1000 / fps,
      );
    }
    return () => {
      cancelAnimationFrame(raf);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [playing, n, fps]);

  const seek = useCallback(
    (i: number) => {
      if (n === 0) return;
      const c = Math.min(n - 1, Math.max(0, i));
      setPlaying(false);
      const v = videoRef.current;
      if (v) {
        v.pause();
        v.currentTime = c / fps;
      }
      setIdx(c);
    },
    [n, fps],
  );

  const togglePlay = useCallback(() => {
    if (n === 0) return;
    const v = videoRef.current;
    if (playing) {
      v?.pause();
      setPlaying(false);
      return;
    }
    if (idx >= n - 1) seek(0);
    if (v) void v.play();
    setPlaying(true);
  }, [n, playing, idx, seek]);

  const reset = useCallback(() => {
    setPlaying(false);
    setIdx(0);
  }, []);

  return { videoRef, idx, playing, seek, togglePlay, reset };
}
