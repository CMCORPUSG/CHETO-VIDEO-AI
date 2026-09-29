import { describe, expect, it, vi } from "vitest";
import { previewAudioRange, renderAudioPreview } from "./audio-preview";

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue("C:/preview.m4a"));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true, convertFileSrc: (path: string) => path }));

describe("audio preview range", () => {
  it("uses twelve seconds around the current playhead", () => {
    expect(previewAudioRange(7_200_000_000, 3_000_000_000, null, null)).toEqual({ startUs: 2_995_000_000, endUs: 3_007_000_000 });
  });

  it("limits a long selection to twenty seconds", () => {
    expect(previewAudioRange(120_000_000, 0, 30_000_000, 90_000_000)).toEqual({ startUs: 30_000_000, endUs: 50_000_000 });
  });

  it("stays within the source duration", () => {
    expect(previewAudioRange(5_000_000, 4_500_000, null, null)).toEqual({ startUs: 0, endUs: 5_000_000 });
  });

  it("sends current audio decisions for processed preview", async () => {
    const audio = [{ id: "gain", startUs: 0, endUs: 2_000_000, operation: "master_gain", parameters: { gainDb: 3 } }];
    await renderAudioPreview("project", 0, 2_000_000, true, audio, []);
    expect(invoke).toHaveBeenCalledWith("render_audio_preview", { projectId: "project", startUs: 0, endUs: 2_000_000, processed: true, audioDecisions: audio, assetDecisions: [] });
  });
});
