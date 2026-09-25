import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

interface ModalProps {
  children: ReactNode;
  description?: string;
  eyebrow?: string;
  onClose: () => void;
  open: boolean;
  size?: "small" | "medium" | "large";
  title: string;
}

const sizeStyles = {
  small: "max-w-[520px]",
  medium: "max-w-[680px]",
  large: "max-w-[860px]",
};

export function Modal({
  children,
  description,
  eyebrow = "CHETO VIDEO AI",
  onClose,
  open,
  size = "medium",
  title,
}: ModalProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop-enter fixed inset-0 z-50 bg-[#02060b]/78 backdrop-blur-sm" />

        <Dialog.Content
          aria-describedby={description ? "modal-description" : undefined}
          className={cn(
            "modal-panel-enter fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[10px] border border-white/[0.08] bg-[#0a111b] shadow-[0_26px_80px_rgba(0,0,0,.5)] focus:outline-none",
            sizeStyles[size],
          )}
        >
          <header className="flex items-start justify-between gap-5 border-b border-white/[0.06] px-5 py-4">
            <div className="min-w-0">
              <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-cyan/70">
                {eyebrow}
              </p>

              <Dialog.Title className="mt-1 text-[16px] font-semibold tracking-tight text-ink">
                {title}
              </Dialog.Title>

              {description ? (
                <Dialog.Description
                  className="mt-1.5 max-w-2xl text-[10px] leading-5 text-muted/55"
                  id="modal-description"
                >
                  {description}
                </Dialog.Description>
              ) : null}
            </div>

            <Dialog.Close asChild>
              <button
                aria-label="Cerrar modal"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted/55 transition-colors hover:bg-white/[0.05] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/55"
                type="button"
              >
                <X aria-hidden="true" size={16} />
              </button>
            </Dialog.Close>
          </header>

          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
