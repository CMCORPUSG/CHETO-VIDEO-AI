import { CheckCircle2, FileVideo, FolderOpen, Info, LoaderCircle, RefreshCw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { formatFileSize } from "../lib/format";
import { formatChannels, formatCodec, formatDuration, formatFps } from "../media/format";
import type { ProbeResult } from "../media/models";
import { probeVideo, selectVideoPath } from "../media/service";
import type { LogLevel } from "../types/diagnostics";
import type { ProjectDraft } from "../types/project";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface NewProjectModalProps {
  ffprobeAvailable: boolean;
  onClose: () => void;
  onCreate: (project: ProjectDraft, probeMs: number) => void;
  onError: (message: string) => void;
  onLog: (message: string, level?: LogLevel) => void;
  open: boolean;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "No se pudo analizar el archivo seleccionado.";
}

export function NewProjectModal({ ffprobeAvailable, onClose, onCreate, onError, onLog, open }: NewProjectModalProps) {
  const [name, setName] = useState("");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [fileError, setFileError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const reset = () => {
    setName("");
    setProbe(null);
    setFileError("");
    setIsAnalyzing(false);
  };

  const closeAndReset = () => {
    reset();
    onClose();
  };

  const selectAndAnalyze = async () => {
    setFileError("");
    try {
      const path = await selectVideoPath();
      if (!path) return;
      const fileName = path.split(/[\\/]/).pop() ?? "video";
      onLog(`Archivo seleccionado: ${fileName}.`);
      onLog("Lectura de metadata iniciada.");
      setIsAnalyzing(true);
      setProbe(null);
      const result = await probeVideo(path);
      setProbe(result);
      if (!name.trim()) setName(result.metadata.fileName.replace(/\.[^/.]+$/, ""));
      onLog(`Metadata completada en ${(result.elapsedMs / 1_000).toFixed(2)} s.`);
      if (!result.metadata.audio.present) onLog("El archivo no contiene pista de audio.", "warning");
    } catch (error) {
      const message = errorMessage(error);
      setFileError(message);
      onError(message);
      onLog(message, "error");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !probe) return;
    const { metadata } = probe;
    onCreate({
      name: name.trim(),
      metadata,
      source: {
        fileName: metadata.fileName,
        lastModifiedMs: metadata.lastModifiedMs,
        path: metadata.path,
        sizeBytes: metadata.sizeBytes,
      },
    }, probe.elapsedMs);
    closeAndReset();
  };

  const metadata = probe?.metadata;

  return (
    <Modal description="Selecciona una referencia local y valida su metadata técnica sin copiar el video." onClose={closeAndReset} open={open} size="large" title="Nuevo proyecto">
      <form className="space-y-6 p-6" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="project-name">Nombre del proyecto</label>
          <input autoFocus className="h-12 w-full rounded-md border border-line bg-canvas px-4 text-sm text-ink outline-none transition duration-150 placeholder:text-muted/60 focus:border-primary focus:ring-2 focus:ring-primary/25" id="project-name" maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Mi nuevo proyecto" type="text" value={name} />
        </div>

        <div>
          <span className="mb-2 block text-sm font-semibold text-ink">Video fuente</span>
          {isAnalyzing ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-cyan/35 bg-cyan/5 text-center">
              <LoaderCircle aria-hidden="true" className="animate-spin text-cyan" size={32} />
              <p className="mt-4 text-sm font-bold uppercase tracking-[0.14em] text-ink">Analizando archivo…</p>
              <p className="mt-2 text-xs text-muted">FFprobe está leyendo únicamente la metadata técnica.</p>
            </div>
          ) : metadata ? (
            <div className="rounded-xl border border-success/30 bg-success/5 p-5">
              <div className="flex items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-cyan/25 bg-primary/10 text-cyan"><FileVideo aria-hidden="true" size={21} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><p className="truncate text-sm font-bold text-ink">{metadata.fileName}</p><CheckCircle2 aria-hidden="true" className="shrink-0 text-success" size={16} /></div>
                  <p className="mt-1 truncate text-xs text-muted" title={metadata.path}>{metadata.path}</p>
                </div>
                <Button icon={<RefreshCw aria-hidden="true" size={14} />} onClick={() => void selectAndAnalyze()} variant="secondary">Cambiar</Button>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-success/20 pt-4 sm:grid-cols-4">
                <MetadataValue label="Resolución" value={metadata.video.displayWidth && metadata.video.displayHeight ? `${metadata.video.displayWidth} × ${metadata.video.displayHeight}` : "No disponible"} />
                <MetadataValue label="FPS" value={formatFps(metadata.video.fpsDecimal)} />
                <MetadataValue label="Duración" value={formatDuration(metadata.durationSeconds)} />
                <MetadataValue label="Tamaño" value={formatFileSize(metadata.sizeBytes)} />
                <MetadataValue label="Video" value={formatCodec(metadata.video.codec)} />
                <MetadataValue label="Audio" value={metadata.audio.present ? formatCodec(metadata.audio.codec) : "Sin pista"} />
                <MetadataValue label="Formato" value={metadata.video.aspectRatio ?? "No disponible"} />
                <MetadataValue label="Canales" value={metadata.audio.present ? formatChannels(metadata.audio.channels, metadata.audio.channelLayout) : "—"} />
              </div>
              <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-success"><CheckCircle2 aria-hidden="true" size={15} /> Archivo válido · {metadata.streams.total} streams</p>
            </div>
          ) : (
            <button className="flex min-h-56 w-full flex-col items-center justify-center rounded-xl border border-dashed border-line-bright bg-canvas/60 px-6 py-8 text-center transition hover:border-primary/70 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan" onClick={() => void selectAndAnalyze()} type="button">
              <span className="grid h-14 w-14 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-cyan"><FolderOpen aria-hidden="true" size={24} /></span>
              <p className="mt-4 text-base font-bold text-ink">Seleccionar video local</p>
              <p className="mt-2 max-w-sm text-xs leading-5 text-muted">Se abrirá el selector nativo. La aplicación conservará la ruta, no el contenido del archivo.</p>
              <span className="mt-4 rounded-md border border-primary/60 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-cyan">Abrir selector nativo</span>
              <p className="mt-4 text-[11px] font-semibold tracking-[0.08em] text-muted">MP4 · MOV · MKV · AVI</p>
            </button>
          )}

          {fileError ? <p className="mt-2 flex items-start gap-2 text-sm font-medium text-danger" role="alert"><Info aria-hidden="true" className="mt-0.5 shrink-0" size={15} />{fileError}</p> : null}
          {!ffprobeAvailable && !fileError ? <p className="mt-2 text-xs text-warning">FFprobe no está disponible; la selección puede abrirse, pero el análisis no podrá completarse.</p> : null}
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-line bg-card/60 p-3.5"><Info aria-hidden="true" className="mt-0.5 shrink-0 text-cyan" size={16} /><p className="text-xs leading-5 text-muted">El archivo original no se carga en memoria, modifica, copia, mueve ni sube a internet.</p></div>

        <div className="flex justify-end gap-3 border-t border-line pt-5">
          <Button onClick={closeAndReset} variant="secondary">Cancelar</Button>
          <Button disabled={!name.trim() || !probe || isAnalyzing} type="submit">Crear proyecto</Button>
        </div>
      </form>
    </Modal>
  );
}

function MetadataValue({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted/70">{label}</p><p className="mt-1 truncate text-sm font-semibold text-ink" title={value}>{value}</p></div>;
}
