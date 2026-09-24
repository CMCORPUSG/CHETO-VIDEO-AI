import { describe, expect, it } from "vitest";
import { acceptedCameraSuggestions, activeCameraAt, cameraProgressPercent, toCameraPreview, type CameraSuggestion, type SmartCameraDocument } from "./models";

const suggestion = (status: CameraSuggestion["status"]): CameraSuggestion => ({ centerX: 0.75, centerY: 0.4, confidence: 0.9, durationUs: 2_000_000, endUs: 3_000_000, id: status, reason: "test", startUs: 1_000_000, status, suggestionType: "focus", transitionUs: 500_000, zoom: 1.2 });
const document = (suggestions: CameraSuggestion[]): SmartCameraDocument => ({ createdAt: "now", profile: "normal", projectId: "p", schemaVersion: 1, source: { durationUs: 5_000_000, fileSizeBytes: 1, modifiedAt: null }, sourceId: "s", statistics: { accepted: 1, focus: 1, pending: 1, rejected: 1, reset: 0, total: 3, zoom: 0 }, status: "completed", suggestions, updatedAt: "now" });

describe("Smart Camera models", () => {
  it("filters only accepted suggestions", () => {
    expect(acceptedCameraSuggestions(document([suggestion("accepted"), suggestion("pending"), suggestion("rejected")]))).toHaveLength(1);
  });

  it("activates a preview only inside its exact interval", () => {
    const preview = toCameraPreview(suggestion("pending"));
    expect(activeCameraAt(preview, 999_999)).toBeNull();
    expect(activeCameraAt(preview, 1_000_000)?.zoom).toBe(1.2);
    expect(activeCameraAt(preview, 2_999_999)?.centerX).toBe(0.75);
    expect(activeCameraAt(preview, 3_000_000)).toBeNull();
  });

  it("clamps reported progress", () => {
    expect(cameraProgressPercent({ durationUs: 10, processedUs: 12, progress: null, projectId: "p", stage: "analyzing_visual_changes" })).toBe(100);
    expect(cameraProgressPercent({ durationUs: 10, processedUs: 0, progress: -4, projectId: "p", stage: "extracting_samples" })).toBe(0);
  });
});
