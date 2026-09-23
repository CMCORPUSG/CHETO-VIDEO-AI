export interface FfprobeStatus {
  available: boolean;
  detail: string | null;
  executable: string;
  version: string | null;
}

export interface SourceSnapshot {
  fileName: string;
  lastModifiedMs: number | null;
  path: string;
  sizeBytes: number;
}

export interface StreamSummary {
  audio: number;
  data: number;
  other: number;
  subtitle: number;
  total: number;
  video: number;
}

export interface VideoTrackMetadata {
  aspectRatio: string | null;
  bitrateBps: number | null;
  codec: string | null;
  codecLongName: string | null;
  displayHeight: number | null;
  displayWidth: number | null;
  fpsDecimal: number | null;
  fpsDenominator: number | null;
  fpsNumerator: number | null;
  height: number | null;
  pixelFormat: string | null;
  rotation: number;
  width: number | null;
}

export interface AudioTrackMetadata {
  bitrateBps: number | null;
  channelLayout: string | null;
  channels: number | null;
  codec: string | null;
  codecLongName: string | null;
  present: boolean;
  sampleRateHz: number | null;
}

export interface VideoMetadata {
  audio: AudioTrackMetadata;
  container: {
    displayName: string;
    rawName: string | null;
  };
  durationSeconds: number | null;
  extension: string;
  fileName: string;
  lastModifiedMs: number | null;
  path: string;
  schemaVersion: 1;
  sizeBytes: number;
  streams: StreamSummary;
  video: VideoTrackMetadata;
}

export interface NativeProbeResponse {
  elapsedMs: number;
  rawJson: string;
  source: SourceSnapshot;
}

export interface SourceCheck {
  changed: boolean;
  exists: boolean;
  lastModifiedMs: number | null;
  sizeBytes: number | null;
}

export interface ProbeResult {
  elapsedMs: number;
  metadata: VideoMetadata;
}
