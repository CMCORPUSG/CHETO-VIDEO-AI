import type { VideoMetadata } from "./models";

export interface ImportedMedia {
  path: string;
  fileName: string;
  durationUs: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  sizeBytes: number;
  lastModifiedMs: number | null;
}

export function mediaFromProbe(metadata: VideoMetadata): ImportedMedia {
  return {
    path: metadata.path,
    fileName: metadata.fileName,
    durationUs: Math.max(0, Math.round((metadata.durationSeconds ?? 0) * 1_000_000)),
    width: metadata.video.displayWidth ?? metadata.video.width,
    height: metadata.video.displayHeight ?? metadata.video.height,
    fps: metadata.video.fpsDecimal,
    sizeBytes: metadata.sizeBytes,
    lastModifiedMs: metadata.lastModifiedMs,
  };
}

export function addImportedMedia(items: ImportedMedia[], next: ImportedMedia): ImportedMedia[] {
  return [...items.filter(item => item.path !== next.path), next];
}

export function removeImportedMedia(items: ImportedMedia[], path: string, activeSourcePath: string): ImportedMedia[] {
  return path === activeSourcePath ? items : items.filter(item => item.path !== path);
}

export function loadImportedMedia(projectId: string): ImportedMedia[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`cheto.media.${projectId}`) ?? "[]");
    return Array.isArray(value) ? (value as unknown[]).filter((item): item is ImportedMedia => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Record<string, unknown>;
      return typeof candidate.path === "string" && typeof candidate.fileName === "string" && typeof candidate.durationUs === "number" && Number.isFinite(candidate.durationUs);
    }) : [];
  } catch { return []; }
}

export function saveImportedMedia(projectId: string, items: ImportedMedia[]): void {
  localStorage.setItem(`cheto.media.${projectId}`, JSON.stringify(items));
}
