import { describe, expect, it } from "vitest";
import { countTranscriptWords, hardwareSummary, segmentSeekTarget, transcriptProgress, type HardwareProfile, type TranscriptSegment } from "./models";
import { transcriptionErrorMessage } from "./service";

const hardware = (gpu = ""): HardwareProfile => ({ architecture: "x86_64", cpu: "Test CPU", diskFreeBytes: 10, gpuAdapters: gpu ? [{ dedicatedVideoMemoryBytes: 8, deviceId: 2, name: gpu, vendor: "Test", vendorId: 1 }] : [], logicalCores: 12, physicalCores: 6, ramAvailableBytes: 8, ramTotalBytes: 16, transcriptionAcceleration: { available: false, backend: "cpu", computeTypes: [], reason: "test" } });
const segment = (startUs: number | null, words = 2): TranscriptSegment => ({ avgLogProb: null, endUs: 10, id: "s", noSpeechProb: null, startUs, text: "texto", words: Array.from({ length: words }, (_, index) => ({ endUs: index + 1, id: String(index), probability: .9, startUs: index, text: "x" })) });

describe("transcription presentation", () => {
  it("shows detected GPU", () => expect(hardwareSummary(hardware("Generic GPU"))).toBe("Generic GPU"));
  it("falls back to CPU label", () => expect(hardwareSummary(hardware())).toBe("Test CPU"));
  it("supports quality modes", () => expect(["auto", "fast", "balanced", "quality"]).toHaveLength(4));
  it("clamps progress", () => expect(transcriptProgress(120, 100)).toBe(100));
  it("supports indeterminate zero duration", () => expect(transcriptProgress(10, 0)).toBe(0));
  it("counts segments", () => expect([segment(0), segment(5)]).toHaveLength(2));
  it("counts words", () => expect(countTranscriptWords([segment(0, 2), segment(5, 3)])).toBe(5));
  it("maps segment click to seek", () => expect(segmentSeekTarget(segment(4_000_000))).toBe(4_000_000));
  it("keeps absent timestamp nullable", () => expect(segmentSeekTarget(segment(null))).toBeNull());
  it("handles backend errors", () => expect(transcriptionErrorMessage({ message: "modelo requerido" })).toBe("modelo requerido"));
  it("represents stale state", () => expect("stale").toBe("stale"));
  it("represents cancellation", () => expect("cancelled").toBe("cancelled"));
});
