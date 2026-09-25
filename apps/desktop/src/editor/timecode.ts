const US_PER_SECOND = 1_000_000;
const US_PER_MINUTE = 60 * US_PER_SECOND;
const US_PER_HOUR = 60 * US_PER_MINUTE;

export function formatTimecode(us: number, milliseconds = true): string {
  const safeUs = Math.max(0, Math.round(us));
  const hours = Math.floor(safeUs / US_PER_HOUR);
  const minutes = Math.floor((safeUs % US_PER_HOUR) / US_PER_MINUTE);
  const seconds = Math.floor((safeUs % US_PER_MINUTE) / US_PER_SECOND);
  const millis = Math.floor((safeUs % US_PER_SECOND) / 1_000);
  const base = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return milliseconds ? `${base}.${String(millis).padStart(3, "0")}` : base;
}

export function formatRulerTime(us: number, stepUs: number): string {
  if (stepUs < US_PER_SECOND) return formatTimecode(us).slice(3);
  if (stepUs < US_PER_MINUTE)
    return formatTimecode(us, stepUs < 10 * US_PER_SECOND).slice(3);
  if (us >= US_PER_HOUR) return formatTimecode(us, false);
  return formatTimecode(us, false).slice(3);
}

export function parseTimecode(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (
    parts.length > 3 ||
    parts.some((part) => !/^\d+(?:\.\d{1,6})?$/.test(part))
  )
    return null;
  const seconds = Number(parts.at(-1));
  const minutes = parts.length >= 2 ? Number(parts.at(-2)) : 0;
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (
    !Number.isFinite(seconds) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(hours) ||
    seconds >= 60 ||
    minutes >= 60
  )
    return null;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * US_PER_SECOND);
}

export function clampTimeUs(us: number, durationUs: number): number {
  return Math.min(
    Math.max(0, Math.round(us)),
    Math.max(0, Math.round(durationUs)),
  );
}
