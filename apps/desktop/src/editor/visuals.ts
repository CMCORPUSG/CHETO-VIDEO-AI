import { invoke, isTauri } from "@tauri-apps/api/core";
import { playbackAssetUrl } from "../playback/service";

export interface WaveformView {
  startUs: number;
  endUs: number;
  peaks: number[];
  rms: number[];
}

export function canLoadTimelineVisuals() {
  return isTauri();
}

export async function importThumbnail(path: string, timeUs: number): Promise<string> {
  const thumbnailPath = await invoke<string>("get_import_thumbnail", { path, timeUs });
  return playbackAssetUrl(thumbnailPath);
}

export async function timelineThumbnail(projectId: string, timeUs: number): Promise<string> {
  const path = await invoke<string>("get_timeline_thumbnail", { projectId, timeUs });
  return playbackAssetUrl(path);
}

export function timelineWaveform(projectId: string, streamIndex: number, startUs: number, endUs: number, bins: number) {
  return invoke<WaveformView>("get_timeline_waveform", { projectId, streamIndex, startUs, endUs, bins });
}

export function visibleThumbnailTimes(startUs: number, endUs: number, pixelsPerSecond: number): number[] {
  const intervalUs = Math.max(100_000, Math.round(96_000_000 / pixelsPerSecond));
  const first = Math.floor(startUs / intervalUs) * intervalUs;
  const result: number[] = [];
  for (let time = first; time <= endUs && result.length < 32; time += intervalUs) {
    result.push(Math.max(0, time));
  }
  return result;
}

export function waveformPath(peaks: number[], height = 34): string {
  const middle = height / 2;
  return peaks.map((peak, index) => {
    const extent = Math.max(0.5, Math.min(1, peak) * (middle - 2));
    return `M${index + 0.5} ${middle - extent}V${middle + extent}`;
  }).join("");
}
