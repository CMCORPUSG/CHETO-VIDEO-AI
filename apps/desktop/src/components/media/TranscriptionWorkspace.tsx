import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Cpu,
  Download,
  Gauge,
  LoaderCircle,
  MemoryStick,
  Square,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { formatFileSize } from "../../lib/format";
import { formatPlaybackTime } from "../../playback/time";
import type { ProjectBundle } from "../../project/contracts";
import type { LogLevel } from "../../types/diagnostics";
import type { ToastTone } from "../../types/toast";
import type {
  ExecutionProfile,
  HardwareProfile,
  LanguageMode,
  ModelStatus,
  ProcessLogEntry,
  ProcessLogLevel,
  QualityMode,
  RuntimeTranscriptionProfile,
  TranscriptStatus,
  TranscriptionEvent,
  TranscriptionStage,
} from "../../transcription/models";
import {
  cancelTranscription,
  detectHardwareProfile,
  downloadModel,
  getModelStatus,
  getTranscriptStatus,
  onTranscriptionEvent,
  selectTranscriptionProfile,
  startTranscription,
  transcriptionErrorMessage,
} from "../../transcription/service";
import { Button } from "../Button";
import { Card } from "../Card";

export function TranscriptionWorkspace({
  bundle,
  onLog,
  onNotify,
  onSeek,
}: {
  bundle: ProjectBundle;
  onLog: (message: string, level?: LogLevel) => void;
  onNotify: (message: string, tone?: ToastTone) => void;
  onSeek: (timeUs: number) => void;
}) {
  const projectId = bundle.project.projectId;
  const durationUs = bundle.source.durationUs ?? 0;

  const [hardware, setHardware] = useState<HardwareProfile | null>(null);
  const [profile, setProfile] = useState<ExecutionProfile | null>(null);
  const [runtimeProfile, setRuntimeProfile] =
    useState<RuntimeTranscriptionProfile | null>(null);
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [transcript, setTranscript] = useState<TranscriptStatus | null>(null);

  const [quality, setQuality] = useState<QualityMode>("auto");
  const [language, setLanguage] = useState<LanguageMode>("auto");

  const [busy, setBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [stage, setStage] = useState<TranscriptionStage>("idle");
  const [error, setError] = useState<string | null>(null);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [processLog, setProcessLog] = useState<ProcessLogEntry[]>([]);
  const [downloadActive, setDownloadActive] = useState(false);

  const startedAtRef = useRef<number | null>(null);
  const etaRef = useRef<number | null>(null);
  const logBucket = useRef(-1);
  const firstSegmentSeen = useRef(false);

  const appendProcessLog = useCallback(
    (message: string, level: ProcessLogLevel = "info") => {
      const entry: ProcessLogEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timestamp: new Date().toLocaleTimeString("es-PE", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        level,
        message,
      };

      setProcessLog((current) => [...current, entry].slice(-100));
    },
    [],
  );

  const refreshProfile = useCallback(
    async (nextQuality: QualityMode, detected: HardwareProfile) => {
      const selected = await selectTranscriptionProfile(
        detected,
        nextQuality,
      );

      setProfile(selected);

      setRuntimeProfile({
        device: selected.device,
        computeType: selected.computeType,
        model: selected.model,
      });

      setModel(await getModelStatus(selected.model));
      onLog("TRANSCRIPTION_PROFILE_SELECTED");
    },
    [onLog],
  );

  const handleTranscriptionEvent = useCallback(
    (event: TranscriptionEvent) => {
      if (event.projectId !== projectId && event.projectId !== "global") {
        return;
      }

      const eventName = event.event;
      const payload = event.payload;

      if (eventName === "MODEL_DOWNLOAD_STARTED") {
        setDownloadActive(true);
        appendProcessLog(
          `Descargando modelo ${payloadString(payload, "model") ?? "local"}`,
        );
        onLog(eventName);
        return;
      }

      if (eventName === "MODEL_DOWNLOAD_COMPLETED") {
        setDownloadActive(false);
        appendProcessLog(
          `Modelo ${payloadString(payload, "model") ?? "local"} preparado`,
          "success",
        );
        onLog(eventName);
        return;
      }

      if (eventName === "MODEL_DOWNLOAD_FAILED") {
        setDownloadActive(false);
        appendProcessLog("La descarga del modelo falló", "error");
        onLog(eventName, "error");
        return;
      }

      if (eventName === "HARDWARE_PROFILE_DETECTED") {
        setStage("checking_hardware");
        appendProcessLog("Hardware detectado");
        onLog(eventName);
        return;
      }

      if (eventName === "TRANSCRIPTION_PROFILE_SELECTED") {
        appendProcessLog("Perfil de ejecución seleccionado");
        onLog(eventName);
        return;
      }

      if (eventName === "TRANSCRIPTION_STARTED") {
        setStage("preparing_worker");

        const eventProfile = asRecord(payload.profile);

        if (eventProfile) {
          setRuntimeProfile((current) =>
            runtimeProfileFromPayload(eventProfile, current),
          );
        }

        appendProcessLog("Solicitud enviada al worker");
        onLog(eventName);
        return;
      }

      if (eventName === "START") {
        setStage("preparing_worker");
        appendProcessLog("Worker de transcripción iniciado", "success");
        onLog(eventName);
        return;
      }

      if (eventName === "MODEL_LOADING") {
        setStage("loading_model");

        setRuntimeProfile((current) =>
          runtimeProfileFromPayload(payload, current),
        );

        appendProcessLog(
          `Cargando modelo ${payloadString(payload, "model") ?? "local"}`,
        );

        onLog(eventName);
        return;
      }

      if (eventName === "TRANSCRIPTION_MODEL_LOADED") {
        setStage("model_ready");

        setRuntimeProfile((current) =>
          runtimeProfileFromPayload(payload, current),
        );

        appendProcessLog(
          `Modelo ${payloadString(payload, "model") ?? "local"} cargado`,
          "success",
        );

        onLog(eventName);
        return;
      }

      if (eventName === "SEGMENT") {
        const processedUs = payloadNumber(payload, "processedUs");
        const segmentCount = payloadNumber(payload, "segmentCount");
        const wordCount = payloadNumber(payload, "wordCount");

        setStage("transcribing");

        setTranscript((current) => ({
          ...(current ?? emptyTranscript(durationUs)),
          processedUs,
          progress:
            durationUs > 0
              ? Math.min(100, (processedUs / durationUs) * 100)
              : null,
          segmentCount,
          wordCount,
          state: "running",
        }));

        if (!firstSegmentSeen.current) {
          firstSegmentSeen.current = true;
          appendProcessLog("Transcripción de audio en curso", "success");
        }

        updateEta(
          processedUs,
          durationUs,
          startedAtRef.current,
          etaRef,
          setEtaSeconds,
        );

        const bucket = Math.floor(
          (processedUs / Math.max(1, durationUs)) * 4,
        );

        if (bucket > logBucket.current) {
          logBucket.current = bucket;

          const percent = Math.min(
            100,
            Math.max(
              0,
              Math.floor(
                (processedUs / Math.max(1, durationUs)) * 100,
              ),
            ),
          );

          appendProcessLog(
            `${percent} % · ${segmentCount} segmentos · ${wordCount} palabras`,
          );

          onLog("TRANSCRIPTION_PROGRESS");
        }

        return;
      }

      if (eventName === "COMPLETED") {
        setStage("saving");
        appendProcessLog("Guardando resultado de transcripción");
        onLog(eventName);
        return;
      }

      if (eventName === "TRANSCRIPTION_LANGUAGE_DETECTED") {
        const detectedLanguage =
          payloadString(payload, "language") ??
          payloadString(payload, "detectedLanguage");

        appendProcessLog(
          detectedLanguage
            ? `Idioma detectado: ${detectedLanguage}`
            : "Idioma detectado",
        );

        onLog(eventName);
        return;
      }

      if (eventName === "TRANSCRIPTION_COMPLETED") {
        setStage("completed");
        setEtaSeconds(0);
        etaRef.current = 0;

        appendProcessLog("Transcripción completada", "success");
        onLog(eventName);
        return;
      }

      if (
        eventName === "TRANSCRIPTION_GPU_FALLBACK" ||
        eventName === "TRANSCRIPTION_OOM_FALLBACK"
      ) {
        const reason =
          payloadString(payload, "reason") ??
          "Se aplicó un fallback automático.";

        appendProcessLog(`Fallback: ${reason}`, "warning");
        onLog(eventName, "warning");
        return;
      }

      if (
        eventName === "TRANSCRIPTION_CANCELLED" ||
        eventName === "CANCELLED"
      ) {
        setStage("cancelled");

        setTranscript((current) =>
          current
            ? { ...current, state: "cancelled" }
            : current,
        );

        appendProcessLog("Transcripción cancelada", "warning");
        onLog(eventName, "warning");
        return;
      }

      if (
        eventName === "TRANSCRIPTION_FAILED" ||
        eventName === "TRANSCRIPTION_WORKER_READ_ERROR"
      ) {
        const message =
          payloadString(payload, "message") ??
          "La transcripción encontró un error.";

        setStage("error");

        setTranscript((current) =>
          current ? { ...current, state: "error" } : current,
        );

        appendProcessLog(message, "error");
        onLog(eventName, "error");
        return;
      }

      if (eventName === "TRANSCRIPTION_WORKER_OUTPUT_IGNORED") {
        const message =
          payloadString(payload, "message") ??
          "Salida no reconocida del worker";

        appendProcessLog(message, "warning");
        onLog(eventName, "warning");
        return;
      }

      const level: LogLevel = eventName.includes("FAILED")
        ? "error"
        : eventName.includes("FALLBACK") ||
            eventName.includes("STALE")
          ? "warning"
          : "info";

      onLog(eventName, level);
    },
    [appendProcessLog, durationUs, onLog, projectId],
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void onTranscriptionEvent(handleTranscriptionEvent).then((value) => {
      if (disposed) {
        value();
      } else {
        unlisten = value;
      }
    });

    void Promise.all([
      detectHardwareProfile(),
      getTranscriptStatus(projectId),
    ])
      .then(async ([detected, existing]) => {
        if (disposed) return;

        setHardware(detected);
        setTranscript(existing);
        setStage(stageFromTranscript(existing.state));

        onLog("HARDWARE_PROFILE_DETECTED");

        if (existing.state === "stale") {
          onLog("TRANSCRIPTION_STALE", "warning");
        }

        await refreshProfile("auto", detected);
      })
      .catch((reason) => {
        if (!disposed) {
          setError(transcriptionErrorMessage(reason));
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [
    handleTranscriptionEvent,
    onLog,
    projectId,
    refreshProfile,
  ]);

  useEffect(() => {
    if (!transcribing || startedAtRef.current === null) {
      return;
    }

    const update = () => {
      if (startedAtRef.current === null) return;

      setElapsedSeconds(
        Math.max(
          0,
          Math.floor(
            (Date.now() - startedAtRef.current) / 1000,
          ),
        ),
      );
    };

    update();

    const timer = window.setInterval(update, 500);

    return () => {
      window.clearInterval(timer);
    };
  }, [transcribing]);

  const changeQuality = async (value: QualityMode) => {
    setQuality(value);

    if (!hardware) return;

    try {
      await refreshProfile(value, hardware);
    } catch (reason) {
      setError(transcriptionErrorMessage(reason));
    }
  };

  const download = async () => {
    if (!profile) return;

    setBusy(true);
    setError(null);
    setDownloadActive(true);

    appendProcessLog(
      `Preparando descarga del modelo ${profile.model}`,
    );

    try {
      setModel({
        ...(model ?? {
          estimatedSizeBytes: null,
          message: null,
          model: profile.model,
          path: "",
        }),
        state: "downloading",
      });

      const downloaded = await downloadModel(profile.model);

      setModel(downloaded);
      setDownloadActive(false);

      appendProcessLog(
        `Modelo ${profile.model} disponible para uso local`,
        "success",
      );

      onNotify("Modelo local preparado");
    } catch (reason) {
      const message = transcriptionErrorMessage(reason);

      setDownloadActive(false);
      setError(message);
      appendProcessLog(message, "error");

      onNotify(message, "error");
    } finally {
      setBusy(false);
    }
  };

  const transcribe = async () => {
    setProcessLog([
      {
        id: `${Date.now()}-start`,
        timestamp: new Date().toLocaleTimeString("es-PE", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        level: "info",
        message: "Solicitud de transcripción iniciada",
      },
    ]);

    setBusy(true);
    setTranscribing(true);
    setStage("checking_hardware");
    setError(null);

    startedAtRef.current = Date.now();
    etaRef.current = null;
    firstSegmentSeen.current = false;
    logBucket.current = -1;

    setElapsedSeconds(0);
    setEtaSeconds(null);

    setRuntimeProfile(
      profile
        ? {
            device: profile.device,
            computeType: profile.computeType,
            model: profile.model,
          }
        : null,
    );

    setTranscript({
      ...emptyTranscript(durationUs),
      state: "preparing",
    });

    try {
      const result = await startTranscription(
        projectId,
        quality,
        language,
      );

      setTranscript(result);

      if (result.engine) {
        setRuntimeProfile({
          device: result.engine.device,
          computeType: result.engine.computeType,
          model: result.engine.model,
        });
      }

      setStage("completed");
      setEtaSeconds(0);

      onNotify("Transcripción completada");
    } catch (reason) {
      const message = transcriptionErrorMessage(reason);

      setStage("error");

      setTranscript((current) =>
        current
          ? {
              ...current,
              state: "error",
              message,
            }
          : current,
      );

      setError(message);
      appendProcessLog(message, "error");

      onNotify(message, "error");
    } finally {
      setBusy(false);
      setTranscribing(false);
    }
  };

  const cancel = async () => {
    setStage("cancelling");
    appendProcessLog("Solicitando cancelación", "warning");

    try {
      const status = await cancelTranscription(projectId);

      setTranscript(status);
      setStage("cancelled");
      setTranscribing(false);
      setBusy(false);

      appendProcessLog("Cancelación completada", "warning");
      onNotify("Cancelación solicitada", "info");
    } catch (reason) {
      const message = transcriptionErrorMessage(reason);

      setStage("error");
      setError(message);
      appendProcessLog(message, "error");

      onNotify(message, "error");
    }
  };

  const running = transcribing;
  const processedUs = transcript?.processedUs ?? 0;

  const progress =
    transcript?.progress ??
    (durationUs > 0
      ? Math.min(
          100,
          Math.max(0, (processedUs / durationUs) * 100),
        )
      : null);

  const effectiveProfile =
    runtimeProfile ??
    (profile
      ? {
          device: profile.device,
          computeType: profile.computeType,
          model: profile.model,
        }
      : null);

  const accelerationUnavailable =
    hardware !== null &&
    !hardware.transcriptionAcceleration.available;

  const lowAvailableRam =
    hardware !== null &&
    hardware.ramAvailableBytes < 4 * 1024 * 1024 * 1024;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-cyan">
            <BrainCircuit size={18} />
          </span>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan">
              Motor de transcripción
            </p>

            <h3 className="mt-1 font-bold text-ink">
              {stageLabel(stage)}
            </h3>
          </div>
        </div>

        <div className="flex gap-2">
          {model && model.state !== "ready" ? (
            <Button
              disabled={busy}
              icon={
                downloadActive ? (
                  <LoaderCircle
                    className="animate-spin"
                    size={16}
                  />
                ) : (
                  <Download size={16} />
                )
              }
              onClick={() => void download()}
            >
              {downloadActive
                ? `Descargando ${profile?.model ?? ""}`
                : `Descargar ${profile?.model ?? ""}`}
            </Button>
          ) : !running ? (
            <Button
              disabled={busy || model?.state !== "ready"}
              onClick={() => void transcribe()}
            >
              Transcribir
            </Button>
          ) : (
            <Button
              icon={<Square size={15} />}
              onClick={() => void cancel()}
              variant="secondary"
            >
              Cancelar
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Info
          icon={<Cpu size={15} />}
          label="Hardware"
          value={
            hardware?.gpuAdapters[0]?.name ??
            hardware?.cpu ??
            "Detectando…"
          }
        />

        <Info
          icon={<BrainCircuit size={15} />}
          label="Backend efectivo"
          value={
            effectiveProfile
              ? `${effectiveProfile.device.toUpperCase()} · ${effectiveProfile.computeType}`
              : "—"
          }
        />

        <Info
          icon={<Gauge size={15} />}
          label="Modelo efectivo"
          value={
            effectiveProfile?.model ??
            profile?.model ??
            "—"
          }
        />

        <Info
          icon={<MemoryStick size={15} />}
          label="RAM"
          value={
            hardware
              ? `${formatFileSize(hardware.ramAvailableBytes)} / ${formatFileSize(hardware.ramTotalBytes)}`
              : "—"
          }
        />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
          Idioma

          <select
            className="mt-2 w-full rounded-md border border-line bg-canvas p-2 text-sm normal-case text-ink"
            disabled={running || busy}
            onChange={(event) =>
              setLanguage(event.target.value as LanguageMode)
            }
            value={language}
          >
            <option value="auto">Auto</option>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </label>

        <label className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
          Perfil solicitado

          <select
            className="mt-2 w-full rounded-md border border-line bg-canvas p-2 text-sm normal-case text-ink"
            disabled={running || busy}
            onChange={(event) =>
              void changeQuality(
                event.target.value as QualityMode,
              )
            }
            value={quality}
          >
            <option value="auto">Auto</option>
            <option value="fast">Rápido</option>
            <option value="balanced">Equilibrado</option>
            <option value="quality">Calidad</option>
          </select>
        </label>
      </div>

      {model?.state !== "ready" ? (
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
          <p className="font-semibold">
            Se requiere el modelo local de transcripción:{" "}
            {profile?.model ?? "—"}
          </p>

          <p className="mt-1 text-muted">
            {model?.estimatedSizeBytes
              ? `Tamaño estimado: ${formatFileSize(model.estimatedSizeBytes)}. `
              : ""}
            La descarga se realiza una sola vez y después se reutiliza
            offline.
          </p>

          {downloadActive ? (
            <p className="mt-2 flex items-center gap-2">
              <LoaderCircle
                className="animate-spin"
                size={14}
              />
              Descargando modelo. El backend todavía no informa bytes
              descargados, por lo que CHETO no mostrará un porcentaje
              inventado.
            </p>
          ) : null}
        </div>
      ) : null}

      {stage !== "idle" ? (
        <div className="mt-5 rounded-xl border border-line bg-canvas/35 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                Etapa actual
              </p>

              <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-ink">
                {isActiveStage(stage) ? (
                  <LoaderCircle
                    className="animate-spin text-cyan"
                    size={15}
                  />
                ) : stage === "completed" ? (
                  <CheckCircle2
                    className="text-cyan"
                    size={15}
                  />
                ) : null}

                {stageLabel(stage)}
              </p>
            </div>

            <p className="font-mono text-sm font-bold text-cyan">
              {progress === null
                ? "—"
                : `${Math.floor(progress)} %`}
            </p>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel">
            <div
              className="h-full rounded-full bg-cyan transition-[width] duration-300"
              style={{
                width: `${progress === null ? 0 : Math.min(100, Math.max(0, progress))}%`,
              }}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              label="Procesado"
              value={`${formatPlaybackTime(processedUs)} / ${formatPlaybackTime(durationUs)}`}
            />

            <Metric
              icon={<Clock3 size={13} />}
              label="Tiempo activo"
              value={formatClock(elapsedSeconds)}
            />

            <Metric
              label="Restante estimado"
              value={
                stage === "completed"
                  ? "00:00"
                  : etaSeconds === null
                    ? "Calculando…"
                    : `~${formatClock(etaSeconds)}`
              }
            />

            <Metric
              label="Resultado parcial"
              value={`${transcript?.segmentCount ?? 0} seg. · ${transcript?.wordCount ?? 0} pal.`}
            />
          </div>
        </div>
      ) : null}

      {accelerationUnavailable ? (
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 shrink-0 text-warning"
              size={16}
            />

            <div>
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-warning">
                Aceleración GPU no disponible
              </p>

              <p className="mt-1 text-xs text-muted">
                {hardware.transcriptionAcceleration.reason}
              </p>

              <p className="mt-1 text-xs text-muted">
                CHETO utiliza CPU automáticamente. Esto no impide la
                transcripción.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {profile ? (
        <div className="mt-4 rounded-lg border border-line bg-canvas/35 p-3 text-xs text-muted">
          <p>
            Perfil solicitado:{" "}
            <strong className="text-ink">
              {qualityLabel(quality)}
            </strong>
            {" · "}
            Selección actual:{" "}
            <strong className="text-ink">
              {profile.model} / {profile.device.toUpperCase()} ·{" "}
              {profile.computeType}
            </strong>
          </p>

          <p className="mt-1">
            Motivo:{" "}
            {profileSelectionReason(
              quality,
              profile,
              lowAvailableRam,
            )}
          </p>
        </div>
      ) : null}

      <details className="mt-4 rounded-lg border border-line bg-canvas/25">
        <summary className="cursor-pointer select-none px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-muted">
          Detalles del proceso
        </summary>

        <div className="border-t border-line px-4 py-3">
          {processLog.length === 0 ? (
            <p className="text-xs text-muted">
              Todavía no hay eventos de ejecución.
            </p>
          ) : (
            <div className="max-h-52 space-y-2 overflow-auto">
              {processLog.map((entry) => (
                <div
                  className="grid grid-cols-[70px_1fr] gap-3 text-xs"
                  key={entry.id}
                >
                  <span className="font-mono text-muted">
                    {entry.timestamp}
                  </span>

                  <span className={processLogClass(entry.level)}>
                    {entry.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      {error ? (
        <p className="mt-4 flex gap-2 text-sm text-danger">
          <AlertTriangle
            className="shrink-0"
            size={16}
          />
          {error}
        </p>
      ) : null}

      {transcript?.state === "completed" ||
      transcript?.state === "stale" ? (
        <div className="mt-5 border-t border-line pt-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Info
              label="Idioma"
              value={transcript.language ?? "—"}
            />

            <Info
              label="Segmentos"
              value={String(transcript.segmentCount)}
            />

            <Info
              label="Palabras"
              value={String(transcript.wordCount)}
            />

            <Info
              label="Duración"
              value={formatPlaybackTime(transcript.durationUs)}
            />
          </div>

          {transcript.message ? (
            <p className="mt-4 text-sm text-warning">
              {transcript.message}
            </p>
          ) : null}

          <div className="mt-4 max-h-64 space-y-2 overflow-auto">
            {transcript.segments.map((segment) => (
              <button
                className="block w-full rounded-lg border border-line bg-canvas/50 p-3 text-left transition hover:border-cyan/50"
                disabled={segment.startUs === null}
                key={segment.id}
                onClick={() => {
                  if (segment.startUs !== null) {
                    onSeek(segment.startUs);
                  }
                }}
                type="button"
              >
                <span className="font-mono text-[10px] text-cyan">
                  {formatPlaybackTime(segment.startUs ?? 0)}
                </span>

                <span className="ml-3 text-sm text-ink">
                  {segment.text}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {hardware ? (
        <p className="mt-5 text-xs text-muted">
          {hardware.cpu} · {hardware.physicalCores} núcleos /{" "}
          {hardware.logicalCores} hilos
        </p>
      ) : null}
    </Card>
  );
}

function emptyTranscript(durationUs: number): TranscriptStatus {
  return {
    durationUs,
    engine: null,
    language: null,
    message: null,
    processedUs: 0,
    progress: 0,
    segmentCount: 0,
    segments: [],
    state: "preparing",
    wordCount: 0,
  };
}

function stageFromTranscript(
  state: TranscriptStatus["state"],
): TranscriptionStage {
  switch (state) {
    case "preparing":
      return "preparing_worker";
    case "running":
      return "transcribing";
    case "completed":
    case "stale":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

function stageLabel(stage: TranscriptionStage): string {
  const labels: Record<TranscriptionStage, string> = {
    idle: "No iniciado",
    checking_hardware: "Verificando hardware y perfil",
    preparing_worker: "Preparando worker",
    loading_model: "Cargando modelo",
    model_ready: "Modelo cargado",
    transcribing: "Transcribiendo",
    saving: "Guardando resultado",
    completed: "Completado",
    cancelling: "Cancelando",
    cancelled: "Cancelado",
    error: "Error",
  };

  return labels[stage];
}

function isActiveStage(stage: TranscriptionStage): boolean {
  return [
    "checking_hardware",
    "preparing_worker",
    "loading_model",
    "model_ready",
    "transcribing",
    "saving",
    "cancelling",
  ].includes(stage);
}

function qualityLabel(mode: QualityMode): string {
  const labels: Record<QualityMode, string> = {
    auto: "Auto",
    fast: "Rápido",
    balanced: "Equilibrado",
    quality: "Calidad",
  };

  return labels[mode];
}

function profileSelectionReason(
  quality: QualityMode,
  profile: ExecutionProfile,
  lowAvailableRam: boolean,
): string {
  if (quality === "fast" && profile.model === "tiny") {
    return "El perfil Rápido prioriza velocidad y utiliza un modelo ligero.";
  }

  if (
    lowAvailableRam &&
    profile.model === "tiny" &&
    quality !== "fast"
  ) {
    return "La RAM disponible es inferior a 4 GB; se utiliza tiny para proteger la estabilidad.";
  }

  return (
    profile.reason ||
    "Selección automática según los recursos disponibles."
  );
}

function payloadString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];

  return typeof value === "string" ? value : null;
}

function payloadNumber(
  payload: Record<string, unknown>,
  key: string,
): number {
  const value = payload[key];

  return typeof value === "number" && Number.isFinite(value)
    ? value
    : 0;
}

function asRecord(
  value: unknown,
): Record<string, unknown> | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function runtimeProfileFromPayload(
  payload: Record<string, unknown>,
  current: RuntimeTranscriptionProfile | null,
): RuntimeTranscriptionProfile {
  return {
    device:
      payloadString(payload, "device") ??
      current?.device ??
      "cpu",
    computeType:
      payloadString(payload, "computeType") ??
      payloadString(payload, "compute_type") ??
      current?.computeType ??
      "unknown",
    model:
      payloadString(payload, "model") ??
      current?.model ??
      "unknown",
  };
}

function updateEta(
  processedUs: number,
  durationUs: number,
  startedAt: number | null,
  etaRef: MutableRefObject<number | null>,
  setEtaSeconds: (value: number | null) => void,
) {
  if (
    startedAt === null ||
    processedUs <= 0 ||
    durationUs <= processedUs
  ) {
    return;
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  const progressRatio = processedUs / durationUs;

  if (elapsed < 2 || progressRatio < 0.05) {
    return;
  }

  const instantEta =
    elapsed * ((durationUs - processedUs) / processedUs);

  const previous = etaRef.current;

  const smoothed =
    previous === null
      ? instantEta
      : previous * 0.7 + instantEta * 0.3;

  const normalized = Math.max(0, Math.round(smoothed));

  etaRef.current = normalized;
  setEtaSeconds(normalized);
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainingSeconds = safe % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    remainingSeconds,
  ).padStart(2, "0")}`;
}

function processLogClass(level: ProcessLogLevel): string {
  if (level === "error") return "text-danger";
  if (level === "warning") return "text-warning";
  if (level === "success") return "text-cyan";

  return "text-ink";
}

function Info({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-canvas/55 p-3">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <p className="text-[10px] font-bold uppercase tracking-[0.12em]">
          {label}
        </p>
      </div>

      <p className="mt-2 truncate text-sm font-semibold text-ink">
        {value}
      </p>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel/40 p-3">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <p className="text-[10px] font-bold uppercase tracking-[0.1em]">
          {label}
        </p>
      </div>

      <p className="mt-2 text-sm font-semibold text-ink">
        {value}
      </p>
    </div>
  );
}