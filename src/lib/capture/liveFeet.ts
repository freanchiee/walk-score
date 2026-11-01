import { DEFAULT_TOPDOWN_OPTIONS } from "../topdown/analyze";
import { seededSegmentOptions, type FootSeed } from "../topdown/seed";
import { segmentFeet } from "../topdown/segment";

/**
 * How many whole feet (shape score high enough, not cut by the frame edge) the feet finder sees in one small frame: what the
 * live "Feet visible" chip is made of. With a foot the person tapped on the preview, its colour replaces the generic skin
 * test (and a frame where that finds nothing falls back to the skin test, so bare feet still count).
 */
export function countWholeFeet(rgba: ArrayLike<number>, w: number, h: number, seed: FootSeed | null = null): number {
  const seg = segmentFeet(rgba, w, h, seed ? seededSegmentOptions(seed) : undefined);
  return seg.blobs.filter((b) => b.score >= DEFAULT_TOPDOWN_OPTIONS.minBlobScore && !b.clipped).length;
}
