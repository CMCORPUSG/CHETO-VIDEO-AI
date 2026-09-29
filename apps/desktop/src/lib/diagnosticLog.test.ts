import { describe, expect, it } from "vitest";
import { appendDiagnostic, pruneDiagnostics } from "./diagnosticLog";
import type { DiagnosticEvent } from "../types/diagnostics";

const now = Date.parse("2026-09-26T12:00:00.000Z");
const event = (message: string, timestamp = "2026-09-26T12:00:00.000Z", level: DiagnosticEvent["level"] = "info"): DiagnosticEvent => ({ id: message, message, timestamp, level, sessionId: "test" });

describe("diagnostic retention", () => {
  it("drops obsolete caption events and entries older than 24 hours", () => {
    const result = pruneDiagnostics([event("CAPTIONS_COMPLETED"), event("old", "2026-09-25T11:59:00.000Z"), event("current")], now);
    expect(result.map((item) => item.message)).toEqual(["current"]);
  });

  it("keeps errors while suppressing repetitive progress", () => {
    const progress = appendDiagnostic([], event("SMART_CAMERA_ANALYZING_VISUAL_CHANGES"), now);
    expect(progress).toEqual([]);
    const error = appendDiagnostic(progress, event("SMART_CAMERA_CONFLICT", undefined, "error"), now);
    expect(error).toHaveLength(1);
  });

  it("deduplicates immediate identical errors", () => {
    const first = event("FFMPEG_ERROR", undefined, "error");
    expect(appendDiagnostic([first], event("FFMPEG_ERROR", undefined, "error"), now)).toHaveLength(1);
  });
});
