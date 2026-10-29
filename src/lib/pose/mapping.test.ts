import { describe, expect, it } from "vitest";
import { resultToFrame } from "./mapping";

const lm = (i: number, visibility?: number) => ({ x: i / 100, y: i / 50, z: -i / 200, visibility });
const pose = (visibility?: number) => Array.from({ length: 33 }, (_, i) => lm(i, visibility));

describe("resultToFrame", () => {
  it("copies image and world landmarks and renames visibility to v", () => {
    const res = { landmarks: [pose(0.8)], worldLandmarks: [pose(0.7)] };
    const f = resultToFrame(1.25, res);
    expect(f.ok).toBe(true);
    expect(f.t).toBe(1.25);
    expect(f.img).toHaveLength(33);
    expect(f.world).toHaveLength(33);
    expect(f.img?.[29]).toEqual({ x: 0.29, y: 0.58, z: -0.145, v: 0.8 });
    expect(f.world?.[31].v).toBe(0.7);
  });

  it("does not alias the runtime's (reused) objects", () => {
    const res = { landmarks: [pose(1)], worldLandmarks: [pose(1)] };
    const f = resultToFrame(0, res);
    res.landmarks[0][5].x = 99;
    expect(f.img?.[5].x).not.toBe(99);
  });

  it("defaults missing visibility to 1", () => {
    const f = resultToFrame(0, { landmarks: [pose()], worldLandmarks: [pose()] });
    expect(f.img?.[0].v).toBe(1);
  });

  it("reports no pose for empty or short results", () => {
    expect(resultToFrame(0, { landmarks: [], worldLandmarks: [] }).ok).toBe(false);
    expect(resultToFrame(0, undefined).ok).toBe(false);
    expect(resultToFrame(0, { landmarks: [pose().slice(0, 20)], worldLandmarks: [pose()] }).ok).toBe(false);
  });
});
