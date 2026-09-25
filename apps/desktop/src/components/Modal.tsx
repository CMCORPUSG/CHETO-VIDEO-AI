import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
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

export function Modal({
  children,
  description,
  onClose,
  open,
  size = "medium",
  title,
}: ModalProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop-enter fixed inset-0 z-50 bg-canvas/80 backdrop-blur-md" />

        <Dialog.Content
          aria-describedby={description ? "modal-description" : undefined}
          className={cn(
            "modal-panel-enter surface-shine fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2.5rem)] w-[calc(100%-2.5rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-line-bright bg-surface shadow-modal focus:outline-none",
            sizeStyles[size],
          )}
        >
          <header className="flex items-start justify-between border-b border-line bg-[linear-gradient(120deg,rgba(47,107,255,.09),transparent_55%)] px-6 py-5">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan">
                Proyecto local
              </p>

              <Dialog.Title className="text-xl font-semibold text-ink">
                {title}
              </Dialog.Title>

              {description ? (
                <Dialog.Description
                  className="mt-1 text-sm text-muted"
                  id="modal-description"
                >
                  {description}
                </Dialog.Description>
              ) : null}
            </div>

            <Dialog.Close asChild>
              <button
                aria-label="Cerrar modal"
                className="rounded-md p-2 text-muted transition hover:bg-card hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </header>

          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
