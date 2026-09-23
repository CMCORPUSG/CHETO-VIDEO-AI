import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ApplySmartCutResult, SmartCutDocument, SmartCutProfile, SmartCutProgress, SmartCutSuggestionStatus } from "./models";

function requireNative() {
  if (!isTauri()) throw new Error("Smart Cut requiere la aplicación nativa.");
}

export function smartCutErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "No se pudo completar el análisis Smart Cut.";
}

export async function getSmartCut(projectId: string): Promise<SmartCutDocument | null> {
  requireNative();
  return invoke("get_smart_cut", { projectId });
}

export async function analyzeSmartCut(projectId: string, profile: SmartCutProfile): Promise<SmartCutDocument> {
  requireNative();
  return invoke("analyze_smart_cut", { profile, projectId });
}

export async function reviewSmartCutSuggestion(projectId: string, suggestionId: string, status: SmartCutSuggestionStatus): Promise<SmartCutDocument> {
  requireNative();
  return invoke("review_smart_cut_suggestion", { request: { projectId, status, suggestionId } });
}

export async function applySmartCutToEdl(projectId: string): Promise<ApplySmartCutResult> {
  requireNative();
  return invoke("apply_smart_cut_to_edl", { projectId });
}

export function onSmartCutProgress(handler: (progress: SmartCutProgress) => void): Promise<UnlistenFn> {
  return listen<SmartCutProgress>("smart-cut://progress", ({ payload }) => handler(payload));
}

