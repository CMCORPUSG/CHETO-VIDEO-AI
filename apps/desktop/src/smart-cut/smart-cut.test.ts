import { describe, expect, it } from "vitest";
import { acceptedSuggestions, smartCutProgressPercent, smartCutSeekTarget, type SmartCutDocument, type SmartCutSuggestion } from "./models";
import { smartCutErrorMessage } from "./service";

const suggestion = (status: SmartCutSuggestion["status"]): SmartCutSuggestion => ({ confidence: .9, durationUs: 500_000, endUs: 1_500_000, id: status, reason: "test", startUs: 1_000_000, status, suggestionType: "silence" });
const document = (suggestions: SmartCutSuggestion[]): SmartCutDocument => ({ createdAt: "now", profile: "normal", projectId: "p", schemaVersion: 1, source: { durationUs: 2_000_000, fileSizeBytes: 1, modifiedAt: null }, sourceId: "s", statistics: { accepted: 1, falseStart: 0, filler: 0, pending: 1, rejected: 1, repetition: 0, silence: 3, total: 3 }, status: "completed", suggestions, updatedAt: "now" });

describe("Smart Cut presentation", () => {
  it("calculates real staged progress", () => expect(smartCutProgressPercent({ completedSteps: 2, projectId: "p", stage: "analyzing_silences", totalSteps: 5 })).toBe(40));
  it("clamps progress", () => expect(smartCutProgressPercent({ completedSteps: 8, projectId: "p", stage: "completed", totalSteps: 5 })).toBe(100));
  it("filters only accepted suggestions", () => expect(acceptedSuggestions(document([suggestion("accepted"), suggestion("pending"), suggestion("rejected")]))).toHaveLength(1));
  it("maps suggestion to player seek", () => expect(smartCutSeekTarget(suggestion("pending"))).toBe(1_000_000));
  it("keeps stale state explicit", () => expect({ ...document([]), status: "stale" as const }.status).toBe("stale"));
  it("returns controlled errors", () => expect(smartCutErrorMessage({ message: "Transcribe primero" })).toBe("Transcribe primero"));
  it("supports three profiles", () => expect(["conservative", "normal", "aggressive"]).toHaveLength(3));
});
