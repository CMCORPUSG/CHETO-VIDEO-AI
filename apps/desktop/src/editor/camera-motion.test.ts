import { describe, expect, it } from "vitest";
import { cameraMotionAt, composeCanvasAndCamera } from "./camera-motion";

describe("cameraMotionAt", () => {
  const move = { startUs: 1_000_000, endUs: 3_000_000, transitionUs: 500_000, easing: "ease_in_out", zoom: 1.4, centerX: 0.7, centerY: 0.3 };
  it("uses source time for entry, hold and exit", () => {
    expect(cameraMotionAt(move, 1_000_000)).toEqual({ zoom: 1, centerX: 0.5, centerY: 0.5 });
    expect(cameraMotionAt(move, 1_500_000)).toEqual({ zoom: 1.4, centerX: 0.7, centerY: 0.3 });
    expect(cameraMotionAt(move, 2_750_000).zoom).toBeCloseTo(1.2);
    expect(cameraMotionAt(move, 3_000_000).zoom).toBe(1);
  });
  it("keeps persistent canvas scale separate from temporary camera scale", () => {
    const atHold = cameraMotionAt({ ...move, zoom: 1.32 }, 1_500_000);
    expect(composeCanvasAndCamera(1, 0, 0, atHold)).toMatchObject({ baseScale: 1, cameraScale: 1.32 });
    expect(composeCanvasAndCamera(1.1, 0.2, -0.1, { ...atHold, zoom: 1.2 })).toMatchObject({ baseScale: 1.1, baseOffsetX: 0.2, cameraScale: 1.2 });
  });
});
