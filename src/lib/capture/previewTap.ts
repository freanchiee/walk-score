/**
 * Where on the camera picture a finger landed. The preview <video> is drawn with `object-fit: contain`, so the picture sits
 * inside the element with bars on two sides when the aspect ratios differ, and a front-camera preview is mirrored.
 */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The rectangle (in the coordinates of `box`) in which a video of vw x vh is drawn inside `box` with object-fit: contain. */
export function containedRect(box: Box, vw: number, vh: number): Box {
  if (!(vw > 0 && vh > 0 && box.width > 0 && box.height > 0)) return { left: box.left, top: box.top, width: 0, height: 0 };
  const scale = Math.min(box.width / vw, box.height / vh);
  const width = vw * scale;
  const height = vh * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/**
 * A pointer position over the preview element -> the position in the video picture, 0..1 from its top left corner (as the
 * picture is stored, so a mirrored preview is turned back). null when the pointer is on a bar beside the picture.
 */
export function previewPointToVideo(
  box: Box,
  vw: number,
  vh: number,
  clientX: number,
  clientY: number,
  mirrored = false,
): { x: number; y: number } | null {
  const r = containedRect(box, vw, vh);
  if (r.width <= 0 || r.height <= 0) return null;
  const u = (clientX - r.left) / r.width;
  const v = (clientY - r.top) / r.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { x: mirrored ? 1 - u : u, y: v };
}
