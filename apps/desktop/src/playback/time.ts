export const TIMELINE_US_PER_SECOND = 1_000_000;
export const SEEK_STEP_US = 5 * TIMELINE_US_PER_SECOND;

export function secondsToUs(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(seconds * TIMELINE_US_PER_SECOND));
}

export function usToSeconds(microseconds: number): number {
  if (!Number.isFinite(microseconds) || microseconds <= 0) return 0;
  return microseconds / TIMELINE_US_PER_SECOND;
}

export function clampTimelineUs(value: number, durationUs: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(Math.max(0, value), Math.max(0, durationUs)));
}

export function formatPlaybackTime(microseconds: number): string {
  const totalSeconds = Math.floor(usToSeconds(microseconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function timelineProgress(playheadUs: number, durationUs: number): number {
  if (durationUs <= 0) return 0;
  return Math.min(100, Math.max(0, (clampTimelineUs(playheadUs, durationUs) / durationUs) * 100));
}
