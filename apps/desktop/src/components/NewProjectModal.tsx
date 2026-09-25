import {
  CheckCircle2,
  FileVideo,
  FolderOpen,
  Info,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import {
  useState,
  type FormEvent,
} from "react";
import { formatFileSize } from "../lib/format";
import {
  formatChannels,
  formatCodec,
  formatDuration,
  formatFps,
} from "../media/format";
import type { ProbeResult } from "../media/models";
import {
  probeVideo,
  selectVideoPath,
} from "../media/service";
import type { LogLevel } from "../types/diagnostics";
import type { ProjectDraft } from "../types/project";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface NewProjectModalProps {
  ffprobeAvailable: boolean;
  onClose: () => void;
  onCreate: (
    project: ProjectDraft,
    probeMs: number,
  ) => Promise<void>;
  onError: (message: string) => void;
  onLog: (
    message: string,
    level?: LogLevel,
  ) => void;
  open: boolean;
}

function errorMessage(
  error: unknown,
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "No se pudo analizar el archivo seleccionado.";
}

export function NewProjectModal({
  ffprobeAvailable,
  onClose,
  onCreate,
  onError,
  onLog,
  open,
}: NewProjectModalProps) {
  const [name, setName] = useState("");
  const [probe, setProbe] =
    useState<ProbeResult | null>(null);
  const [fileError, setFileError] =
    useState("");
  const [isAnalyzing, setIsAnalyzing] =
    useState(false);
  const [isCreating, setIsCreating] =
    useState(false);

  const reset = () => {
    setName("");
    setProbe(null);
    setFileError("");
    setIsAnalyzing(false);
    setIsCreating(false);
  };

  const closeAndReset = () => {
    reset();
    onClose();
  };

  const selectAndAnalyze = async () => {
    setFileError("");

    try {
      const path =
        await selectVideoPath();

      if (!path) return;

      const fileName =
        path.split(/[\\/]/).pop() ??
        "video";

      onLog(
        `Archivo seleccionado: ${fileName}.`,
      );
      onLog(
        "Lectura de metadata iniciada.",
      );

      setIsAnalyzing(true);
      setProbe(null);

      const result =
        await probeVideo(path);

      setProbe(result);

      if (!name.trim()) {
        setName(
          result.metadata.fileName.replace(
            /\.[^/.]+$/,
            "",
          ),
        );
      }

      onLog(
        `Metadata completada en ${(
          result.elapsedMs / 1_000
        ).toFixed(2)} s.`,
      );

      if (
        !result.metadata.audio.present
      ) {
        onLog(
          "El archivo no contiene pista de audio.",
          "warning",
        );
      }
    } catch (error) {
      const message =
        errorMessage(error);

      setFileError(message);
      onError(message);
      onLog(message, "error");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (!name.trim() || !probe) {
      return;
    }

    const { metadata } = probe;

    setIsCreating(true);
    setFileError("");

    try {
      await onCreate(
        {
          name: name.trim(),
          metadata,
          source: {
            fileName:
              metadata.fileName,
            lastModifiedMs:
              metadata.lastModifiedMs,
            path: metadata.path,
            sizeBytes:
              metadata.sizeBytes,
          },
        },
        probe.elapsedMs,
      );

      closeAndReset();
    } catch (error) {
      setFileError(
        errorMessage(error),
      );
    } finally {
      setIsCreating(false);
    }
  };

  const metadata = probe?.metadata;

  return (
    <Modal
      description="Selecciona un video local. CHETO analizará únicamente su metadata técnica."
      onClose={closeAndReset}
      open={open}
      size="large"
      title="Nuevo proyecto"
    >
      <form
        className="space-y-4 p-4"
        onSubmit={(event) =>
          void handleSubmit(event)
        }
      >
        <div>
          <label
            className="mb-2 block text-[10px] font-medium text-muted/70"
            htmlFor="project-name"
          >
            Nombre del proyecto
          </label>

          <input
            autoFocus
            className="cheto-input"
            id="project-name"
            maxLength={80}
            onChange={(event) =>
              setName(
                event.target.value,
              )
            }
            placeholder="Mi nuevo proyecto"
            type="text"
            value={name}
          />
        </div>

        <div>
          <span className="mb-2 block text-[10px] font-medium text-muted/70">
            Video fuente
          </span>

          {isAnalyzing ? (
            <div className="flex min-h-[160px] flex-col items-center justify-center rounded-lg bg-cyan/[0.025] text-center ring-1 ring-cyan/15">
              <LoaderCircle
                className="animate-spin text-cyan"
                size={25}
              />

              <p className="mt-4 text-[11px] font-semibold text-ink">
                Analizando archivo…
              </p>

              <p className="mt-1.5 text-[9px] text-muted/45">
                FFprobe está leyendo la
                información técnica.
              </p>
            </div>
          ) : metadata ? (
            <div className="overflow-hidden rounded-lg bg-success/[0.025] ring-1 ring-success/15">
              <div className="flex items-start gap-3 border-b border-white/[0.05] p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-success/[0.07] text-success">
                  <FileVideo
                    size={16}
                  />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[11px] font-semibold text-ink">
                      {
                        metadata.fileName
                      }
                    </p>

                    <CheckCircle2
                      className="shrink-0 text-success"
                      size={14}
                    />
                  </div>

                  <p
                    className="mt-1 truncate text-[9px] text-muted/40"
                    title={
                      metadata.path
                    }
                  >
                    {metadata.path}
                  </p>
                </div>

                <Button
                  icon={
                    <RefreshCw
                      size={13}
                    />
                  }
                  onClick={() =>
                    void selectAndAnalyze()
                  }
                  variant="secondary"
                >
                  Cambiar
                </Button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4">
                <MetadataValue
                  label="Resolución"
                  value={
                    metadata.video
                      .displayWidth &&
                    metadata.video
                      .displayHeight
                      ? `${metadata.video.displayWidth} × ${metadata.video.displayHeight}`
                      : "No disponible"
                  }
                />

                <MetadataValue
                  label="FPS"
                  value={formatFps(
                    metadata.video
                      .fpsDecimal,
                  )}
                />

                <MetadataValue
                  label="Duración"
                  value={formatDuration(
                    metadata.durationSeconds,
                  )}
                />

                <MetadataValue
                  label="Tamaño"
                  value={formatFileSize(
                    metadata.sizeBytes,
                  )}
                />

                <MetadataValue
                  label="Video"
                  value={formatCodec(
                    metadata.video.codec,
                  )}
                />

                <MetadataValue
                  label="Audio"
                  value={
                    metadata.audio.present
                      ? formatCodec(
                          metadata.audio
                            .codec,
                        )
                      : "Sin pista"
                  }
                />

                <MetadataValue
                  label="Formato"
                  value={
                    metadata.video
                      .aspectRatio ??
                    "No disponible"
                  }
                />

                <MetadataValue
                  label="Canales"
                  value={
                    metadata.audio.present
                      ? formatChannels(
                          metadata.audio
                            .channels,
                          metadata.audio
                            .channelLayout,
                        )
                      : "—"
                  }
                />
              </div>

              <div className="flex items-center gap-2 border-t border-white/[0.05] px-4 py-3 text-[9px] text-success">
                <CheckCircle2
                  size={13}
                />

                Archivo válido ·{" "}
                {metadata.streams.total}{" "}
                streams
              </div>
            </div>
          ) : (
            <button
              className="group flex min-h-[170px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.09] bg-white/[0.012] px-6 py-7 text-center transition-colors hover:border-cyan/25 hover:bg-cyan/[0.025]"
              onClick={() =>
                void selectAndAnalyze()
              }
              type="button"
            >
              <span className="grid h-11 w-11 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-muted transition group-hover:text-cyan">
                <FolderOpen
                  size={18}
                />
              </span>

              <p className="mt-3.5 text-[12px] font-semibold text-ink">
                Seleccionar video
              </p>

              <p className="mt-2 max-w-sm text-[9px] leading-5 text-muted/45">
                El archivo original no será
                copiado ni modificado.
              </p>

              <span className="mt-3 inline-flex min-h-8 items-center rounded-md bg-white/[0.035] px-3 text-[9px] font-medium text-muted/75 ring-1 ring-white/[0.07]">
                Abrir selector nativo
              </span>

              <p className="mt-4 text-[8px] uppercase tracking-[0.1em] text-muted/30">
                MP4 · MOV · MKV · AVI
              </p>
            </button>
          )}

          {fileError ? (
            <p
              className="mt-2 flex items-start gap-2 text-[10px] text-danger"
              role="alert"
            >
              <Info
                className="mt-0.5 shrink-0"
                size={13}
              />

              {fileError}
            </p>
          ) : null}

          {!ffprobeAvailable &&
          !fileError ? (
            <p className="mt-2 text-[9px] text-warning">
              FFprobe no está disponible.
              El análisis no podrá
              completarse.
            </p>
          ) : null}
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-white/[0.018] p-3 ring-1 ring-white/[0.045]">
          <Info
            className="mt-0.5 shrink-0 text-cyan/65"
            size={13}
          />

          <p className="text-[9px] leading-5 text-muted/45">
            CHETO conserva la referencia
            local al archivo. El video no
            se sube a internet.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/[0.06] pt-4">
          <Button
            onClick={closeAndReset}
            variant="secondary"
          >
            Cancelar
          </Button>

          <Button
            disabled={
              !name.trim() ||
              !probe ||
              isAnalyzing ||
              isCreating
            }
            type="submit"
          >
            {isCreating
              ? "Creando…"
              : "Crear proyecto"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MetadataValue({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 border-b border-r border-white/[0.04] p-3">
      <p className="text-[8px] font-medium uppercase tracking-[0.08em] text-muted/35">
        {label}
      </p>

      <p
        className="mt-1 truncate text-[10px] font-medium text-ink/80"
        title={value}
      >
        {value}
      </p>
    </div>
  );
}
