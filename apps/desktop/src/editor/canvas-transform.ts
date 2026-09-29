export const DEFAULT_CANVAS_SCALE = 1;

/** Returns the stored/editor scale in the model's 1.0 = 100% units. */
export function normalizeCanvasScale(value: unknown, fallback = DEFAULT_CANVAS_SCALE): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function isValidCanvasScale(value: unknown): value is number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}
