import type { HardwareProfile } from "../hardware/profile";

export type ExportResolution = "original" | "480" | "720" | "1080" | "1440" | "2160";
export type ExportFps = "original" | "24" | "25" | "30" | "50" | "60";
export type ExportBitrate = "auto" | "low" | "medium" | "high" | "max";
export type ExportPreset = "fast" | "balanced" | "high" | "maximum" | "custom";
export type FitMode = "cover" | "contain" | "center";
export type BackgroundMode = "black" | "blur" | "color";

export function recommendedPreset(profile: HardwareProfile | null, sourceWidth: number, sourceHeight: number, durationUs: number, freeBytes: number): Exclude<ExportPreset, "custom"> {
  if (!profile || (freeBytes > 0 && freeBytes < 3_000_000_000) || profile.ramAvailableBytes < 3_000_000_000) return "fast";
  if (sourceWidth * sourceHeight >= 3840 * 2160 || durationUs >= 7_200_000_000) return "balanced";
  return "balanced";
}

export function presetSettings(preset: Exclude<ExportPreset, "custom">): { resolution: ExportResolution; bitrate: ExportBitrate } {
  if (preset === "fast") return { resolution: "original", bitrate: "low" };
  if (preset === "balanced") return { resolution: "original", bitrate: "medium" };
  if (preset === "high") return { resolution: "original", bitrate: "high" };
  return { resolution: "original", bitrate: "max" };
}
export interface ExportConfig {
  projectId: string;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  bitrate: ExportBitrate;
  includeAudio: boolean;
  aspectRatio: number;
  preset?: ExportPreset;
  canvasScale: number;
  canvasOffsetX: number;
  canvasOffsetY: number;
  fitMode: FitMode;
  backgroundMode: BackgroundMode;
  backgroundColor: string;
}
export interface ExportProgress {
  projectId: string;
  stage: "preparing" | "rendering" | "completed";
  progress: number;
  processedUs: number;
  durationUs: number;
}
export interface ExportResult {
  outputPath: string;
  encoder: string;
  fileSizeBytes: number;
  durationUs: number;
}
export function exportDimensions(
  resolution: ExportResolution,
  sourceWidth: number,
  sourceHeight: number,
  aspectRatio: number,
) {
  if (resolution === "original")
    return evenFit(sourceWidth, sourceHeight, aspectRatio);
  const height = Number(resolution);
  return {
    height,
    width: Math.max(2, Math.round((height * aspectRatio) / 2) * 2),
  };
}
function evenFit(width: number, height: number, aspectRatio: number) {
  const sourceRatio = width / Math.max(1, height);
  return sourceRatio > aspectRatio
    ? {
        width: Math.max(2, Math.round((height * aspectRatio) / 2) * 2),
        height: Math.max(2, Math.round(height / 2) * 2),
      }
    : {
        width: Math.max(2, Math.round(width / 2) * 2),
        height: Math.max(2, Math.round(width / aspectRatio / 2) * 2),
      };
}
export function validateExportConfig(config: ExportConfig): string | null {
  if (!config.outputPath.toLowerCase().endsWith(".mp4"))
    return "Selecciona una ruta MP4 válida.";
  if (
    config.width < 16 ||
    config.height < 16 ||
    config.width % 2 ||
    config.height % 2
  )
    return "La resolución debe usar dimensiones pares.";
  if (config.fps < 1 || config.fps > 240) return "Los FPS no son válidos.";
  if (config.aspectRatio < 0.2 || config.aspectRatio > 5)
    return "La relación de aspecto no es válida.";
  if (config.canvasScale < 0.5 || config.canvasScale > 2.5)
    return "La escala del lienzo no es válida.";
  if (Math.abs(config.canvasOffsetX) > 1 || Math.abs(config.canvasOffsetY) > 1)
    return "La posición del lienzo no es válida.";
  if (!/^(#[0-9a-fA-F]{6})$/.test(config.backgroundColor))
    return "El color de fondo no es válido.";
  return null;
}
export function estimatedSizeBytes(
  durationUs: number,
  bitrate: ExportBitrate,
  includeAudio: boolean,
) {
  const videoMbps = { auto: 5, low: 2, medium: 5, high: 10, max: 16 }[bitrate];
  return Math.round(
    (((durationUs / 1_000_000) * (videoMbps + (includeAudio ? 0.192 : 0))) /
      8) *
      1_000_000,
  );
}
