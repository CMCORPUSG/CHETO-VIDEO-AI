import type { EdlManifest } from "../project/contracts";

export type CameraProfile = "conservative" | "normal" | "dynamic";
export type CameraSuggestionType = "zoom" | "focus" | "reset";
export type CameraSuggestionStatus = "pending" | "accepted" | "rejected";
export type CameraAnalysisStatus = "completed" | "cancelled" | "stale";

export interface CameraSuggestion {
  centerX: number;
  centerY: number;
  confidence: number;
  durationUs: number;
  endUs: number;
  id: string;
  reason: string;
  startUs: number;
  status: CameraSuggestionStatus;
  suggestionType: CameraSuggestionType;
  transitionUs: number;
  zoom: number;
}

export interface CameraStatistics {
  accepted: number;
  focus: number;
  pending: number;
  rejected: number;
  reset: number;
  total: number;
  zoom: number;
}

export interface SmartCameraDocument {
  createdAt: string;
  profile: CameraProfile;
  projectId: string;
  schemaVersion: 1;
  source: { durationUs: number; fileSizeBytes: number; modifiedAt: string | null };
  sourceId: string;
  statistics: CameraStatistics;
  status: CameraAnalysisStatus;
  suggestions: CameraSuggestion[];
  updatedAt: string;
}

export interface SmartCameraProgress {
  durationUs: number;
  processedUs: number;
  progress: number | null;
  projectId: string;
  stage: "extracting_samples" | "analyzing_visual_changes" | "consolidating_movements" | "saving" | "completed" | "cancelled" | "error";
}

export interface CameraPreview {
  centerX: number;
  centerY: number;
  endUs: number;
  id: string;
  startUs: number;
  transitionUs: number;
  zoom: number;
}

export interface ApplySmartCameraResult {
  appliedCount: number;
  document: SmartCameraDocument;
  edl: EdlManifest;
}

export function acceptedCameraSuggestions(document: SmartCameraDocument | null): CameraSuggestion[] {
  return document?.suggestions.filter((item) => item.status === "accepted") ?? [];
}

export function cameraProgressPercent(progress: SmartCameraProgress): number {
  if (progress.progress !== null) return Math.min(100, Math.max(0, progress.progress));
  return progress.durationUs <= 0 ? 0 : Math.min(100, Math.max(0, progress.processedUs / progress.durationUs * 100));
}

export function toCameraPreview(item: CameraSuggestion): CameraPreview {
  return { centerX: item.centerX, centerY: item.centerY, endUs: item.endUs, id: item.id, startUs: item.startUs, transitionUs: item.transitionUs, zoom: item.zoom };
}

export function activeCameraAt(preview: CameraPreview | null, timeUs: number): CameraPreview | null {
  return preview && timeUs >= preview.startUs && timeUs < preview.endUs ? preview : null;
}
