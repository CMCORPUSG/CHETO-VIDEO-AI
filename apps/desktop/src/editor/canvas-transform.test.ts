import { describe, expect, it } from "vitest";
import { isValidCanvasScale, normalizeCanvasScale } from "./canvas-transform";

describe("canvas transform scale", () => {
  it("normalizes invalid legacy values to 100%", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined, null]) {
      expect(normalizeCanvasScale(value)).toBe(1);
      expect(isValidCanvasScale(value)).toBe(false);
    }
  });

  it("preserves valid custom scales", () => {
    for (const value of [0.5, 0.8, 1, 1.15, 1.5, 2.5]) {
      expect(normalizeCanvasScale(value)).toBe(value);
      expect(isValidCanvasScale(value)).toBe(true);
    }
  });
});
