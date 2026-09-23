import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PlaybackPreference, PlaybackSource, ProxyDiagnostic, ProxyProgress, ProxyStatus } from "./models";

function requireTauri() {
  if (!isTauri()) throw new Error("La reproducción local y los proxies requieren la aplicación nativa.");
}

export function playbackErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "No se pudo completar la operación multimedia.";
}

export async function getProxyStatus(projectId: string): Promise<ProxyStatus> {
  requireTauri();
  return invoke<ProxyStatus>("get_proxy_status", { projectId });
}

export async function createProxy(projectId: string): Promise<ProxyStatus> {
  requireTauri();
  return invoke<ProxyStatus>("create_proxy", { projectId });
}

export async function cancelProxy(projectId: string): Promise<ProxyStatus> {
  requireTauri();
  return invoke<ProxyStatus>("cancel_proxy", { projectId });
}

export async function resolvePlaybackSource(projectId: string, preference: PlaybackPreference): Promise<PlaybackSource> {
  requireTauri();
  return invoke<PlaybackSource>("get_playback_source", { preference, projectId });
}

export function playbackAssetUrl(path: string): string {
  return convertFileSrc(path);
}

export function onProxyProgress(handler: (progress: ProxyProgress) => void): Promise<UnlistenFn> {
  return listen<ProxyProgress>("proxy://progress", ({ payload }) => handler(payload));
}

export function onProxyDiagnostic(handler: (diagnostic: ProxyDiagnostic) => void): Promise<UnlistenFn> {
  return listen<ProxyDiagnostic>("proxy://diagnostic", ({ payload }) => handler(payload));
}
