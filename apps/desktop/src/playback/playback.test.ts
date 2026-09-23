import { describe, expect, it } from "vitest";
import { nextPlaybackState, preferredPlaybackKind, type ProxyStatus } from "./models";
import { clampTimelineUs, formatPlaybackTime, secondsToUs, timelineProgress, usToSeconds } from "./time";
import { playbackErrorMessage } from "./service";

const status = (state: ProxyStatus["state"]): ProxyStatus => ({ message: null, metadata: null, processedUs: null, progress: null, state });

describe("playback timebase", () => {
  it("converts seconds to integer microseconds", () => expect(secondsToUs(1.2345674)).toBe(1_234_567));
  it("converts microseconds to seconds", () => expect(usToSeconds(2_500_000)).toBe(2.5));
  it("clamps values to the authoritative timeline", () => expect(clampTimelineUs(70_000_000, 58_000_000)).toBe(58_000_000));
  it("formats hh:mm:ss", () => expect(formatPlaybackTime(3_661_900_000)).toBe("01:01:01"));
  it("calculates visual progress", () => expect(timelineProgress(29_000_000, 58_000_000)).toBe(50));
});

describe("playback state", () => {
  it("moves through player events", () => {
    expect(nextPlaybackState("idle", "load")).toBe("loading");
    expect(nextPlaybackState("ready", "play")).toBe("playing");
    expect(nextPlaybackState("playing", "pause")).toBe("paused");
    expect(nextPlaybackState("playing", "end")).toBe("ended");
  });
  it("selects a valid proxy automatically", () => expect(preferredPlaybackKind(status("available"), "auto")).toBe("proxy"));
  it("falls back to original when proxy is stale", () => expect(preferredPlaybackKind(status("stale"), "proxy")).toBe("original"));
  it("returns controlled errors", () => expect(playbackErrorMessage({ message: "falló" })).toBe("falló"));
  it("represents proxy states without fake progress", () => expect(status("preparing").progress).toBeNull());
});
