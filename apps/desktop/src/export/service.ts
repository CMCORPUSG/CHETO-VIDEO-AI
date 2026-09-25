import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ExportConfig, ExportProgress, ExportResult } from "./models";
export const startExport = (config: ExportConfig) =>
  invoke<ExportResult>("start_export", { config });
export const cancelExport = (projectId: string) =>
  invoke<boolean>("cancel_export", { projectId });
export const openExportFile = (path: string) =>
  invoke<void>("open_export_file", { path });
export const revealExportFile = (path: string) =>
  invoke<void>("reveal_export_file", { path });
export const onExportProgress = (handler: (progress: ExportProgress) => void) =>
  listen<ExportProgress>("export-progress", (event) => handler(event.payload));
export function exportErrorMessage(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  if (typeof error === "string") return error;
  return "No se pudo exportar el video.";
}
