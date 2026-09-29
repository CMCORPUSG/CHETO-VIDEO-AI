const supportedVideoExtensions = new Set(["mp4", "mov", "mkv", "avi", "webm"]);

function displayPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem("cheto-video-ai.profile.v1") || "{}") as { locale?: string; timezone?: string; dateFormat?: string; timeFormat?: string };
    return {
      locale: value.locale?.startsWith("es-") ? value.locale : "es-PE",
      timeZone: value.timezone && value.timezone !== "auto" ? value.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone,
      dateFormat: value.dateFormat ?? "dmy",
      hour12: value.timeFormat === "12",
    };
  } catch {
    return { locale: "es-PE", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, dateFormat: "dmy", hour12: false };
  }
}

export function formatDisplayDate(date: Date): string {
  const prefs = displayPreferences();
  const parts = new Intl.DateTimeFormat(prefs.locale, { timeZone: prefs.timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(date);
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? "";
  if (prefs.dateFormat === "iso") return `${part("year")}-${part("month")}-${part("day")}`;
  if (prefs.dateFormat === "mdy") return `${part("month")}/${part("day")}/${part("year")}`;
  return `${part("day")}/${part("month")}/${part("year")}`;
}

export function getFileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function isSupportedVideo(fileName: string): boolean {
  return supportedVideoExtensions.has(getFileExtension(fileName));
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatProjectDate(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const prefs = displayPreferences();
  const isToday = formatDisplayDate(date) === formatDisplayDate(now);
  const time = new Intl.DateTimeFormat(prefs.locale, {
    timeZone: prefs.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: prefs.hour12,
  }).format(date);

  if (isToday) return `Hoy · ${time}`;

  const day = formatDisplayDate(date);
  return `${day} · ${time}`;
}

export function formatLogTime(timestamp: string): string {
  const prefs = displayPreferences();
  return new Intl.DateTimeFormat(prefs.locale, {
    timeZone: prefs.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: prefs.hour12,
  }).format(new Date(timestamp));
}

export function getOperatingSystem(): string {
  const userAgent = navigator.userAgent;
  if (userAgent.includes("Windows")) return "Windows";
  if (userAgent.includes("Mac OS")) return "macOS";
  if (userAgent.includes("Linux")) return "Linux";
  return "No identificado";
}
