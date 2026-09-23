import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ExecutionProfile, HardwareProfile, LanguageMode, ModelStatus, QualityMode, TranscriptStatus, TranscriptionEvent } from "./models";

function requireNative() { if (!isTauri()) throw new Error("El motor local de transcripción requiere la aplicación nativa."); }
export function transcriptionErrorMessage(error: unknown): string { if (error instanceof Error) return error.message; if (typeof error === "string") return error; if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message; return "No se pudo completar la transcripción local."; }
export async function detectHardwareProfile(): Promise<HardwareProfile> { requireNative(); return invoke("detect_hardware_profile"); }
export async function selectTranscriptionProfile(hardware: HardwareProfile, mode: QualityMode, forceCpu = false): Promise<ExecutionProfile> { requireNative(); return invoke("select_transcription_profile", { forceCpu, hardware, mode }); }
export async function getModelStatus(model: string): Promise<ModelStatus> { requireNative(); return invoke("get_transcription_model_status", { model }); }
export async function downloadModel(model: string): Promise<ModelStatus> { requireNative(); return invoke("download_transcription_model", { model }); }
export async function getTranscriptStatus(projectId: string): Promise<TranscriptStatus> { requireNative(); return invoke("get_transcript_status", { projectId }); }
export async function startTranscription(projectId: string, mode: QualityMode, language: LanguageMode, forceCpu = false): Promise<TranscriptStatus> { requireNative(); return invoke("start_transcription", { request: { forceCpu, language, mode, projectId } }); }
export async function cancelTranscription(projectId: string): Promise<TranscriptStatus> { requireNative(); return invoke("cancel_transcription", { projectId }); }
export function onTranscriptionEvent(handler: (event: TranscriptionEvent) => void): Promise<UnlistenFn> { return listen<TranscriptionEvent>("transcription://event", ({ payload }) => handler(payload)); }
