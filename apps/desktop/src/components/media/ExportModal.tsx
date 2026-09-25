import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import type { ProjectBundle } from "../../project/contracts";
import { formatFileSize } from "../../lib/format";
import { formatTimecode } from "../../editor/timecode";
import {
  estimatedSizeBytes,
  exportDimensions,
  validateExportConfig,
  type ExportBitrate,
  type ExportFps,
  type ExportProgress,
  type ExportResolution,
  type ExportResult,
} from "../../export/models";
import {
  cancelExport,
  exportErrorMessage,
  onExportProgress,
  openExportFile,
  revealExportFile,
  startExport,
} from "../../export/service";
import { editedDurationUs } from "../../editor/edl";
import { Button } from "../Button";
import { Modal } from "../Modal";
interface Props {
  aspectRatio: number;
  bundle: ProjectBundle;
  edl: ProjectBundle["edl"];
  onClose: () => void;
  open: boolean;
}
export function ExportModal({
  aspectRatio,
  bundle,
  edl,
  onClose,
  open,
}: Props) {
  const [name, setName] = useState(
    `${bundle.project.name.replace(/[^\w-]+/g, "_")}_editado`,
  );
  const [path, setPath] = useState("");
  const [resolution, setResolution] = useState<ExportResolution>("original");
  const [fps, setFps] = useState<ExportFps>("original");
  const [bitrate, setBitrate] = useState<ExportBitrate>("auto");
  const [audio, setAudio] = useState(bundle.source.audio.present);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sourceWidth =
    bundle.source.video.displayWidth ?? bundle.source.video.width ?? 1920;
  const sourceHeight =
    bundle.source.video.displayHeight ?? bundle.source.video.height ?? 1080;
  const dimensions = useMemo(
    () => exportDimensions(resolution, sourceWidth, sourceHeight, aspectRatio),
    [aspectRatio, resolution, sourceHeight, sourceWidth],
  );
  const effectiveFps =
    fps === "original" ? (bundle.source.video.fps.decimal ?? 30) : Number(fps);
  const durationUs = editedDurationUs(
    bundle.source.durationUs ?? 0,
    edl.tracks.cuts,
  );
  const estimate = estimatedSizeBytes(durationUs, bitrate, audio);
  useEffect(() => {
    if (!open) return;
    let cleanup: (() => void) | undefined;
    void onExportProgress((value) => {
      if (value.projectId === bundle.project.projectId) setProgress(value);
    }).then((value) => (cleanup = value));
    return () => cleanup?.();
  }, [bundle.project.projectId, open]);
  const browse = async () => {
    const selected = await save({
      defaultPath: path || `${name}.mp4`,
      filters: [{ name: "Video MP4", extensions: ["mp4"] }],
    });
    if (selected)
      setPath(
        selected.toLowerCase().endsWith(".mp4") ? selected : `${selected}.mp4`,
      );
  };
  const run = async () => {
    const config = {
      aspectRatio,
      bitrate,
      fps: effectiveFps,
      height: dimensions.height,
      includeAudio: audio,
      outputPath: path,
      projectId: bundle.project.projectId,
      width: dimensions.width,
    };
    const issue = validateExportConfig(config);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await startExport(config));
    } catch (reason) {
      setError(exportErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      description="Render local no destructivo mediante FFmpeg."
      onClose={() => {
        if (!busy) onClose();
      }}
      open={open}
      size="large"
      title="Exportar video"
    >
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <Field label="Nombre">
          <input onChange={(e) => setName(e.target.value)} value={name} />
        </Field>
        <Field label="Guardar en">
          <div className="flex gap-1">
            <input
              className="flex-1"
              onChange={(e) => setPath(e.target.value)}
              placeholder="Selecciona una ruta MP4"
              value={path}
            />
            <Button onClick={() => void browse()} variant="secondary">
              Examinar…
            </Button>
          </div>
        </Field>
        <Field label="Resolución">
          <select
            onChange={(e) => setResolution(e.target.value as ExportResolution)}
            value={resolution}
          >
            <option value="original">Igual al original</option>
            <option value="720">720p</option>
            <option value="1080">1080p</option>
            <option value="1440">1440p</option>
            <option value="2160">2160p / 4K</option>
          </select>
          <small>
            {dimensions.width} × {dimensions.height}
            {Number(resolution) > sourceHeight
              ? " · Escalado, no aumenta calidad real"
              : ""}
          </small>
        </Field>
        <Field label="FPS">
          <select
            onChange={(e) => setFps(e.target.value as ExportFps)}
            value={fps}
          >
            <option value="original">Igual al original</option>
            {[24, 25, 30, 50, 60].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Codec">
          <output>H.264 · NVENC validado o CPU/libx264</output>
        </Field>
        <Field label="Contenedor">
          <output>MP4</output>
        </Field>
        <Field label="Bitrate">
          <select
            onChange={(e) => setBitrate(e.target.value as ExportBitrate)}
            value={bitrate}
          >
            <option value="auto">Automático / recomendado</option>
            <option value="low">Bajo</option>
            <option value="medium">Medio</option>
            <option value="high">Alto</option>
          </select>
        </Field>
        <Field label="Audio">
          <label className="flex items-center gap-2 normal-case">
            <input
                  checked={audio}
                  disabled={!bundle.source.audio.present}
              onChange={(e) => setAudio(e.target.checked)}
              type="checkbox"
            />
            Incluir audio AAC
          </label>
        </Field>
        <div className="sm:col-span-2 grid grid-cols-2 gap-2">
          <Summary
            label="Duración estimada"
            value={formatTimecode(durationUs)}
          />
          <Summary label="Tamaño aproximado" value={formatFileSize(estimate)} />
        </div>
        {progress ? (
          <div className="sm:col-span-2">
            <div className="flex justify-between text-[10px]">
              <span>
                {progress.stage === "preparing"
                  ? "Preparando"
                  : progress.stage === "completed"
                    ? "Completado"
                    : "Renderizando"}
              </span>
              <span>
                {Math.floor(progress.progress)} % ·{" "}
                {formatTimecode(progress.processedUs)} /{" "}
                {formatTimecode(progress.durationUs)}
              </span>
            </div>
            <div className="mt-1 h-2 bg-canvas">
              <div
                className="h-full bg-cyan"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
          </div>
        ) : null}
        {error ? <p className="sm:col-span-2 text-danger">{error}</p> : null}
        {result ? (
          <div className="sm:col-span-2 border border-success/30 bg-success/5 p-3">
            <strong className="text-success">Exportación completada</strong>
            <p className="mt-1 break-all font-mono text-[10px]">
              {result.outputPath}
            </p>
            <p className="text-[9px] text-muted">
              {result.encoder} · {formatFileSize(result.fileSizeBytes)}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                onClick={() => void openExportFile(result.outputPath)}
                variant="secondary"
              >
                Abrir archivo
              </Button>
              <Button
                onClick={() => void revealExportFile(result.outputPath)}
                variant="secondary"
              >
                Abrir carpeta
              </Button>
            </div>
          </div>
        ) : null}
        <div className="sm:col-span-2 flex justify-end gap-2">
          {busy ? (
            <Button
              onClick={() => void cancelExport(bundle.project.projectId)}
              variant="danger"
            >
              Cancelar
            </Button>
          ) : (
            <Button disabled={!path} onClick={() => void run()}>
              Exportar
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="export-field text-[9px] font-bold uppercase text-muted">
      {label}
      {children}
    </label>
  );
}
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line bg-canvas/50 p-2">
      <span className="text-[8px] uppercase text-muted">{label}</span>
      <strong className="ml-2 font-mono text-ink">{value}</strong>
    </div>
  );
}
