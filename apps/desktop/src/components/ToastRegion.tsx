import { Check, Info, X, XCircle } from "lucide-react";
import { useEffect } from "react";
import { cn } from "../lib/cn";
import type { ToastMessage, ToastTone } from "../types/toast";

interface ToastRegionProps {
  onDismiss: (id: string) => void;
  toasts: ToastMessage[];
}

const toneStyles: Record<ToastTone, { accent: string; icon: string }> = {
  success: { accent: "bg-success", icon: "bg-success/[0.08] text-success" },
  error: { accent: "bg-danger", icon: "bg-danger/[0.08] text-danger" },
  info: { accent: "bg-cyan", icon: "bg-cyan/[0.08] text-cyan" },
};

const toneIcons: Record<ToastTone, typeof Check> = {
  success: Check,
  error: XCircle,
  info: Info,
};

function ToastItem({ toast, onDismiss }: { onDismiss: (id: string) => void; toast: ToastMessage }) {
  const Icon = toneIcons[toast.tone];
  const tone = toneStyles[toast.tone];

  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), 3400);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast.id]);

  return (
    <div className="toast-enter relative flex min-w-[300px] max-w-[380px] items-center gap-3 overflow-hidden rounded-lg border border-white/[0.08] bg-[#0d1622]/96 px-3 py-2.5 shadow-[0_16px_44px_rgba(0,0,0,.38)] backdrop-blur-md">
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-0.5", tone.accent)} />

      <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md", tone.icon)}>
        <Icon aria-hidden="true" size={14} />
      </span>

      <p className="min-w-0 flex-1 text-[11px] font-medium leading-4 text-ink/90">
        {toast.message}
      </p>

      <button
        aria-label="Cerrar notificación"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted/45 transition-colors hover:bg-white/[0.05] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/55"
        onClick={() => onDismiss(toast.id)}
        type="button"
      >
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  );
}

export function ToastRegion({ onDismiss, toasts }: ToastRegionProps) {
  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[70] flex flex-col items-end gap-2"
    >
      {toasts.map((toast) => (
        <div className="pointer-events-auto" key={toast.id}>
          <ToastItem onDismiss={onDismiss} toast={toast} />
        </div>
      ))}
    </div>
  );
}
