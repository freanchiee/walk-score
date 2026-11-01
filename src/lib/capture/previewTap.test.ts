import { describe, expect, it } from "vitest";
import { containedRect, previewPointToVideo } from "./previewTap";

describe("where a finger landed on the camera preview", () => {
  // a portrait picture (1080 x 1920) in a box that is wider than it needs to be: bars left and right
  const box = { left: 20, top: 100, width: 360, height: 500 };

  it("draws the picture centred inside the box, as object-fit: contain does", () => {
    const r = containedRect(box, 1080, 1920);
    expect(r.height).toBeCloseTo(500, 6);
    expect(r.width).toBeCloseTo(500 * (1080 / 1920), 6); // 281.25
    expect(r.left).toBeCloseTo(20 + (360 - 281.25) / 2, 6);
    expect(r.top).toBeCloseTo(100, 6);
    // a landscape picture in a tall box: bars above and below
    const l = containedRect({ left: 0, top: 0, width: 300, height: 600 }, 1920, 1080);
    expect(l.width).toBeCloseTo(300, 6);
    expect(l.height).toBeCloseTo(300 * (1080 / 1920), 6);
    expect(l.top).toBeCloseTo((600 - l.height) / 2, 6);
  });

  it("maps a position over the picture to 0..1 in the picture", () => {
    const r = containedRect(box, 1080, 1920);
    const c = previewPointToVideo(box, 1080, 1920, r.left + r.width / 2, r.top + r.height / 2);
    expect(c?.x).toBeCloseTo(0.5, 6);
    expect(c?.y).toBeCloseTo(0.5, 6);
    const q = previewPointToVideo(box, 1080, 1920, r.left + r.width * 0.25, r.top + r.height * 0.8);
    expect(q?.x).toBeCloseTo(0.25, 6);
    expect(q?.y).toBeCloseTo(0.8, 6);
    // the corners of the picture itself
    const topLeft = previewPointToVideo(box, 1080, 1920, r.left, r.top);
    expect(topLeft?.x).toBeCloseTo(0, 9);
    expect(topLeft?.y).toBeCloseTo(0, 9);
    const bottomRight = previewPointToVideo(box, 1080, 1920, r.left + r.width, r.top + r.height - 1e-9);
    expect(bottomRight?.x).toBeCloseTo(1, 6);
    expect(bottomRight?.y).toBeCloseTo(1, 6);
  });

  it("ignores a finger on a bar beside the picture", () => {
    expect(previewPointToVideo(box, 1080, 1920, 25, 300)).toBeNull(); // left bar
    expect(previewPointToVideo(box, 1080, 1920, 375, 300)).toBeNull(); // right bar
    expect(previewPointToVideo(box, 1080, 1920, 200, 50)).toBeNull(); // above the box
    expect(previewPointToVideo({ left: 0, top: 0, width: 300, height: 600 }, 1920, 1080, 150, 10)).toBeNull(); // bar above a landscape picture
  });

  it("turns a mirrored (front camera) preview back to the picture as it is stored", () => {
    const r = containedRect(box, 1080, 1920);
    const p = previewPointToVideo(box, 1080, 1920, r.left + r.width * 0.2, r.top + r.height * 0.3, true);
    expect(p?.x).toBeCloseTo(0.8, 6);
    expect(p?.y).toBeCloseTo(0.3, 6);
  });

  it("gives nothing before the video has a size", () => {
    expect(previewPointToVideo(box, 0, 0, 100, 200)).toBeNull();
    expect(previewPointToVideo({ left: 0, top: 0, width: 0, height: 0 }, 1080, 1920, 0, 0)).toBeNull();
  });
});
