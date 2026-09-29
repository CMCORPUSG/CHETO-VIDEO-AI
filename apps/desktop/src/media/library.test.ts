import { describe, expect, it } from "vitest";
import { addImportedMedia, removeImportedMedia, type ImportedMedia } from "./library";

const item = (path: string): ImportedMedia => ({ path, fileName: path, durationUs: 10_000_000, width: 1920, height: 1080, fps: 30, sizeBytes: 100, lastModifiedMs: null });

describe("media selection", () => {
  it("keeps distinct imported files and refreshes a repeated path", () => {
    const first = item("C:/videos/one.mp4");
    const second = item("C:/videos/two.webm");
    expect(addImportedMedia(addImportedMedia([first], second), { ...first, durationUs: 20_000_000 }).map(value => [value.path, value.durationUs])).toEqual([[second.path, 10_000_000], [first.path, 20_000_000]]);
  });
  it("removes only the imported entry and protects the active source", () => {
    const active = item("C:/videos/active.mp4");
    const extra = item("C:/videos/extra.mp4");
    expect(removeImportedMedia([active, extra], extra.path, active.path)).toEqual([active]);
    expect(removeImportedMedia([active, extra], active.path, active.path)).toEqual([active, extra]);
  });
});
