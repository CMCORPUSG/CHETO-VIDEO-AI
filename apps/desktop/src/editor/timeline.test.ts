import { describe, expect, it } from "vitest";
import { editCamera, moveRange, pixelsToUs, resizeRange, rulerStepUs, snapTimeUs, timelineWidth, usToPixels } from "./timeline";

describe("timeline math", () => {
  it("round-trips pixels and microseconds", () => expect(pixelsToUs(usToPixels(12_345_000, 80), 80)).toBe(12_345_000));
  it.each([58,600,3600,7200])("keeps %i seconds scrollable and readable", (seconds) => { const width=timelineWidth(seconds*1_000_000,4,800); expect(width).toBeGreaterThanOrEqual(800); expect(rulerStepUs(4)).toBeGreaterThan(0); });
  it("moves a block preserving duration", () => expect(moveRange(12_000_000,18_000_000,3_000_000,60_000_000)).toEqual({startUs:15_000_000,endUs:21_000_000}));
  it("resizes a block", () => expect(resizeRange(12_000_000,18_000_000,"end",20_000_000,60_000_000)).toEqual({startUs:12_000_000,endUs:20_000_000}));
  it("snaps using a pixel threshold", () => expect(snapTimeUs(9_950_000,[10_000_000],100)).toBe(10_000_000));
  it("edits camera zoom and center safely", () => expect(editCamera({centerX:.5,centerY:.5,confidence:1,easing:"linear",endUs:18_000_000,id:"c",mode:"zoom",reason:null,startUs:12_000_000,zoom:1.28},{centerX:.65,centerY:.35,zoom:1.4})).toMatchObject({centerX:.65,centerY:.35,zoom:1.4}));
});
