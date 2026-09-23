export type ToastTone = "success" | "error" | "info";

export interface ToastMessage {
  id: string;
  message: string;
  tone: ToastTone;
}
