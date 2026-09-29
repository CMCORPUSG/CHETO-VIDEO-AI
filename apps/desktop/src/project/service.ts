import { invoke, isTauri } from "@tauri-apps/api/core";
import type { LocalProject } from "../types/project";
import { createManifestInitializationRequest } from "./conversion";
import type { EdlManifest, InitializeProjectRequest, ProjectBundle, ProjectManifest, ProjectStorageInfo } from "./contracts";
import { hydrateTemplateInstance } from "../templates/engine";

export function projectStorageErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "No se pudo acceder al almacenamiento local del proyecto.";
}

function requireTauri() {
  if (!isTauri()) throw new Error("El almacenamiento de manifests requiere la aplicación nativa.");
}

export function isNativeProjectStorage(): boolean {
  return isTauri();
}

export async function initializeProjectStorage(): Promise<ProjectStorageInfo> {
  requireTauri();
  return invoke<ProjectStorageInfo>("initialize_project_storage");
}

export async function projectManifestExists(projectId: string): Promise<boolean> {
  requireTauri();
  return invoke<boolean>("project_manifest_exists", { projectId });
}

export async function initializeProjectManifest(request: InitializeProjectRequest): Promise<ProjectBundle> {
  requireTauri();
  return invoke<ProjectBundle>("initialize_project_manifest", { request });
}

export async function loadProjectBundle(projectId: string): Promise<ProjectBundle> {
  requireTauri();
  const bundle = await invoke<ProjectBundle>("load_project_bundle", { projectId });
  return { ...bundle, edl: { ...bundle.edl, tracks: { ...bundle.edl.tracks, titles: bundle.edl.tracks.titles?.map(hydrateTemplateInstance) ?? [] } } };
}

export async function ensureProjectBundle(project: LocalProject): Promise<{ bundle: ProjectBundle; created: boolean }> {
  const exists = await projectManifestExists(project.id);
  if (exists) return { bundle: await loadProjectBundle(project.id), created: false };
  return { bundle: await initializeProjectManifest(createManifestInitializationRequest(project)), created: true };
}

export async function createProjectBundle(project: LocalProject): Promise<ProjectBundle> {
  const request = createManifestInitializationRequest(project);
  return initializeProjectManifest({ ...request, edl: { ...request.edl, sourceOnTimeline: false, audioOnTimeline: false } });
}

export async function saveProjectManifest(manifest: ProjectManifest): Promise<ProjectManifest> {
  requireTauri();
  return invoke<ProjectManifest>("save_project_manifest", { manifest });
}

export async function saveProjectEdl(edl: EdlManifest): Promise<EdlManifest> {
  requireTauri();
  return invoke<EdlManifest>("save_project_edl", { edl });
}

export interface ReanalysisPlan {
  projectId: string;
  edlRevision: string;
  automaticCameraCount: number;
  preservedCameraCount: number;
  legacyUnclassifiedCameraCount: number;
  smartCutDocumentPresent: boolean;
  smartCameraDocumentPresent: boolean;
}

export async function previewReanalysisCleanup(projectId: string): Promise<ReanalysisPlan> {
  requireTauri();
  return invoke<ReanalysisPlan>("preview_reanalysis_cleanup", { projectId });
}

export async function applyReanalysisCleanup(projectId: string, expectedRevision: string): Promise<ReanalysisPlan> {
  requireTauri();
  return invoke<ReanalysisPlan>("apply_reanalysis_cleanup", { projectId, expectedRevision });
}

export async function updateProjectSource(bundle: ProjectBundle): Promise<ProjectBundle> {
  requireTauri();
  return invoke<ProjectBundle>("update_project_source", { bundle });
}
