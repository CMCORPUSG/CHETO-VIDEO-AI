import { describe, expect, it } from "vitest";
import { clampPanelWidth, inspectorFor, panelIsVisible, previewSizeClass, resolveAspectRatio } from "./layout";

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
});
