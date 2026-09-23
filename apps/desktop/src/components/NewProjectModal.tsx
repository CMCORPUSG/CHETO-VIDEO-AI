import { CheckCircle2, FileVideo, FolderOpen, Info, UploadCloud } from "lucide-react";
import { useId, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { cn } from "../lib/cn";
import { formatFileSize, getFileExtension, isSupportedVideo } from "../lib/format";
import type { ProjectDraft } from "../types/project";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface NewProjectModalProps {
  onClose: () => void;
  onCreate: (project: ProjectDraft) => void;
  onError: (message: string) => void;
  open: boolean;
}

export function NewProjectModal({ onClose, onCreate, onError, open }: NewProjectModalProps) {
  const inputId = useId();
  const [name, setName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const reset = () => {
    setName("");
    setSelectedFile(null);
    setFileError("");
    setIsDragging(false);
  };

  const closeAndReset = () => {
    reset();
    onClose();
  };

  const selectFile = (file: File | undefined) => {
    if (!file) return;
    if (!isSupportedVideo(file.name)) {
      setSelectedFile(null);
      setFileError("Este formato todavía no está soportado.");
      onError("Archivo no soportado");
      return;
    }

    setSelectedFile(file);
    setFileError("");
    if (!name.trim()) setName(file.name.replace(/\.[^/.]+$/, ""));
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files[0]);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !selectedFile) return;
    onCreate({
      name: name.trim(),
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      fileExtension: getFileExtension(selectedFile.name),
      sourcePath: selectedFile.name,
    });
    closeAndReset();
  };

  return (
    <Modal
      description="Prepara un espacio de trabajo local para tu próxima edición."
      onClose={closeAndReset}
      open={open}
      size="large"
      title="Nuevo proyecto"
    >
      <form className="space-y-6 p-6" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="project-name">
            Nombre del proyecto
          </label>
          <input
            autoFocus
            className="h-12 w-full rounded-md border border-line bg-canvas px-4 text-sm text-ink outline-none transition duration-150 placeholder:text-muted/60 focus:border-primary focus:ring-2 focus:ring-primary/25"
            id="project-name"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="Mi nuevo proyecto"
            type="text"
            value={name}
          />
        </div>

        <div>
          <span className="mb-2 block text-sm font-semibold text-ink">Video</span>
          <input
            accept=".mp4,.mov,.mkv,.avi,video/mp4,video/quicktime,video/x-matroska,video/x-msvideo"
            className="sr-only"
            id={inputId}
            onChange={handleFileInput}
            type="file"
          />

          {selectedFile ? (
            <div className="rounded-xl border border-success/30 bg-success/5 p-4">
              <div className="flex items-center gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-cyan/25 bg-primary/10 text-cyan">
                  <FileVideo aria-hidden="true" size={21} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-bold text-ink">{selectedFile.name}</p>
                    <CheckCircle2 aria-hidden="true" className="shrink-0 text-success" size={16} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {formatFileSize(selectedFile.size)} · {getFileExtension(selectedFile.name).toUpperCase()}
                  </p>
                </div>
                <label
                  className="cursor-pointer rounded-md border border-line-bright bg-elevated px-3 py-2 text-xs font-semibold text-ink transition hover:border-cyan/50 hover:text-cyan focus-within:ring-2 focus-within:ring-cyan"
                  htmlFor={inputId}
                >
                  Cambiar
                </label>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                "relative flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center transition duration-150",
                isDragging
                  ? "scale-[1.01] border-cyan bg-cyan/10 shadow-glow"
                  : fileError
                    ? "border-danger/60 bg-danger/5"
                    : "border-line-bright bg-canvas/60 hover:border-primary/70 hover:bg-primary/5",
              )}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <span className={cn(
                "grid h-14 w-14 place-items-center rounded-xl border transition",
                isDragging ? "border-cyan/50 bg-cyan/15 text-cyan" : "border-primary/25 bg-primary/10 text-cyan",
              )}>
                {isDragging ? <UploadCloud aria-hidden="true" size={25} /> : <FolderOpen aria-hidden="true" size={24} />}
              </span>
              <p className="mt-4 text-base font-bold text-ink">
                {isDragging ? "Suelta el video aquí" : "Arrastra tu video aquí"}
              </p>
              <p className="my-2 text-xs text-muted">o</p>
              <label
                className="cursor-pointer rounded-md border border-primary/60 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-cyan transition hover:border-cyan hover:bg-primary/20 focus-within:ring-2 focus-within:ring-cyan"
                htmlFor={inputId}
              >
                Seleccionar archivo
              </label>
              <p className="mt-4 text-[11px] font-semibold tracking-[0.08em] text-muted">MP4 · MOV · MKV · AVI</p>
            </div>
          )}

          {fileError ? (
            <p className="mt-2 flex items-center gap-2 text-sm font-medium text-danger" role="alert">
              <Info aria-hidden="true" size={15} />
              {fileError}
            </p>
          ) : null}
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-line bg-card/60 p-3.5">
          <Info aria-hidden="true" className="mt-0.5 shrink-0 text-cyan" size={16} />
          <p className="text-xs leading-5 text-muted">
            Esta etapa todavía no procesa video. El archivo original no se modifica, copia, mueve ni sube a internet.
          </p>
        </div>

        <div className="flex justify-end gap-3 border-t border-line pt-5">
          <Button onClick={closeAndReset} variant="secondary">Cancelar</Button>
          <Button disabled={!name.trim() || !selectedFile} type="submit">Crear proyecto</Button>
        </div>
      </form>
    </Modal>
  );
}
