import { ShieldAlert, Trash2 } from "lucide-react";
import type { LocalProject } from "../types/project";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface ConfirmDeleteModalProps {
  onClose: () => void;
  onConfirm: () => void;
  project: LocalProject | null;
}

export function ConfirmDeleteModal({ onClose, onConfirm, project }: ConfirmDeleteModalProps) {
  return (
    <Modal onClose={onClose} open={project !== null} size="small" title="Eliminar referencia">
      <div className="p-6">
        <div className="flex gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-danger/25 bg-danger/10 text-danger">
            <ShieldAlert aria-hidden="true" size={20} />
          </span>
          <div>
            <p className="font-semibold text-ink">¿Eliminar “{project?.name}”?</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              Se eliminará el proyecto de CHETO VIDEO AI. El archivo de video original no será eliminado.
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3 border-t border-line pt-5">
          <Button onClick={onClose} variant="secondary">Cancelar</Button>
          <Button icon={<Trash2 aria-hidden="true" size={16} />} onClick={onConfirm} variant="danger">
            Eliminar referencia
          </Button>
        </div>
      </div>
    </Modal>
  );
}
