import { describe, expect, it } from "vitest";
import type { EdlManifest } from "../project/contracts";
import { editedDurationUs, editedToSourceUs } from "./edl";
import { applyManualTrim, manualClipSegments, splitManualClip } from "./manual-trim";

const base = { tracks: { cuts: [] }, manualSplitPointsUs: [] } as unknown as EdlManifest;

describe("manual trim and split", () => {
  it("maps a 10–40 s trim of a 60 s source to a 30 s result", () => {
    const trim = applyManualTrim(base, 60_000_000, 10_000_000, 40_000_000)!;
    expect(editedDurationUs(60_000_000, trim.tracks.cuts)).toBe(30_000_000);
    expect(editedToSourceUs(0, trim.tracks.cuts, 60_000_000)).toBe(10_000_000);
    expect(editedToSourceUs(30_000_000, trim.tracks.cuts, 60_000_000)).toBe(40_000_000);
    expect(base.tracks.cuts).toEqual([]);
  });

  it("splits at 25 s without changing playback or duplicating media", () => {
    const split = splitManualClip(base, 60_000_000, 25_000_000)!;
    expect(manualClipSegments(split, 60_000_000)).toEqual([
      { id: "source-0", startUs: 0, endUs: 25_000_000 },
      { id: "source-1", startUs: 25_000_000, endUs: 60_000_000 },
    ]);
    expect(editedDurationUs(60_000_000, split.tracks.cuts)).toBe(60_000_000);
  });
});
