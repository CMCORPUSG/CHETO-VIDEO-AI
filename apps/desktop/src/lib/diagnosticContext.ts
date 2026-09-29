import { invoke, isTauri } from "@tauri-apps/api/core";

export interface DiagnosticContext {
  cpu: string;
  gpu: string[];
  ramTotalBytes: number;
  ffmpegVersion: string;
}

export async function getDiagnosticContext(): Promise<DiagnosticContext | null> {
  return isTauri() ? invoke<DiagnosticContext>("get_diagnostic_context") : null;
}
