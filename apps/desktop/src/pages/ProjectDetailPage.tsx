import { AlertTriangle, ArrowLeft, Clock3, Database, FileJson2, FileSearch, FileVideo, HardDrive, Layers3, Trash2, Volume2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { MediaWorkspace } from "../components/media/MediaWorkspace";
import { StatusBadge } from "../components/StatusBadge";
import { formatFileSize } from "../lib/format";
import { formatBitrate, formatChannels, formatCodec, formatDuration, formatFps, formatSampleRate } from "../media/format";
import { countEdlTracks } from "../project/conversion";
import type { ProjectBundle } from "../project/contracts";
import type { LocalProject } from "../types/project";
import type { LogLevel } from "../types/diagnostics";
import type { ToastTone } from "../types/toast";

interface ProjectDetailPageProps {
  isRelocating: boolean;
  onBack: () => void;
  onDelete: (project: LocalProject) => void;
  onRelocate: (project: LocalProject) => void;
  onLog: (message: string, level?: LogLevel) => void;
  onNotify: (message: string, tone?: ToastTone) => void;
  project: LocalProject;
  projectBundle: ProjectBundle | null;
  storageError: string | null;
  storageLoading: boolean;
}

export function ProjectDetailPage({ isRelocating, onBack, onDelete, onLog, onNotify, onRelocate, project, projectBundle, storageError, storageLoading }: ProjectDetailPageProps) {
  const metadata = project.metadata;
  const sourceUnavailable = project.status === "source-missing" || project.status === "legacy";
  const trackCounts = countEdlTracks(projectBundle);

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

      {projectBundle && project.status === "ready" ? <MediaWorkspace bundle={projectBundle} onLog={onLog} onNotify={onNotify} /> : null}

      <Card className="surface-shine p-6">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-cyan"><FileVideo aria-hidden="true" size={21} /></span>
          <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Fuente</p><h3 className="mt-1 truncate font-bold text-ink">{project.source.fileName}</h3><p className="mt-1 break-all text-xs text-muted">{project.source.path ?? "Ruta original no disponible (proyecto migrado desde v1)"}</p></div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-cyan"><Database aria-hidden="true" size={18} /></span>
            <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan">Datos del proyecto</p><h3 className="mt-1 font-bold text-ink">{storageLoading ? "Preparando almacenamiento…" : projectBundle ? "Proyecto local preparado" : storageError ? "Error de almacenamiento" : "Manifest pendiente"}</h3></div>
          </div>
          {projectBundle ? <StatusBadge label="Schemas válidos" tone="success" /> : <StatusBadge label={storageError ? "Revisar diagnóstico" : "Pendiente"} tone="warning" />}
        </div>
        {storageError ? <p className="mt-4 flex items-start gap-2 text-sm text-danger"><AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />{storageError}</p> : null}
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <ManifestFile label="Manifest" name="project.json" ready={Boolean(projectBundle)} />
          <ManifestFile label="Fuente" name="source.json" ready={Boolean(projectBundle)} />
          <ManifestFile label="EDL" name="edl.json" ready={Boolean(projectBundle)} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-4">
          <Detail label="Cortes" value={String(trackCounts.cuts)} />
          <Detail label="Cámara" value={String(trackCounts.camera)} />
          <Detail label="Subtítulos" value={String(trackCounts.captions)} />
          <Detail label="B-roll" value={String(trackCounts.broll)} />
        </div>
        <p className="mt-5 text-xs text-muted">Schema: Project v{projectBundle?.project.schemaVersion ?? 1} · Source v{projectBundle?.source.schemaVersion ?? 1} · EDL v{projectBundle?.edl.schemaVersion ?? 1} · Tiempo en microsegundos</p>
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

function ManifestFile({ label, name, ready }: { label: string; name: string; ready: boolean }) {
  return <div className="flex items-center gap-3 rounded-lg border border-line bg-canvas/55 p-3"><FileJson2 aria-hidden="true" className={ready ? "text-success" : "text-muted"} size={17} /><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted/70">{label}</p><p className="mt-0.5 font-mono text-xs font-semibold text-ink">{name}</p></div></div>;
}
