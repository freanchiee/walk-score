import { describe, expect, it } from "vitest";
import { lensScore, pickMainBackCamera, shouldSwitchLens } from "../camera/lens";
import { frameLighting, lightStatus } from "./lighting";

const flat = (r: number, g: number, b: number, n = 400) => {
  const a = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) a.set([r, g, b, 255], i * 4);
  return a;
};

describe("light check", () => {
  it("is OK for an evenly lit floor", () => {
    const l = frameLighting(flat(150, 128, 100));
    expect(l.mean).toBeGreaterThan(120);
    expect(lightStatus(l)).toBe("ok");
  });

  it("flags dark, bright and heavily clipped frames", () => {
    expect(lightStatus(frameLighting(flat(30, 28, 25)))).toBe("dark");
    expect(lightStatus(frameLighting(flat(235, 232, 228)))).toBe("bright");
    // a half-blown, half-mid frame: acceptable mean but a clipped half
    const half = new Uint8ClampedArray(400 * 4);
    for (let i = 0; i < 400; i++) half.set(i < 80 ? [255, 255, 255, 255] : [140, 120, 100, 255], i * 4);
    const l = frameLighting(half, 1);
    expect(l.clippedHigh).toBeCloseTo(0.2, 5);
    expect(lightStatus(l)).toBe("clipped");
    // crushed shadows over a big share of the frame
    const shadow = new Uint8ClampedArray(400 * 4);
    for (let i = 0; i < 400; i++) shadow.set(i < 120 ? [0, 0, 0, 255] : [180, 160, 140, 255], i * 4);
    expect(lightStatus(frameLighting(shadow, 1))).toBe("clipped");
  });

  it("handles an empty frame without throwing", () => {
    expect(lightStatus(frameLighting(new Uint8ClampedArray(0)))).toBe("dark");
  });
});

describe("main lens choice", () => {
  const ios = [
    { deviceId: "a", label: "Front Camera", kind: "videoinput" },
    { deviceId: "b", label: "Back Ultra Wide Camera", kind: "videoinput" },
    { deviceId: "c", label: "Back Camera", kind: "videoinput" },
    { deviceId: "d", label: "Back Telephoto Camera", kind: "videoinput" },
    { deviceId: "m", label: "Microphone", kind: "audioinput" },
  ];
  const android = [
    { deviceId: "0", label: "camera2 0, facing back", kind: "videoinput" },
    { deviceId: "1", label: "camera2 1, facing front", kind: "videoinput" },
    { deviceId: "2", label: "camera2 2, facing back", kind: "videoinput" },
    { deviceId: "3", label: "camera2 3, facing back", kind: "videoinput" },
  ];

  it("prefers the plain back camera over ultra-wide and telephoto on iOS labels", () => {
    expect(pickMainBackCamera(ios)?.deviceId).toBe("c");
    expect(lensScore("Back Ultra Wide Camera")).toBeLessThan(lensScore("Back Camera"));
    expect(lensScore("Back Telephoto Camera")).toBeLessThan(lensScore("Back Camera"));
    expect(lensScore("Front Camera")).toBe(-100);
  });

  it("prefers camera 0 on Android, which is conventionally the main lens, and never a front camera", () => {
    expect(pickMainBackCamera(android)?.deviceId).toBe("0");
  });

  it("has nothing to choose from with one back camera, and only switches for a clear improvement", () => {
    expect(pickMainBackCamera([{ deviceId: "x", label: "Back Camera", kind: "videoinput" }, { deviceId: "y", label: "Front Camera", kind: "videoinput" }])).toBeNull();
    expect(pickMainBackCamera([{ deviceId: "x", label: "", kind: "videoinput" }])).toBeNull();
    const best = pickMainBackCamera(ios);
    expect(shouldSwitchLens("Back Ultra Wide Camera", best)).toBe(true);
    expect(shouldSwitchLens("Back Camera", best)).toBe(false);
    expect(shouldSwitchLens("Back Camera", null)).toBe(false);
  });
});
