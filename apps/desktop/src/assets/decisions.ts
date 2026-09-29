import type { AssetDecision } from "../project/contracts";
import type { LibraryAsset } from "./library";

export function createAssetDecision(asset: LibraryAsset, startUs: number, videoDurationUs: number): AssetDecision {
  const start = Math.max(0, Math.min(Math.round(startUs), Math.max(0, videoDurationUs - 1)));
  const natural = Math.max(100_000, asset.durationUs || 5_000_000);
  const end = asset.kind === "music" ? videoDurationUs : Math.min(videoDurationUs, start + natural);
  const id = globalThis.crypto?.randomUUID?.() ?? `placement-${Date.now()}-${Math.random()}`;
  return {
    id,
    automation: { key: `manual:${id}`, detector: "user", detectorVersion: "13d-policy-v1", origin: "manual", confidence: null },
    assetId: asset.id,
    assetPath: asset.path,
    sourceDurationUs: asset.durationUs,
    kind: asset.kind,
    startUs: start,
    endUs: Math.max(start + 1, end),
    gainDb: asset.defaultGainDb ?? (asset.kind === "music" ? -24 : -6),
    fadeInUs: asset.kind === "music" ? 500_000 : 0,
    fadeOutUs: asset.kind === "music" ? 800_000 : 0,
    loop: asset.kind !== "sfx" && asset.loopable,
    ducking: false,
    duckDb: -12,
    attackMs: 80,
    releaseMs: 400,
    positionX: 0.5,
    positionY: 0.5,
    scale: 0.3,
    opacity: 1,
    muted: false,
  };
}

export function moveAssetDecision(decision: AssetDecision, startUs: number, durationUs: number): AssetDecision {
  const length = decision.endUs - decision.startUs;
  const start = Math.max(0, Math.min(Math.round(startUs), Math.max(0, durationUs - length)));
  return { ...decision, startUs: start, endUs: start + length };
}
