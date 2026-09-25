import { Pencil } from "lucide-react";
import {
  useState,
  type FormEvent,
} from "react";
import type { LocalProject } from "../types/project";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface RenameProjectModalProps {
  onClose: () => void;
  onRename: (name: string) => void;
  project: LocalProject | null;
}

export function RenameProjectModal({
  onClose,
  onRename,
  project,
}: RenameProjectModalProps) {
  const [name, setName] = useState(
    project?.name ?? "",
  );


  const handleSubmit = (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    const nextName = name.trim();

    if (!nextName) return;

    onRename(nextName);
  };

  return (
    <Modal
      description="El nombre del archivo de video original no será modificado."
      onClose={onClose}
      open={project !== null}
      size="small"
      title="Renombrar proyecto"
    >
      <form
        className="p-4"
        onSubmit={handleSubmit}
      >
        <div className="mb-3 flex items-center gap-2 text-muted/45">
          <Pencil size={14} />

          <span className="text-[9px]">
            Cambiar nombre visible
          </span>
        </div>

        <label
          className="mb-2 block text-[10px] font-medium text-muted/65"
          htmlFor="rename-project"
        >
          Nombre del proyecto
        </label>

        <input
          autoFocus
          className="cheto-input"
          id="rename-project"
          maxLength={80}
          onChange={(event) =>
            setName(event.target.value)
          }
          value={name}
        />

        <div className="mt-4 flex justify-end gap-2 border-t border-white/[0.06] pt-3.5">
          <Button
            onClick={onClose}
            variant="secondary"
          >
            Cancelar
          </Button>

          <Button
            disabled={
              !name.trim() ||
              name.trim() === project?.name
            }
            type="submit"
          >
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
