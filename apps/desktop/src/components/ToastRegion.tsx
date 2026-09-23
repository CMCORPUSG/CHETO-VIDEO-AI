import { Check, Info, X, XCircle } from "lucide-react";
import { useEffect } from "react";
import { cn } from "../lib/cn";
import type { ToastMessage, ToastTone } from "../types/toast";

interface ToastRegionProps {
  onDismiss: (id: string) => void;
  toasts: ToastMessage[];
}

const toneStyles: Record<ToastTone, string> = {
  success: "border-success/35 bg-success/10 text-success",
  error: "border-danger/35 bg-danger/10 text-danger",
  info: "border-cyan/35 bg-cyan/10 text-cyan",
};

const toneIcons: Record<ToastTone, typeof Check> = {
  success: Check,
  error: XCircle,
  info: Info,
};

function ToastItem({ toast, onDismiss }: { onDismiss: (id: string) => void; toast: ToastMessage }) {
  const Icon = toneIcons[toast.tone];

  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), 3200);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast.id]);

  return (
    <div className="toast-enter flex min-w-72 max-w-sm items-center gap-3 rounded-lg border border-line-bright bg-elevated/95 p-3.5 shadow-modal backdrop-blur-md">
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-md border", toneStyles[toast.tone])}>
        <Icon aria-hidden="true" size={16} />
      </span>
      <p className="flex-1 text-sm font-semibold text-ink">{toast.message}</p>
      <button
        aria-label="Cerrar notificación"
        className="rounded-md p-1.5 text-muted transition hover:bg-card hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        onClick={() => onDismiss(toast.id)}
        type="button"
      >
        <X aria-hidden="true" size={15} />
      </button>
    </div>
  );
}

export function ToastRegion({ onDismiss, toasts }: ToastRegionProps) {
  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 right-5 z-[70] flex flex-col items-end gap-3"
    >
      {toasts.map((toast) => (
        <div className="pointer-events-auto" key={toast.id}>
          <ToastItem onDismiss={onDismiss} toast={toast} />
        </div>
      ))}
    </div>
  );
}
