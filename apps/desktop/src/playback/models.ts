export type PlaybackState = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";
export type PlaybackKind = "original" | "proxy";
export type PlaybackPreference = "auto" | PlaybackKind;
export type ProxyState = "not_created" | "preparing" | "generating" | "available" | "stale" | "cancelled" | "error";

export interface ProxyManifest {
  createdAt: string;
  proxy: {
    codec: string;
    encoder: string;
    file: "media/proxy.mp4";
    fileSizeBytes: number;
    fps: { denominator: number; numerator: number };
    height: number;
    width: number;
  };
  schemaVersion: 1;
  source: { durationUs: number; fileSizeBytes: number; modifiedAt: string | null };
  sourceId: string;
}

export interface ProxyStatus {
  message: string | null;
  metadata: ProxyManifest | null;
  processedUs: number | null;
  progress: number | null;
  state: ProxyState;
}

export interface PlaybackSource {
  durationUs: number;
  kind: PlaybackKind;
  path: string;
}

export interface ProxyProgress {
  processedUs: number;
  progress: number;
  projectId: string;
  status: ProxyState;
}

export interface ProxyDiagnostic {
  event: string;
  projectId: string;
}

export type PlayerEvent = "load" | "ready" | "play" | "pause" | "end" | "fail";

export function nextPlaybackState(_current: PlaybackState, event: PlayerEvent): PlaybackState {
  const states: Record<PlayerEvent, PlaybackState> = {
    load: "loading",
    ready: "ready",
    play: "playing",
    pause: "paused",
    end: "ended",
    fail: "error",
  };
  return states[event];
}

export function preferredPlaybackKind(status: ProxyStatus, preference: PlaybackPreference): PlaybackKind {
  if (preference === "original") return "original";
  if (preference === "proxy") return status.state === "available" ? "proxy" : "original";
  return status.state === "available" ? "proxy" : "original";
}
