import type { DiagnosticEvent } from "../types/diagnostics";

export const DIAGNOSTIC_SESSION_ID = globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}`;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 1000;
const MAX_BYTES = 5_000_000;

export function appendDiagnostic(current: DiagnosticEvent[], event: DiagnosticEvent, now = Date.now()): DiagnosticEvent[] {
  const recent = current.filter((item) => {
    const time = Date.parse(item.timestamp);
    return Number.isFinite(time) && now - time <= RETENTION_MS && !/^CAPTIONS_|^TRANSCRIPT_/i.test(item.message);
  });
  if (event.level === "info" && /(?:_ANALYZING_|_PROGRESS|_EXTRACTING_SAMPLES)/.test(event.message)) return recent;
  const last = recent.at(-1);
  if (last && last.level === event.level && last.message === event.message && now - Date.parse(last.timestamp) < 2_000) return recent;
  const result = [...recent, event].slice(-MAX_EVENTS);
  while (result.length && JSON.stringify(result).length > MAX_BYTES) result.shift();
  return result;
}

export function pruneDiagnostics(events: DiagnosticEvent[], now = Date.now()) {
  return events.reduce<DiagnosticEvent[]>((current, event) => appendDiagnostic(current, event, now), []);
}
