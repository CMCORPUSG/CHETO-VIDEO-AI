import { describe, expect, it } from "vitest";
import { applyAudioEventActions, audioEventPreviewRange, type AudioEvent } from "./audio-intelligence";

const event: AudioEvent = {
  id: "speech-10000000",
  eventType: "voice",
  originalLabel: "WebRTC VAD: speech",
  startUs: 10_000_000,
  endUs: 12_000_000,
  confidence: 0.8,
};

describe("audio intelligence EDL actions", () => {
  it("maps mute, attenuation and cleanup to existing export operations", () => {
    const muted = applyAudioEventActions([], [event], { [event.id]: "mute" });
    expect(muted[0]).toMatchObject({ operation: "mute_range", startUs: 10_000_000, endUs: 12_000_000 });
    const quieter = applyAudioEventActions(muted, [event], { [event.id]: "attenuate12" });
    expect(quieter).toHaveLength(1);
    expect(quieter[0]).toMatchObject({ operation: "gain_range", parameters: { gainDb: -12 } });
    const cleaned = applyAudioEventActions(quieter, [event], { [event.id]: "clean" });
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0]).toMatchObject({ operation: "noise_reduction_range", parameters: { amount: 0.45 } });
    expect(applyAudioEventActions(cleaned, [event], { [event.id]: "keep" })).toEqual([]);
  });

  it("keeps unrelated decisions during a batch", () => {
    const other = { id: "other", startUs: 0, endUs: 30_000_000, operation: "master_gain", parameters: { gainDb: 3 } };
    const result = applyAudioEventActions([other], [event], { [event.id]: "attenuate6" });
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(other);
    expect(result[1].parameters.gainDb).toBe(-6);
  });

  it("previews only a bounded region with context", () => {
    expect(audioEventPreviewRange(event, 30_000_000)).toEqual({ startUs: 8_000_000, endUs: 14_000_000 });
    expect(audioEventPreviewRange({ ...event, endUs: 100_000_000 }, 120_000_000))
      .toEqual({ startUs: 8_000_000, endUs: 28_000_000 });
  });
});
