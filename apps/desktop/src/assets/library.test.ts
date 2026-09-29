import { describe, expect, it } from "vitest";
import { addAsset, assetFromProbe, deriveTags, localSuggestionProvider, searchAssets } from "./library";
import { createAssetDecision, moveAssetDecision } from "./decisions";
import type { EdlManifest } from "../project/contracts";

const probe = { path: "C:\\SFX\\Transitions\\whoosh_soft.wav", name: "whoosh_soft.wav",
  kind: "audio" as const, format: "wav", durationUs: 800_000, sampleRate: 48_000,
  channels: 2, sizeBytes: 10_000, modifiedMs: 1, fingerprint: "same" };

describe("biblioteca multimedia", () => {
  it("deriva tags del nombre y carpetas, con licencia sin verificar", () => {
    expect(deriveTags(probe.path)).toEqual(expect.arrayContaining(["transitions", "whoosh", "soft"]));
    const asset = assetFromProbe(probe);
    expect(asset.source).toBe("No registrado");
    expect(asset.license).toBe("");
  });

  it("evita duplicados del mismo tipo y busca por nombre, tags y categoría", () => {
    const first = assetFromProbe(probe);
    const second = assetFromProbe(probe);
    expect(addAsset([first], second)).toHaveLength(1);
    expect(searchAssets([first], "whoosh", "sfx")).toHaveLength(1);
    expect(searchAssets([first], "transitions", "all")).toHaveLength(1);
    expect(searchAssets([first], "whoosh", "all", true)).toHaveLength(0);
  });

  it("crea y mueve una decisión de timeline sin perder duración", () => {
    const asset = assetFromProbe(probe);
    const decision = createAssetDecision(asset, 1_000_000, 10_000_000);
    expect(decision.endUs - decision.startUs).toBe(800_000);
    expect(moveAssetDecision(decision, 9_900_000, 10_000_000).endUs).toBe(10_000_000);
  });

  it("defaults to NONE for transition SFX even with markers and camera moves", () => {
    const asset = assetFromProbe(probe);
    const edl = { tracks: { camera: [{ startUs: 2_000_000, zoom: 1.2 }], cuts: [], assets: [] } } as unknown as EdlManifest;
    const suggestions = localSuggestionProvider.suggest([asset], edl, [5_000_000], "tutorial");
    expect(suggestions).toHaveLength(0);
    expect(edl.tracks.assets).toHaveLength(0);
  });
});
