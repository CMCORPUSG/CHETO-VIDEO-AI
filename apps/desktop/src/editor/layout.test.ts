import { describe, expect, it } from "vitest";
import { canvasTranslationPercent, clampPanelWidth, fitViewer, inspectorFor, panelIsVisible, previewSizeClass, resolveAspectRatio } from "./layout";

describe("editor layout", () => {
  it("shows the inspector for the remaining tools", () => {
    expect(panelIsVisible("project", "project")).toBe(true);
    expect(panelIsVisible("cut", "project")).toBe(false);
    expect(inspectorFor("camera")).toBe("camera");
  });
  it("keeps preview bounds compact", () => {
    expect(previewSizeClass("medium")).toContain("max-w-4xl");
  });
  it("resolves standard and custom aspect ratios", () => {
    expect(resolveAspectRatio("9:16", 2)).toBeCloseTo(9 / 16);
    expect(resolveAspectRatio("original", 4 / 3)).toBeCloseTo(4 / 3);
    expect(resolveAspectRatio("custom", 3, 3, 2)).toBeCloseTo(1.5);
  });
  it("keeps persisted panel widths inside safe bounds", () => {
    expect(clampPanelWidth(20, 64, 260)).toBe(64);
    expect(clampPanelWidth(600, 240, 520)).toBe(520);
  });
  it("fits portrait, square and wide canvases within the actual viewer", () => {
    for (const ratio of [9 / 16, 1, 4 / 3, 16 / 9, 21 / 9]) {
      const fit = fitViewer(720, 310, ratio, 100);
      expect(fit.width).toBeLessThanOrEqual(720);
      expect(fit.height).toBeLessThanOrEqual(310);
      expect(fit.width / fit.height).toBeCloseTo(ratio);
    }
    expect(fitViewer(720, 310, 9 / 16, 50).height).toBeCloseTo(155);
  });
  it("positions the scaled canvas like the export crop and pad", () => {
    expect(canvasTranslationPercent(1, 1)).toBe(0);
    expect(canvasTranslationPercent(1.5, 1)).toBe(25);
    expect(canvasTranslationPercent(0.5, -1)).toBe(-25);
  });
});
