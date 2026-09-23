import type { LocalProject } from "../types/project";

export const projectStorageKeys = {
  current: "cheto-video-ai.projects.v2",
  legacy: "cheto-video-ai.projects.v1",
} as const;

interface LegacyProject {
  createdAt?: string;
  fileName?: string;
  fileSize?: number;
  id?: string;
  name?: string;
  sourcePath?: string;
}

function isProjectV2(value: unknown): value is LocalProject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalProject>;
  return candidate.schemaVersion === 2 && typeof candidate.id === "string" && typeof candidate.name === "string" && Boolean(candidate.source);
}

function normalizeProject(project: LocalProject): LocalProject {
  return { ...project, manifest: project.manifest ?? null };
}

export function migrateLegacyProjects(raw: unknown): LocalProject[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): LocalProject[] => {
    if (!entry || typeof entry !== "object") return [];
    const legacy = entry as LegacyProject;
    if (!legacy.id || !legacy.name || !legacy.fileName) return [];
    const path = legacy.sourcePath && /[\\/]/.test(legacy.sourcePath) ? legacy.sourcePath : null;
    return [{
      schemaVersion: 2,
      id: legacy.id,
      name: legacy.name,
      createdAt: legacy.createdAt ?? new Date().toISOString(),
      source: {
        path,
        fileName: legacy.fileName,
        sizeBytes: typeof legacy.fileSize === "number" ? legacy.fileSize : 0,
        lastModifiedMs: null,
      },
      metadata: null,
      manifest: null,
      status: "legacy",
    }];
  });
}

export function loadProjects(): LocalProject[] {
  try {
    const current = localStorage.getItem(projectStorageKeys.current);
    if (current) {
      const parsed = JSON.parse(current) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isProjectV2).map(normalizeProject) : [];
    }
    const legacy = localStorage.getItem(projectStorageKeys.legacy);
    return legacy ? migrateLegacyProjects(JSON.parse(legacy) as unknown) : [];
  } catch {
    return [];
  }
}
