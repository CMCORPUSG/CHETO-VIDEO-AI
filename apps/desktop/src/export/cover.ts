import { invoke } from "@tauri-apps/api/core";

export interface ProjectCover {
  path: string;
  fit: "cover" | "contain";
  scale: number;
  offsetX: number;
  offsetY: number;
}

export const getProjectCover = (projectId: string) => invoke<ProjectCover | null>("get_project_cover", { projectId });
export const saveProjectCover = (projectId: string, cover: ProjectCover) => invoke<ProjectCover>("save_project_cover", { projectId, cover });
export const removeProjectCover = (projectId: string) => invoke<void>("remove_project_cover", { projectId });
export const exportProjectCover = (projectId: string, outputPath: string, width: number, height: number) =>
  invoke<string>("export_project_cover", { config: { projectId, outputPath, width, height } });

export function coverPlacement(sourceRatio: number, outputRatio: number, cover: ProjectCover) {
  const relative = sourceRatio / outputRatio;
  const baseWidth = cover.fit === "cover" ? Math.max(1, relative) : Math.min(1, relative);
  const baseHeight = baseWidth / relative;
  const width = baseWidth * cover.scale;
  const height = baseHeight * cover.scale;
  return {
    width: `${width * 100}%`,
    height: `${height * 100}%`,
    left: `${(1 - width) * (1 + cover.offsetX) * 50}%`,
    top: `${(1 - height) * (1 + cover.offsetY) * 50}%`,
  };
}
