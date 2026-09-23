export type LogLevel = "info" | "warning" | "error";

export interface DiagnosticEvent {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
}

export interface MediaDiagnosticState {
  ffprobeAvailable: boolean;
  ffprobeDetail: string | null;
  ffprobeVersion: string | null;
  lastFileName: string | null;
  lastProbeMs: number | null;
}
