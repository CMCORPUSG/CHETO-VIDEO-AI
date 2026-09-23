import { FileVideo, FolderOpen } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";

export interface ProjectDraft {
  fileName: string;
  name: string;
}

interface NewProjectModalProps {
  onClose: () => void;
  onCreate: (project: ProjectDraft) => void;
  open: boolean;
}

export function NewProjectModal({ onClose, onCreate, open }: NewProjectModalProps) {
  const inputId = useId();
  const [name, setName] = useState("");
  const [fileName, setFileName] = useState("");

  const closeAndReset = () => {
    setName("");
    setFileName("");
    onClose();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !fileName) return;
    onCreate({ name: name.trim(), fileName });
    closeAndReset();
  };

  return (
    <Modal
      description="Define los datos básicos. El video no se procesará en esta versión."
      onClose={closeAndReset}
      open={open}
      title="Nuevo proyecto"
    >
      <form className="space-y-5 p-6" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm font-medium text-ink" htmlFor="project-name">
            Nombre
          </label>
          <input
            autoFocus
            className="h-11 w-full rounded-md border border-line bg-canvas px-3.5 text-sm text-ink outline-none transition placeholder:text-muted/70 focus:border-primary focus:ring-2 focus:ring-primary/25"
            id="project-name"
            onChange={(event) => setName(event.target.value)}
            placeholder="Mi nuevo proyecto"
            type="text"
            value={name}
          />
        </div>

        <div>
          <span className="mb-2 block text-sm font-medium text-ink">Video</span>
          <input
            accept="video/mp4,video/quicktime,video/x-matroska,video/x-msvideo"
            className="sr-only"
            id={inputId}
            onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
            type="file"
          />
          <label
            className="flex min-h-24 cursor-pointer items-center gap-4 rounded-md border border-dashed border-line bg-canvas px-4 transition hover:border-primary/70 hover:bg-primary/5 focus-within:ring-2 focus-within:ring-primary"
            htmlFor={inputId}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-card text-cyan">
              {fileName ? <FileVideo aria-hidden="true" size={20} /> : <FolderOpen aria-hidden="true" size={20} />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">
                {fileName || "Seleccionar archivo"}
              </span>
              <span className="mt-1 block text-xs text-muted">
                Se conservará sólo como referencia visual en esta sesión.
              </span>
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-line pt-5">
          <Button onClick={closeAndReset} variant="secondary">
            Cancelar
          </Button>
          <Button disabled={!name.trim() || !fileName} type="submit">
            Crear proyecto
          </Button>
        </div>
      </form>
    </Modal>
  );
}
