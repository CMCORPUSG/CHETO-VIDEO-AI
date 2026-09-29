import { describe, expect, it } from "vitest";
import { classifyCut, classifyInterval, previewCamera, previewCuts } from "./conflicts";
import type { CutDecision, CameraDecision } from "../project/contracts";
import type { SmartCutSuggestion } from "../smart-cut/models";
import type { CameraSuggestion } from "../smart-camera/models";

const cut = (id: string, startUs: number, endUs: number): CutDecision => ({ id, startUs, endUs, action: "remove", confidence: null, reason: null });
const suggestion = (id: string, startUs: number, endUs: number): SmartCutSuggestion => ({ id, startUs, endUs, durationUs: endUs - startUs, confidence: 0.9, reason: "test", status: "accepted", suggestionType: "silence" });
const camera = (id: string, startUs: number, endUs: number, zoom: number): CameraDecision => ({ id, startUs, endUs, mode: "zoom", zoom, centerX: 0.5, centerY: 0.5, easing: "ease_in_out", confidence: null, reason: null });
const cameraSuggestion = (id: string, startUs: number, endUs: number, zoom: number): CameraSuggestion => ({ id, startUs, endUs, durationUs: endUs - startUs, suggestionType: "zoom", zoom, centerX: 0.5, centerY: 0.5, transitionUs: 0, confidence: 0.9, reason: "test", status: "accepted" });

describe("conflict preview", () => {
  it("distinguishes contained cuts from a real expansion", () => {
    const result = previewCuts([suggestion("inside", 43_000_000, 45_260_000), suggestion("expand", 45_000_000, 46_000_000)], [cut("old", 42_800_000, 45_500_000)]);
    expect(result.counts.contained).toBe(1);
    expect(result.counts.overlap).toBe(1);
  });

  it("reports conflicting camera details before apply", () => {
    const result = previewCamera([cameraSuggestion("new", 3_000_000, 5_000_000, 1.4)], [camera("old", 1_000_000, 4_000_000, 1.2)]);
    expect(result.counts.conflict).toBe(1);
    expect(result.conflicts[0].existing?.id).toBe("old");
  });

  it("treats adjacent ranges as separate", () => {
    expect(classifyInterval(cut("a", 0, 1_000_000), cut("b", 1_000_000, 2_000_000))).toBe("touching");
  });

  it("uses tolerance for duplicate cuts and blocks incompatible actions", () => {
    expect(classifyInterval(cut("a", 1_050_000, 3_060_000), cut("b", 1_000_000, 3_000_000))).toBe("duplicate");
    expect(classifyCut(suggestion("near", 1_000_000, 2_100_000), cut("old", 2_000_000, 3_000_000))).toBe("mergeable");
    expect(classifyCut(suggestion("large", 1_000_000, 3_000_000), cut("old", 2_000_000, 4_000_000))).toBe("overlap");
    expect(classifyCut(suggestion("large", 1_000_000, 3_000_000), { ...cut("old", 2_000_000, 4_000_000), action: "keep" })).toBe("conflict");
  });

  it("prevalidates conflicts inside a camera batch", () => {
    const result = previewCamera([
      cameraSuggestion("first", 1_000_000, 3_000_000, 1.2),
      cameraSuggestion("second", 2_000_000, 4_000_000, 1.5),
    ], []);
    expect(result.counts.new).toBe(1);
    expect(result.counts.conflict).toBe(1);
    expect(result.conflicts[0].existing?.id).toBe("first");
  });
});
