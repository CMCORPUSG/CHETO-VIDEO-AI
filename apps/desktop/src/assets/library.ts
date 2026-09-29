import type { EdlManifest } from "../project/contracts";
import { stableDecisionKey } from "../editor/automation-policy";

export type AssetKind = "sfx" | "music" | "overlay";
export interface AssetProbe {
  path: string;
  name: string;
  kind: "audio" | "overlay";
  format: string;
  durationUs: number;
  sampleRate: number | null;
  channels: number | null;
  sizeBytes: number;
  modifiedMs: number | null;
  fingerprint: string;
}

export interface LibraryAsset extends Omit<AssetProbe, "kind"> {
  id: string;
  kind: AssetKind;
  category: string;
  tags: string[];
  favorite: boolean;
  source: string;
  author: string;
  license: string;
  sourceUrl: string;
  commercialUse: boolean | null;
  attributionRequired: boolean | null;
  notes: string;
  loopable: boolean;
  createdAt: string;
  origin?: "builtin";
  repository?: string;
  pack?: string;
  cue?: string;
  defaultGainDb?: number;
}

const KEY = "cheto.assetLibrary.v1";
const WORDS = /[^\p{L}\p{N}]+/u;
const BLOCKED = new Set(["wav", "mp3", "m4a", "aac", "ogg", "flac", "gif", "sfx", "music", "assets"]);

export function deriveTags(path: string) {
  const parts = path.replaceAll("\\", "/").split("/").slice(-3).flatMap(part => part.toLowerCase().split(WORDS));
  return [...new Set(parts.filter(part => part.length > 2 && !BLOCKED.has(part)))].slice(0, 12);
}

export function assetFromProbe(probe: AssetProbe, requestedKind?: AssetKind): LibraryAsset {
  const kind = probe.kind === "overlay" ? "overlay" : requestedKind === "music" ? "music" : "sfx";
  return {
    ...probe,
    id: globalThis.crypto?.randomUUID?.() ?? `asset-${Date.now()}-${Math.random()}`,
    kind,
    category: kind === "overlay" ? "Reacción" : kind === "music" ? "Ambiente" : "General",
    tags: deriveTags(probe.path),
    favorite: false,
    source: "No registrado",
    author: "",
    license: "",
    sourceUrl: "",
    commercialUse: null,
    attributionRequired: null,
    notes: "",
    loopable: kind !== "sfx",
    createdAt: new Date().toISOString(),
  };
}

export function addAsset(items: LibraryAsset[], next: LibraryAsset) {
  if (items.some(item => item.fingerprint === next.fingerprint && item.kind === next.kind)) return items;
  return [...items, next];
}

export function searchAssets(items: LibraryAsset[], query: string, kind: AssetKind | "all", favoritesOnly = false) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => (kind === "all" || item.kind === kind) && (!favoritesOnly || item.favorite)
    && words.every(word => [item.name, item.category, ...item.tags].some(value => value.toLowerCase().includes(word))));
}

export function loadAssets(): LibraryAsset[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is LibraryAsset => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Record<string, unknown>;
      return typeof candidate.id === "string" && typeof candidate.path === "string"
        && ["sfx", "music", "overlay"].includes(String(candidate.kind))
        && typeof candidate.durationUs === "number";
    }) : [];
  } catch { return []; }
}

export function saveAssets(items: LibraryAsset[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export interface AssetSuggestion {
  id: string;
  assetId: string;
  startUs: number;
  reason: string;
  confidence: number;
}

export interface AssetSuggestionProvider {
  suggest(assets: LibraryAsset[], edl: EdlManifest, markers: number[], profile: "tutorial" | "gaming" | "presentation"): AssetSuggestion[];
}

export const localSuggestionProvider: AssetSuggestionProvider = {
  suggest(assets, edl, markers, profile) {
    const result: AssetSuggestion[] = [];
    // A marker or camera move alone is not evidence for a transition sound.
    // No SFX suggestion is the conservative default until an editorial event
    // (for example an explicit section change) is represented in the EDL.
    void markers;
    const music = assets.filter(asset => asset.kind === "music");
    const keywords = profile === "gaming" ? ["gaming", "energetic", "chill"] : profile === "presentation" ? ["corporate", "relaxed", "presentacion"] : ["tutorial", "calm", "technology"];
    const recommended = music.find(asset => asset.tags.some(tag => keywords.includes(tag))) ?? music[0];
    if (recommended) result.push({ id: stableDecisionKey({ sourceId: edl.sourceId, detector: "music-suggestion", kind: recommended.id, startUs: 0, endUs: edl.sourceDurationUs ?? 0, config: profile }), assetId: recommended.id, startUs: 0, reason: `Perfil ${profile}: música de fondo candidata`, confidence: 0.65 });
    return result;
  },
};

export interface TextOnlySuggestionRequest {
  profile: string;
  candidateAssets: { id: string; tags: string[] }[];
}
export function textOnlySuggestionRequest(profile: string, assets: LibraryAsset[]): TextOnlySuggestionRequest {
  return { profile, candidateAssets: assets.map(asset => ({ id: asset.id, tags: asset.tags })) };
}
export function acceptSuggestedAssetId(candidateIds: string[], responseId: string) {
  return candidateIds.includes(responseId) ? responseId : null;
}
