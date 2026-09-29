import { describe, expect, it } from "vitest";
import { visibleThumbnailTimes, waveformPath } from "./visuals";

describe("timeline visuals", () => {
  it("bounds thumbnail work for a two-hour viewport", () => {
    const times = visibleThumbnailTimes(0, 7_200_000_000, 0.12);
    expect(times.length).toBeLessThanOrEqual(32);
    expect(times[0]).toBe(0);
    expect(times[1]).toBeGreaterThan(times[0]);
  });

  it("adds more thumbnails when the timeline is zoomed in", () => {
    const distant = visibleThumbnailTimes(0, 60_000_000, 2);
    const close = visibleThumbnailTimes(0, 60_000_000, 20);
    expect(close.length).toBeGreaterThan(distant.length);
  });

  it("draws silence and peaks at their own amplitudes", () => {
    const path = waveformPath([0, 1], 34);
    expect(path).toContain("M0.5 16.5V17.5");
    expect(path).toContain("M1.5 2V32");
  });
});
