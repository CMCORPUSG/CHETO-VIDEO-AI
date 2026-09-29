export function measuredRenderProgress(processedUs: number, durationUs: number, elapsedSeconds: number): { speed: number; remainingSeconds: number } | null {
  if (elapsedSeconds < 2 || processedUs <= 0 || durationUs <= 0) return null;
  const processed = Math.min(processedUs, durationUs);
  const speed = processed / 1_000_000 / elapsedSeconds;
  if (!Number.isFinite(speed) || speed <= 0) return null;
  return { speed, remainingSeconds: Math.max(0, Math.ceil((durationUs - processed) / 1_000_000 / speed)) };
}
