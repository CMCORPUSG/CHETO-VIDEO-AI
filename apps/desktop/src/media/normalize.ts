import { getFileExtension } from "../lib/format";
import type { SourceSnapshot, StreamSummary, VideoMetadata } from "./models";

interface RawStream {
  avg_frame_rate?: string;
  bit_rate?: string;
  channel_layout?: string;
  channels?: number;
  codec_long_name?: string;
  codec_name?: string;
  codec_type?: string;
  display_aspect_ratio?: string;
  duration?: string;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  sample_aspect_ratio?: string;
  sample_rate?: string;
  side_data_list?: Array<{ rotation?: number }>;
  tags?: { rotate?: string };
  width?: number;
}

interface RawProbe {
  format?: {
    bit_rate?: string;
    duration?: string;
    format_long_name?: string;
    format_name?: string;
    size?: string;
  };
  streams?: RawStream[];
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? Math.round(parsed) : null;
}

export function parseFrameRate(value: string | undefined): {
  decimal: number | null;
  denominator: number | null;
  numerator: number | null;
} {
  if (!value) return { decimal: null, denominator: null, numerator: null };
  const [rawNumerator, rawDenominator = "1"] = value.split("/");
  const numerator = Number(rawNumerator);
  const denominator = Number(rawDenominator);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) {
    return { decimal: null, denominator: null, numerator: null };
  }
  return { decimal: numerator / denominator, denominator, numerator };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function simplifyRatio(width: number, height: number): string {
  const divisor = greatestCommonDivisor(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function parseRatio(value: string | undefined): [number, number] | null {
  if (!value || value === "0:1" || value === "N/A") return null;
  const [left, right] = value.split(":").map(Number);
  return Number.isFinite(left) && Number.isFinite(right) && left > 0 && right > 0 ? [left, right] : null;
}

export function resolveAspectRatio(
  width: number | null,
  height: number | null,
  displayAspectRatio?: string,
  rotation = 0,
): string | null {
  const declared = parseRatio(displayAspectRatio);
  let ratio = declared ? simplifyRatio(declared[0], declared[1]) : null;
  if (!ratio && width && height) ratio = simplifyRatio(width, height);
  if (!ratio || Math.abs(rotation) % 180 !== 90) return ratio;
  const [left, right] = ratio.split(":").map(Number);
  return simplifyRatio(right, left);
}

function normalizeRotation(stream: RawStream): number {
  const sideDataRotation = stream.side_data_list?.find((entry) => finiteNumber(entry.rotation) !== null)?.rotation;
  const rotation = finiteNumber(sideDataRotation ?? stream.tags?.rotate) ?? 0;
  const normalized = ((Math.round(rotation) % 360) + 360) % 360;
  return normalized === 270 ? -90 : normalized;
}

function containerName(rawName: string | undefined, extension: string): string {
  const raw = rawName?.toLowerCase() ?? "";
  if (extension === "mp4") return "MP4";
  if (extension === "mov") return "MOV";
  if (extension === "mkv" || raw.includes("matroska")) return "Matroska / MKV";
  if (extension === "avi" || raw.includes("avi")) return "AVI";
  return rawName?.split(",")[0]?.toUpperCase() || extension.toUpperCase() || "No disponible";
}

function countStreams(streams: RawStream[]): StreamSummary {
  const summary: StreamSummary = { audio: 0, data: 0, other: 0, total: streams.length, video: 0 };
  for (const stream of streams) {
    if (stream.codec_type === "video") summary.video += 1;
    else if (stream.codec_type === "audio") summary.audio += 1;
    else if (stream.codec_type === "data") summary.data += 1;
    else summary.other += 1;
  }
  return summary;
}

export function normalizeProbe(raw: RawProbe, source: SourceSnapshot): VideoMetadata {
  const streams = Array.isArray(raw.streams) ? raw.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error("El archivo no contiene una pista de video válida.");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const rotation = normalizeRotation(video);
  const rotated = Math.abs(rotation) % 180 === 90;
  const width = positiveInteger(video.width);
  const height = positiveInteger(video.height);
  const fps = parseFrameRate(video.avg_frame_rate && video.avg_frame_rate !== "0/0" ? video.avg_frame_rate : video.r_frame_rate);
  const extension = getFileExtension(source.fileName);

  return {
    schemaVersion: 1,
    fileName: source.fileName,
    path: source.path,
    extension,
    sizeBytes: source.sizeBytes,
    lastModifiedMs: source.lastModifiedMs,
    durationSeconds: finiteNumber(raw.format?.duration ?? video.duration),
    container: {
      displayName: containerName(raw.format?.format_name, extension),
      rawName: raw.format?.format_name ?? null,
    },
    streams: countStreams(streams),
    video: {
      codec: video.codec_name ?? null,
      codecLongName: video.codec_long_name ?? null,
      width,
      height,
      displayWidth: rotated ? height : width,
      displayHeight: rotated ? width : height,
      fpsNumerator: fps.numerator,
      fpsDenominator: fps.denominator,
      fpsDecimal: fps.decimal,
      aspectRatio: resolveAspectRatio(width, height, video.display_aspect_ratio, rotation),
      bitrateBps: positiveInteger(video.bit_rate),
      pixelFormat: video.pix_fmt ?? null,
      rotation,
    },
    audio: {
      present: Boolean(audio),
      codec: audio?.codec_name ?? null,
      codecLongName: audio?.codec_long_name ?? null,
      sampleRateHz: positiveInteger(audio?.sample_rate),
      channels: positiveInteger(audio?.channels),
      channelLayout: audio?.channel_layout ?? null,
      bitrateBps: positiveInteger(audio?.bit_rate),
    },
  };
}

export function parseProbeJson(rawJson: string, source: SourceSnapshot): VideoMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("FFprobe devolvió una respuesta que no es JSON válido.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("FFprobe devolvió metadata incompleta.");
  return normalizeProbe(parsed, source);
}
