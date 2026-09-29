import { describe, expect, it } from "vitest";
import { measuredRenderProgress } from "./progress";

describe("measured export speed", () => {
  it("waits for enough real progress and estimates the remaining duration", () => {
    expect(measuredRenderProgress(1_000_000, 50_000_000, 1)).toBeNull();
    expect(measuredRenderProgress(15_000_000, 45_000_000, 10)).toEqual({ speed: 1.5, remainingSeconds: 20 });
  });
});
