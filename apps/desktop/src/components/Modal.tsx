import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

interface ModalProps {
  children: ReactNode;
  description?: string;
  onClose: () => void;
  open: boolean;
  title: string;
}

export function Modal({ children, description, onClose, open, title }: ModalProps) {
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
      className="fixed inset-0 z-50 grid place-items-center bg-canvas/85 p-5 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-describedby={description ? "modal-description" : undefined}
        aria-labelledby="modal-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-lg border border-line bg-surface shadow-modal"
        role="dialog"
      >
        <header className="flex items-start justify-between border-b border-line px-6 py-5">
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
