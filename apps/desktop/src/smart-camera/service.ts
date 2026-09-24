import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ApplySmartCameraResult, CameraProfile, CameraSuggestionStatus, SmartCameraDocument, SmartCameraProgress } from "./models";

function requireNative() {
  if (!isTauri()) throw new Error("Smart Camera requiere la aplicación nativa.");
}

export function smartCameraErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "No se pudo completar el análisis Smart Camera.";
}

export async function getSmartCamera(projectId: string): Promise<SmartCameraDocument | null> {
  requireNative();
  return invoke("get_smart_camera", { projectId });
}

export async function analyzeSmartCamera(projectId: string, profile: CameraProfile): Promise<SmartCameraDocument> {
  requireNative();
  return invoke("analyze_smart_camera", { profile, projectId });
}

export async function cancelSmartCamera(projectId: string): Promise<boolean> {
  requireNative();
  return invoke("cancel_smart_camera", { projectId });
}

export async function reviewSmartCamera(projectId: string, suggestionId: string, status: CameraSuggestionStatus): Promise<SmartCameraDocument> {
  requireNative();
  return invoke("review_smart_camera", { request: { projectId, status, suggestionId } });
}

export async function applySmartCameraToEdl(projectId: string): Promise<ApplySmartCameraResult> {
  requireNative();
  return invoke("apply_smart_camera_to_edl", { projectId });
}

export function onSmartCameraProgress(handler: (progress: SmartCameraProgress) => void): Promise<UnlistenFn> {
  return listen<SmartCameraProgress>("smart-camera://progress", ({ payload }) => handler(payload));
}
