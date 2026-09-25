import type { EdlManifest } from "../project/contracts";

export type SmartCutProfile = "conservative" | "normal" | "aggressive";
export type SmartCutType = "silence" | "filler" | "repetition" | "false_start";
export type SmartCutSuggestionStatus = "pending" | "accepted" | "rejected";
export type SmartCutAnalysisStatus = "completed" | "stale";

export interface SmartCutSuggestion {
  confidence: number;
  durationUs: number;
  endUs: number;
  id: string;
  reason: string;
  startUs: number;
  status: SmartCutSuggestionStatus;
  suggestionType: SmartCutType;
}

export interface SmartCutStatistics {
  accepted: number;
  falseStart: number;
  filler: number;
  pending: number;
  rejected: number;
  repetition: number;
  silence: number;
  total: number;
}

export interface SmartCutDocument {
  createdAt: string;
  profile: SmartCutProfile;
  projectId: string;
  schemaVersion: 1;
  source: { durationUs: number; fileSizeBytes: number; modifiedAt: string | null };
  sourceId: string;
  statistics: SmartCutStatistics;
  status: SmartCutAnalysisStatus;
  suggestions: SmartCutSuggestion[];
  updatedAt: string;
}

export interface SmartCutProgress {
  completedSteps: number;
  projectId: string;
  stage: "preparing" | "analyzing_silences" | "detecting_repetitions" | "consolidating_suggestions" | "saving" | "completed" | "error";
  totalSteps: number;
}

export interface ApplySmartCutResult {
  appliedCount: number;
  document: SmartCutDocument;
  edl: EdlManifest;
}

export function smartCutProgressPercent(progress: SmartCutProgress): number {
  return progress.totalSteps <= 0 ? 0 : Math.min(100, Math.max(0, progress.completedSteps / progress.totalSteps * 100));
}

export function acceptedSuggestions(document: SmartCutDocument | null): SmartCutSuggestion[] {
  return document?.suggestions.filter((item) => item.status === "accepted") ?? [];
}

export function smartCutSeekTarget(suggestion: SmartCutSuggestion): number {
  return suggestion.startUs;
}
