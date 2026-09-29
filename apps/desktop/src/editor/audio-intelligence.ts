import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AudioDecision } from "../project/contracts";

export interface AudioEvent {
  id: string;
  eventType: "voice";
  originalLabel: string;
  startUs: number;
  endUs: number;
  confidence: number;
}

export interface AudioAnalysis {
  detector: string;
  events: AudioEvent[];
  audioDurationUs: number;
  analysisElapsedMs: number;
  realtimeFactor: number;
  cacheHit: boolean;
}

export interface AudioAnalysisProgress {
  projectId: string;
  analyzedUs: number;
  durationUs: number;
}

export const AUDIO_AI_SETTING = "cheto.audioIntelligence.enabled";

export function audioIntelligenceEnabled() {
  return localStorage.getItem(AUDIO_AI_SETTING) !== "false";
}

export function canAnalyzeAudio() {
  return isTauri();
}

export function analyzeAudioEvents(projectId: string) {
  return invoke<AudioAnalysis>("analyze_audio_events", { projectId });
}

export function cancelAudioEvents(projectId: string) {
  return invoke<void>("cancel_audio_events", { projectId });
}

export function audioEventPreviewRange(event: AudioEvent, durationUs: number) {
  const startUs = Math.max(0, event.startUs - 2_000_000);
  return {
    startUs,
    endUs: Math.min(durationUs, Math.max(event.endUs + 2_000_000, startUs + 1_000_000), startUs + 20_000_000),
  };
}

export type EventAction = "keep" | "clean" | "attenuate6" | "attenuate12" | "attenuate18" | "mute";

export interface AudioCleanupEngine {
  decisionForRange(event: AudioEvent): Pick<AudioDecision, "operation" | "parameters">;
}

export const ffmpegCleanupEngine: AudioCleanupEngine = {
  decisionForRange(event) {
    return { operation: "noise_reduction_range", parameters: { amount: 0.45, audioAiEventId: event.id } };
  },
};

// A separation engine may be added after a local model and its license are validated.
export interface SpeechSeparationEngine {
  separate(projectId: string, startUs: number, endUs: number): Promise<string>;
}

export function applyAudioEventActions(
  audio: AudioDecision[],
  events: AudioEvent[],
  actions: Record<string, EventAction>,
): AudioDecision[] {
  const chosen = events.filter((event) => actions[event.id]);
  if (!chosen.length) return audio;
  const selected = new Set(chosen.map((event) => event.id));
  const next = audio.filter((item) => typeof item.parameters.audioAiEventId !== "string" || !selected.has(item.parameters.audioAiEventId));
  for (const event of chosen) {
    const action = actions[event.id];
    if (action === "keep") continue;
    const cleanup = action === "clean" ? ffmpegCleanupEngine.decisionForRange(event) : null;
    const operation = cleanup?.operation ?? (action === "mute" ? "mute_range" : "gain_range");
    const parameters: Record<string, unknown> = cleanup?.parameters ?? { audioAiEventId: event.id };
    if (action.startsWith("attenuate")) parameters.gainDb = -Number(action.slice("attenuate".length));
    next.push({
      id: globalThis.crypto?.randomUUID?.() ?? `audio-ai-${Date.now()}-${Math.random()}`,
      startUs: event.startUs,
      endUs: event.endUs,
      operation,
      parameters,
    });
  }
  return next;
}
