import { save } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  FolderOpen,
  Info,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
    `${bundle.project.name.replace(
      /[^\w-]+/g,
      "_",
    )}_editado`,
  );

  const [path, setPath] = useState("");
  const [resolution, setResolution] =
    useState<ExportResolution>(
      "original",
    );
  const [fps, setFps] =
    useState<ExportFps>("original");
  const [bitrate, setBitrate] =
    useState<ExportBitrate>("auto");

  const [audio, setAudio] = useState(
    bundle.source.audio.present,
  );

  const [progress, setProgress] =
    useState<ExportProgress | null>(
      null,
    );

  const [result, setResult] =
    useState<ExportResult | null>(
      null,
    );

  const [error, setError] =
    useState<string | null>(null);

  const [busy, setBusy] =
    useState(false);

  const sourceWidth =
    bundle.source.video.displayWidth ??
    bundle.source.video.width ??
    1920;

  const sourceHeight =
    bundle.source.video.displayHeight ??
    bundle.source.video.height ??
    1080;

  const dimensions = useMemo(
    () =>
      exportDimensions(
        resolution,
        sourceWidth,
        sourceHeight,
        aspectRatio,
      ),
    [
      aspectRatio,
      resolution,
      sourceHeight,
      sourceWidth,
    ],
  );

  const effectiveFps =
    fps === "original"
      ? bundle.source.video.fps
          .decimal ?? 30
      : Number(fps);

  const durationUs = editedDurationUs(
    bundle.source.durationUs ?? 0,
    edl.tracks.cuts,
  );

  const estimate =
    estimatedSizeBytes(
      durationUs,
      bitrate,
      audio,
    );

  useEffect(() => {
    if (!open) return;

    let cleanup:
      | (() => void)
      | undefined;

    void onExportProgress(
      (value) => {
        if (
          value.projectId ===
          bundle.project.projectId
        ) {
          setProgress(value);
        }
      },
    ).then(
      (value) =>
        (cleanup = value),
    );

    return () => cleanup?.();
  }, [
    bundle.project.projectId,
    open,
  ]);

  const browse = async () => {
    const selected = await save({
      defaultPath:
        path || `${name}.mp4`,
      filters: [
        {
          name: "Video MP4",
          extensions: ["mp4"],
        },
      ],
    });

    if (selected) {
      setPath(
        selected
          .toLowerCase()
          .endsWith(".mp4")
          ? selected
          : `${selected}.mp4`,
      );
    }
  };

  const run = async () => {
    const config = {
      aspectRatio,
      bitrate,
      fps: effectiveFps,
      height: dimensions.height,
      includeAudio: audio,
      outputPath: path,
      projectId:
        bundle.project.projectId,
      width: dimensions.width,
    };

    const issue =
      validateExportConfig(config);

    if (issue) {
      setError(issue);
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      setResult(
        await startExport(config),
      );
    } catch (reason) {
      setError(
        exportErrorMessage(reason),
      );
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
      <div className="p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre">
            <input
              className="cheto-input"
              onChange={(event) =>
                setName(
                  event.target.value,
                )
              }
              value={name}
            />
          </Field>

          <Field label="Guardar en">
            <div className="flex gap-2">
              <input
                className="cheto-input min-w-0 flex-1"
                onChange={(event) =>
                  setPath(
                    event.target.value,
                  )
                }
                placeholder="Selecciona una ruta MP4"
                value={path}
              />

              <Button
                icon={
                  <FolderOpen
                    size={13}
                  />
                }
                onClick={() =>
                  void browse()
                }
                variant="secondary"
              >
                Examinar
              </Button>
            </div>
          </Field>

          <Field label="Resolución">
            <select
              className="cheto-input"
              onChange={(event) =>
                setResolution(
                  event.target
                    .value as ExportResolution,
                )
              }
              value={resolution}
            >
              <option value="original">
                Igual al original
              </option>
              <option value="720">
                720p
              </option>
              <option value="1080">
                1080p
              </option>
              <option value="1440">
                1440p
              </option>
              <option value="2160">
                2160p / 4K
              </option>
            </select>

            <small>
              {dimensions.width} ×{" "}
              {dimensions.height}
              {Number(resolution) >
              sourceHeight
                ? " · Escalado, no aumenta la calidad real"
                : ""}
            </small>
          </Field>

          <Field label="FPS">
            <select
              className="cheto-input"
              onChange={(event) =>
                setFps(
                  event.target
                    .value as ExportFps,
                )
              }
              value={fps}
            >
              <option value="original">
                Igual al original
              </option>

              {[24, 25, 30, 50, 60].map(
                (value) => (
                  <option
                    key={value}
                    value={value}
                  >
                    {value} FPS
                  </option>
                ),
              )}
            </select>
          </Field>

          <Field label="Bitrate">
            <select
              className="cheto-input"
              onChange={(event) =>
                setBitrate(
                  event.target
                    .value as ExportBitrate,
                )
              }
              value={bitrate}
            >
              <option value="auto">
                Automático / recomendado
              </option>
              <option value="low">
                Bajo
              </option>
              <option value="medium">
                Medio
              </option>
              <option value="high">
                Alto
              </option>
            </select>
          </Field>

          <Field label="Audio">
            <label className="flex min-h-9 items-center gap-2 rounded-md border border-white/[0.08] bg-[#070c13] px-3 text-[10px] font-medium normal-case text-ink/75">
              <input
                checked={audio}
                disabled={
                  !bundle.source.audio
                    .present
                }
                onChange={(event) =>
                  setAudio(
                    event.target.checked,
                  )
                }
                type="checkbox"
              />

              Incluir audio AAC
            </label>
          </Field>
        </div>

        <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-lg bg-white/[0.015] ring-1 ring-white/[0.05]">
          <Summary
            label="Duración final"
            value={formatTimecode(
              durationUs,
            )}
          />

          <Summary
            label="Tamaño aproximado"
            value={formatFileSize(
              estimate,
            )}
          />

          <Summary
            label="Codec"
            value="H.264"
          />

          <Summary
            label="Contenedor"
            value="MP4"
          />
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-lg bg-white/[0.015] p-3 ring-1 ring-white/[0.045]">
          <Info
            className="mt-0.5 shrink-0 text-cyan/60"
            size={13}
          />

          <p className="text-[9px] leading-5 text-muted/45">
            Se utilizará NVENC cuando
            esté disponible. En caso
            contrario CHETO utilizará
            CPU/libx264.
          </p>
        </div>

        {progress ? (
          <div className="mt-4 rounded-lg bg-[#070c13] p-3 ring-1 ring-white/[0.055]">
            <div className="flex justify-between text-[9px] text-muted/55">
              <span>
                {progress.stage ===
                "preparing"
                  ? "Preparando"
                  : progress.stage ===
                      "completed"
                    ? "Completado"
                    : "Renderizando"}
              </span>

              <span className="font-mono">
                {Math.floor(
                  progress.progress,
                )}
                %
              </span>
            </div>

            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.05]">
              <div
                className="h-full rounded-full bg-cyan transition-[width]"
                style={{
                  width: `${progress.progress}%`,
                }}
              />
            </div>

            <p className="mt-2 font-mono text-[8px] text-muted/40">
              {formatTimecode(
                progress.processedUs,
              )}{" "}
              /{" "}
              {formatTimecode(
                progress.durationUs,
              )}
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-lg bg-danger/[0.05] p-3 text-[10px] text-danger ring-1 ring-danger/15">
            {error}
          </div>
        ) : null}

        {result ? (
          <div className="mt-4 rounded-lg bg-success/[0.04] p-4 ring-1 ring-success/15">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2
                size={14}
              />

              <strong className="text-[10px] font-semibold">
                Exportación completada
              </strong>
            </div>

            <p className="mt-2 break-all font-mono text-[9px] text-ink/65">
              {result.outputPath}
            </p>

            <p className="mt-1 text-[8px] text-muted/40">
              {result.encoder} ·{" "}
              {formatFileSize(
                result.fileSizeBytes,
              )}
            </p>

            <div className="mt-3 flex gap-2">
              <Button
                onClick={() =>
                  void openExportFile(
                    result.outputPath,
                  )
                }
                variant="secondary"
              >
                Abrir archivo
              </Button>

              <Button
                onClick={() =>
                  void revealExportFile(
                    result.outputPath,
                  )
                }
                variant="secondary"
              >
                Mostrar carpeta
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2 border-t border-white/[0.06] pt-3.5">
          {!busy ? (
            <Button
              onClick={onClose}
              variant="secondary"
            >
              Cerrar
            </Button>
          ) : null}

          {busy ? (
            <Button
              onClick={() =>
                void cancelExport(
                  bundle.project
                    .projectId,
                )
              }
              variant="danger"
            >
              Cancelar render
            </Button>
          ) : (
            <Button
              disabled={!path}
              onClick={() =>
                void run()
              }
            >
              Exportar video
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
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="export-field">
      <span>{label}</span>
      {children}
    </div>
  );
}

function Summary({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 border-b border-r border-white/[0.05] p-3">
      <p className="text-[8px] uppercase tracking-[0.08em] text-muted/35">
        {label}
      </p>

      <p className="mt-1 truncate font-mono text-[10px] font-medium text-ink/80">
        {value}
      </p>
    </div>
  );
}
