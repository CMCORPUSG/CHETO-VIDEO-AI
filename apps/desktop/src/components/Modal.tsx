import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { cn } from "../lib/cn";

interface ModalProps {
  children: ReactNode;
  description?: string;
  onClose: () => void;
  open: boolean;
  size?: "small" | "medium" | "large";
  title: string;
}

const sizeStyles = {
  small: "max-w-lg",
  medium: "max-w-2xl",
  large: "max-w-3xl",
};

export function Modal({ children, description, onClose, open, size = "medium", title }: ModalProps) {
  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop-enter fixed inset-0 z-50 grid place-items-center bg-canvas/80 p-5 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-describedby={description ? "modal-description" : undefined}
        aria-labelledby="modal-title"
        aria-modal="true"
        className={cn(
          "modal-panel-enter surface-shine max-h-[calc(100vh-2.5rem)] w-full overflow-auto rounded-xl border border-line-bright bg-surface shadow-modal",
          sizeStyles[size],
        )}
        role="dialog"
      >
        <header className="flex items-start justify-between border-b border-line bg-[linear-gradient(120deg,rgba(47,107,255,.09),transparent_55%)] px-6 py-5">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan">
              Proyecto local
            </p>
            <h2 className="text-xl font-semibold text-ink" id="modal-title">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm text-muted" id="modal-description">
                {description}
              </p>
            ) : null}
          </div>
          <button
            aria-label="Cerrar modal"
            className="rounded-md p-2 text-muted transition hover:bg-card hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
