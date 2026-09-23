import type { VideoMetadata } from "../media/models";

export type ProjectStatus = "ready" | "source-changed" | "source-missing" | "legacy";

export interface ProjectSource {
  fileName: string;
  lastModifiedMs: number | null;
  path: string | null;
  sizeBytes: number;
}

export interface LocalProject {
  createdAt: string;
  id: string;
  manifest: {
    edlSchemaVersion: 1;
    projectSchemaVersion: 1;
    sourceId: string;
  } | null;
  metadata: VideoMetadata | null;
  name: string;
  schemaVersion: 2;
  source: ProjectSource;
  status: ProjectStatus;
}

export type ProjectDraft = Pick<LocalProject, "metadata" | "name" | "source">;
