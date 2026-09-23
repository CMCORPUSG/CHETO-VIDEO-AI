import { useState, type FormEvent } from "react";
import type { LocalProject } from "../types/project";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface RenameProjectModalProps {
  onClose: () => void;
  onRename: (name: string) => void;
  project: LocalProject | null;
}

export function RenameProjectModal({ onClose, onRename, project }: RenameProjectModalProps) {
  const [name, setName] = useState(project?.name ?? "");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    onRename(nextName);
  };

  return (
    <Modal
      description="El archivo de video conservará su nombre original."
      onClose={onClose}
      open={project !== null}
      size="small"
      title="Renombrar proyecto"
    >
      <form className="p-6" onSubmit={handleSubmit}>
        <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="rename-project">
          Nombre del proyecto
        </label>
        <input
          autoFocus
          className="h-11 w-full rounded-md border border-line bg-canvas px-3.5 text-sm text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25"
          id="rename-project"
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
        <div className="mt-6 flex justify-end gap-3 border-t border-line pt-5">
          <Button onClick={onClose} variant="secondary">Cancelar</Button>
          <Button disabled={!name.trim() || name.trim() === project?.name} type="submit">Guardar nombre</Button>
        </div>
      </form>
    </Modal>
  );
}
