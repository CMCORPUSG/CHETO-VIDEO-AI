import { AlertTriangle, ArrowLeft, Clock3, FileSearch, FileVideo, HardDrive, Layers3, Trash2, Volume2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { formatFileSize } from "../lib/format";
import { formatBitrate, formatChannels, formatCodec, formatDuration, formatFps, formatSampleRate } from "../media/format";
import type { LocalProject } from "../types/project";

interface ProjectDetailPageProps {
  isRelocating: boolean;
  onBack: () => void;
  onDelete: (project: LocalProject) => void;
  onRelocate: (project: LocalProject) => void;
  project: LocalProject;
}

export function ProjectDetailPage({ isRelocating, onBack, onDelete, onRelocate, project }: ProjectDetailPageProps) {
  const metadata = project.metadata;
  const sourceUnavailable = project.status === "source-missing" || project.status === "legacy";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button className="mb-4 flex items-center gap-2 text-xs font-semibold text-muted transition hover:text-cyan" onClick={onBack} type="button"><ArrowLeft aria-hidden="true" size={15} /> Volver a proyectos</button>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan">Detalle del proyecto</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink">{project.name}</h2>
        </div>
        <StatusBadge label={project.status === "ready" ? "Fuente verificada" : project.status === "source-changed" ? "Archivo modificado" : "Requiere atención"} tone={project.status === "ready" ? "success" : "warning"} />
      </div>

      {sourceUnavailable || project.status === "source-changed" ? (
        <Card className="border-warning/35 bg-warning/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-warning" size={20} />
              <div><h3 className="font-bold text-ink">{project.status === "source-changed" ? "El archivo fuente podría haber cambiado" : "Archivo fuente no encontrado"}</h3><p className="mt-1 text-sm text-muted">Localiza el video para volver a validar y guardar su metadata.</p></div>
            </div>
            <div className="flex gap-2">
              <Button disabled={isRelocating} icon={<FileSearch aria-hidden="true" size={16} />} onClick={() => onRelocate(project)}>{isRelocating ? "Analizando…" : "Localizar archivo"}</Button>
              <Button icon={<Trash2 aria-hidden="true" size={16} />} onClick={() => onDelete(project)} variant="secondary">Eliminar referencia</Button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="surface-shine p-6">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-cyan"><FileVideo aria-hidden="true" size={21} /></span>
          <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Fuente</p><h3 className="mt-1 truncate font-bold text-ink">{project.source.fileName}</h3><p className="mt-1 break-all text-xs text-muted">{project.source.path ?? "Ruta original no disponible (proyecto migrado desde v1)"}</p></div>
        </div>
      </Card>

      {metadata ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <MetadataCard icon={<FileVideo aria-hidden="true" size={18} />} title="Video">
            <Detail label="Resolución" value={metadata.video.displayWidth && metadata.video.displayHeight ? `${metadata.video.displayWidth} × ${metadata.video.displayHeight}` : "No disponible"} />
            <Detail label="FPS real" value={formatFps(metadata.video.fpsDecimal)} />
            <Detail label="Codec" value={formatCodec(metadata.video.codec)} />
            <Detail label="Relación" value={metadata.video.aspectRatio ?? "No disponible"} />
            <Detail label="Bitrate" value={formatBitrate(metadata.video.bitrateBps)} />
            <Detail label="Pixel format" value={metadata.video.pixelFormat ?? "No disponible"} />
            <Detail label="Rotación" value={`${metadata.video.rotation}°`} />
          </MetadataCard>
          <MetadataCard icon={<Volume2 aria-hidden="true" size={18} />} title="Audio">
            {metadata.audio.present ? <>
              <Detail label="Codec" value={formatCodec(metadata.audio.codec)} />
              <Detail label="Sample rate" value={formatSampleRate(metadata.audio.sampleRateHz)} />
              <Detail label="Canales" value={formatChannels(metadata.audio.channels, metadata.audio.channelLayout)} />
              <Detail label="Bitrate" value={formatBitrate(metadata.audio.bitrateBps)} />
            </> : <p className="col-span-2 text-sm font-semibold text-muted">Sin pista de audio</p>}
          </MetadataCard>
          <MetadataCard icon={<Clock3 aria-hidden="true" size={18} />} title="Archivo">
            <Detail label="Duración" value={formatDuration(metadata.durationSeconds)} />
            <Detail label="Tamaño" value={formatFileSize(metadata.sizeBytes)} />
            <Detail label="Contenedor" value={metadata.container.displayName} />
            <Detail label="Formato técnico" value={metadata.container.rawName ?? "No disponible"} />
          </MetadataCard>
          <MetadataCard icon={<Layers3 aria-hidden="true" size={18} />} title="Streams">
            <Detail label="Total" value={String(metadata.streams.total)} />
            <Detail label="Video" value={String(metadata.streams.video)} />
            <Detail label="Audio" value={String(metadata.streams.audio)} />
            <Detail label="Subtítulos" value={String(metadata.streams.subtitle)} />
            <Detail label="Datos" value={String(metadata.streams.data)} />
            <Detail label="Otros" value={String(metadata.streams.other)} />
          </MetadataCard>
        </div>
      ) : (
        <Card className="p-8 text-center"><HardDrive aria-hidden="true" className="mx-auto text-muted" size={28} /><h3 className="mt-3 font-bold text-ink">Metadata no disponible</h3><p className="mt-2 text-sm text-muted">Este proyecto v1 conserva su referencia, pero necesita que vuelvas a localizar el video.</p></Card>
      )}

      <p className="text-xs text-muted">Abrir ubicación se mantiene pendiente para TASK-002A; no se habilitan URLs ni comandos de shell inseguros.</p>
    </div>
  );
}

function MetadataCard({ children, icon, title }: { children: ReactNode; icon: ReactNode; title: string }) {
  return <Card className="p-5"><div className="flex items-center gap-3 border-b border-line pb-4"><span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-cyan">{icon}</span><h3 className="font-bold text-ink">{title}</h3></div><div className="mt-5 grid grid-cols-2 gap-5">{children}</div></Card>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted/70">{label}</p><p className="mt-1 text-sm font-semibold text-ink">{value}</p></div>;
}
