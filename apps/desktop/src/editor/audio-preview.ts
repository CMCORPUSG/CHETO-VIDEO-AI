import { invoke, isTauri } from "@tauri-apps/api/core";
import { playbackAssetUrl } from "../playback/service";
import type { AssetDecision, AudioDecision } from "../project/contracts";

export function canPreviewAudio() {
  return isTauri();
}

export async function renderAudioPreview(projectId: string, startUs: number, endUs: number, processed: boolean, audioDecisions: AudioDecision[], assetDecisions: AssetDecision[]) {
  const path = await invoke<string>("render_audio_preview", { projectId, startUs, endUs, processed, audioDecisions, assetDecisions });
  return playbackAssetUrl(path);
}

export function previewAudioRange(durationUs: number, playheadUs: number, selectionInUs: number | null, selectionOutUs: number | null) {
  const selected = selectionInUs === null || selectionOutUs === null ? null : {
    start: Math.max(0, Math.min(selectionInUs, selectionOutUs)),
    end: Math.min(durationUs, Math.max(selectionInUs, selectionOutUs)),
  };
  const startUs = selected && selected.end > selected.start ? selected.start : Math.max(0, Math.min(playheadUs - 5_000_000, durationUs - 12_000_000));
  const endUs = Math.min(durationUs, startUs + (selected ? 20_000_000 : 12_000_000), selected?.end ?? durationUs);
  return { startUs, endUs };
}
