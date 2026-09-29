import { describe, expect, it } from "vitest";
import { coverPlacement, type ProjectCover } from "./cover";

describe("project cover placement", () => {
  const base: ProjectCover = { path: "cover.jpg", fit: "cover", scale: 1, offsetX: 0, offsetY: 0 };
  it("fills a portrait frame without stretching a landscape image", () => {
    const result = coverPlacement(16 / 9, 9 / 16, base);
    expect(parseFloat(result.width)).toBeGreaterThan(100);
    expect(result.height).toBe("100%");
  });
  it("centers the contained image and respects repositioning", () => {
    const result = coverPlacement(16 / 9, 9 / 16, { ...base, fit: "contain", offsetY: 1 });
    expect(result.width).toBe("100%");
    expect(parseFloat(result.top) + parseFloat(result.height)).toBeCloseTo(100);
  });
});
