export type LogLevel = "info" | "warning" | "error";

export interface DiagnosticEvent {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
}
