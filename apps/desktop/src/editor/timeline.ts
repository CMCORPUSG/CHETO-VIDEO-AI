import type { CameraDecision, CutDecision } from "../project/contracts";
import { clampTimeUs } from "./timecode";

export const MIN_TIMELINE_ZOOM = 0.25;
export const MAX_TIMELINE_ZOOM = 320;
export const SNAP_THRESHOLD_PX = 6;

const RULER_STEPS_US = [
  250_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 15_000_000,
  30_000_000, 60_000_000, 120_000_000, 300_000_000, 600_000_000, 1_200_000_000,
];

export function usToPixels(us: number, pixelsPerSecond: number): number {
  return (us / 1_000_000) * pixelsPerSecond;
}
export function pixelsToUs(pixels: number, pixelsPerSecond: number): number {
  return Math.round(
    (pixels / Math.max(MIN_TIMELINE_ZOOM, pixelsPerSecond)) * 1_000_000,
  );
}
export function timelineWidth(
  durationUs: number,
  pixelsPerSecond: number,
  viewportWidth: number,
): number {
  return Math.max(viewportWidth, usToPixels(durationUs, pixelsPerSecond));
}

export function rulerStepUs(
  pixelsPerSecond: number,
  minimumLabelWidth = 88,
): number {
  return (
    RULER_STEPS_US.find(
      (step) => usToPixels(step, pixelsPerSecond) >= minimumLabelWidth,
    ) ?? RULER_STEPS_US.at(-1)!
  );
}

export function snapTimeUs(
  valueUs: number,
  candidatesUs: number[],
  pixelsPerSecond: number,
  disabled = false,
): number {
  if (disabled) return Math.round(valueUs);
  const thresholdUs = pixelsToUs(SNAP_THRESHOLD_PX, pixelsPerSecond);
  let best = Math.round(valueUs);
  let bestDistance = thresholdUs + 1;
  for (const candidate of candidatesUs) {
    const distance = Math.abs(candidate - valueUs);
    if (distance <= thresholdUs && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function moveRange(
  startUs: number,
  endUs: number,
  deltaUs: number,
  durationUs: number,
) {
  const length = Math.max(1, endUs - startUs);
  const start = clampTimeUs(
    startUs + deltaUs,
    Math.max(0, durationUs - length),
  );
  return { startUs: start, endUs: start + length };
}

export function resizeRange(
  startUs: number,
  endUs: number,
  edge: "start" | "end",
  targetUs: number,
  durationUs: number,
) {
  return edge === "start"
    ? { startUs: clampTimeUs(targetUs, Math.max(0, endUs - 1)), endUs }
    : {
        startUs,
        endUs: Math.max(startUs + 1, clampTimeUs(targetUs, durationUs)),
      };
}

export function editCut(
  cut: CutDecision,
  range: { startUs: number; endUs: number },
): CutDecision {
  return { ...cut, ...range };
}
export function editCamera(
  camera: CameraDecision,
  patch: Partial<CameraDecision>,
): CameraDecision {
  return {
    ...camera,
    ...patch,
    centerX: clampNullable(patch.centerX ?? camera.centerX, 0, 1),
    centerY: clampNullable(patch.centerY ?? camera.centerY, 0, 1),
    zoom: clampNullable(patch.zoom ?? camera.zoom, 1, 3),
  };
}

function clampNullable(value: number | null, minimum: number, maximum: number) {
  return value === null ? null : Math.min(maximum, Math.max(minimum, value));
}
