import { describe, expect, it } from "vitest";
import { createTitle } from "../visual/titles";
import { TEMPLATE_REGISTRY } from "./registry";
import { canvasToScreen, editLayerLayout, editLayerOverride, layerForParameter, layerText, resetLayerPosition, resolveLayerLayout, screenToCanvas, titleLayers } from "./layers";

describe("editable template layers", () => {
  it("gives every family stable text layers and locked decorative layers", () => {
    for (const manifest of TEMPLATE_REGISTRY.listTemplates()) {
      expect(manifest.layers?.some(layer => layer.parameterId === "text" && layer.editable)).toBe(true);
      expect(new Set(manifest.layers?.map(layer => layer.layerId)).size).toBe(manifest.layers?.length);
      expect(manifest.layers?.filter(layer => layer.type === "shape").every(layer => layer.locked && !layer.editable)).toBe(true);
    }
  });

  it("persists text and independent positions for landscape and portrait", () => {
    const source = createTitle("future-glow", 0, 8_000_000);
    const primary = layerForParameter(source, "text")!.layerId;
    const secondary = layerForParameter(source, "secondaryText")!.layerId;
    const edited = editLayerLayout(editLayerLayout(editLayerOverride(source, secondary, { text: "LIMA", fill: "#FFAA33" }), primary, 16 / 9, { x: 0.31, y: 0.63, scale: 1.4 }), primary, 9 / 16, { x: 0.45, y: 0.72 });
    expect(layerText(edited, secondary)).toBe("LIMA");
    expect(edited.secondaryText).toBe("LIMA");
    expect(resolveLayerLayout(edited, primary, 16 / 9)).toMatchObject({ x: 0.31, y: 0.63, scale: 1.4 });
    expect(resolveLayerLayout(edited, primary, 9 / 16)).toMatchObject({ x: 0.45, y: 0.72, scale: 1 });
    expect(resolveLayerLayout(resetLayerPosition(edited, primary, 16 / 9), primary, 16 / 9).x).not.toBe(0.31);
    expect(titleLayers(edited).find(layer => layer.layerId === secondary)?.editable).toBe(true);
  });

  it("maps pointer coordinates through the actual stage bounds", () => {
    const bounds = { left: 120, top: 80, width: 800, height: 450 };
    expect(screenToCanvas(520, 305, bounds)).toEqual({ x: 0.5, y: 0.5 });
    expect(canvasToScreen({ x: 0.5, y: 0.5 }, bounds)).toEqual({ x: 520, y: 305 });
  });
});
