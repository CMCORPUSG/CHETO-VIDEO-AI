import { describe, expect, it } from "vitest";
import { amplitudeDb, audioLevels } from "./audio-levels";

describe("audio levels", () => {
  it("reports silence without a misleading finite number", () => expect(amplitudeDb(0)).toBe("−∞ dB"));
  it("derives peak and average from measured amplitudes", () => {
    const result = audioLevels({ startUs: 0, endUs: 20_000, peaks: [1, 0], rms: [0.5, 0] });
    expect(result.peakDb).toBe("0.0 dB");
    expect(result.averageDb).toBe("-9.0 dB");
  });
});
