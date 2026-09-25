import { ShieldAlert, Trash2 } from "lucide-react";
import type { LocalProject } from "../types/project";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface ConfirmDeleteModalProps {
  onClose: () => void;
  onConfirm: () => void;
  project: LocalProject | null;
}

export function ConfirmDeleteModal({
  onClose,
  onConfirm,
  project,
}: ConfirmDeleteModalProps) {
  return (
    <Modal
      onClose={onClose}
      open={project !== null}
      size="small"
      title="Eliminar referencia"
    >
      <div className="p-4">
        <div className="flex gap-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger/[0.07] text-danger ring-1 ring-danger/15">
            <ShieldAlert size={17} />
          </span>

          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-ink">
              ¿Eliminar “{project?.name}”?
            </p>

            <p className="mt-2 text-[10px] leading-5 text-muted/55">
              Se eliminará únicamente la referencia y los datos del
              proyecto en CHETO VIDEO AI. El video original permanecerá
              intacto.
            </p>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t border-white/[0.06] pt-3.5">
          <Button
            onClick={onClose}
            variant="secondary"
          >
            Cancelar
          </Button>

          <Button
            icon={<Trash2 size={14} />}
            onClick={onConfirm}
            variant="danger"
          >
            Eliminar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
