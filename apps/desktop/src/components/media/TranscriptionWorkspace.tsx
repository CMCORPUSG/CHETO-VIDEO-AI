import { AlertTriangle, BrainCircuit, Cpu, Download, Gauge, MemoryStick, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatFileSize } from "../../lib/format";
import { formatPlaybackTime } from "../../playback/time";
import type { ProjectBundle } from "../../project/contracts";
import type { LogLevel } from "../../types/diagnostics";
import type { ToastTone } from "../../types/toast";
import type { ExecutionProfile, HardwareProfile, LanguageMode, ModelStatus, QualityMode, TranscriptStatus } from "../../transcription/models";
import { cancelTranscription, detectHardwareProfile, downloadModel, getModelStatus, getTranscriptStatus, onTranscriptionEvent, selectTranscriptionProfile, startTranscription, transcriptionErrorMessage } from "../../transcription/service";
import { Button } from "../Button";
import { Card } from "../Card";

export function TranscriptionWorkspace({ bundle, onLog, onNotify, onSeek }: { bundle: ProjectBundle; onLog: (message: string, level?: LogLevel) => void; onNotify: (message: string, tone?: ToastTone) => void; onSeek: (timeUs: number) => void }) {
  const projectId = bundle.project.projectId;
  const [hardware, setHardware] = useState<HardwareProfile | null>(null);
  const [profile, setProfile] = useState<ExecutionProfile | null>(null);
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [transcript, setTranscript] = useState<TranscriptStatus | null>(null);
  const [quality, setQuality] = useState<QualityMode>("auto");
  const [language, setLanguage] = useState<LanguageMode>("auto");
  const [busy, setBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logBucket = useRef(-1);

  const refreshProfile = useCallback(async (nextQuality: QualityMode, detected: HardwareProfile) => {
    const selected = await selectTranscriptionProfile(detected, nextQuality);
    setProfile(selected);
    setModel(await getModelStatus(selected.model));
    onLog("TRANSCRIPTION_PROFILE_SELECTED");
  }, [onLog]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onTranscriptionEvent((event) => {
      if (event.projectId !== projectId && event.projectId !== "global") return;
      if (event.event === "SEGMENT") {
        const processedUs = Number(event.payload.processedUs ?? 0);
        const segmentCount = Number(event.payload.segmentCount ?? 0);
        const wordCount = Number(event.payload.wordCount ?? 0);
        setTranscript((current) => ({ ...(current ?? emptyTranscript(bundle.source.durationUs ?? 0)), processedUs, progress: bundle.source.durationUs ? processedUs / bundle.source.durationUs * 100 : null, segmentCount, wordCount, state: "running" }));
        const bucket = Math.floor((processedUs / Math.max(1, bundle.source.durationUs ?? 1)) * 4);
        if (bucket > logBucket.current) { logBucket.current = bucket; onLog("TRANSCRIPTION_PROGRESS"); }
      } else {
        const level: LogLevel = event.event.includes("FAILED") ? "error" : event.event.includes("FALLBACK") || event.event.includes("STALE") ? "warning" : "info";
        onLog(event.event, level);
      }
    }).then((value) => { if (disposed) value(); else unlisten = value; });
    void Promise.all([detectHardwareProfile(), getTranscriptStatus(projectId)]).then(async ([detected, existing]) => {
      if (disposed) return;
      setHardware(detected); setTranscript(existing); onLog("HARDWARE_PROFILE_DETECTED");
      if (existing.state === "stale") onLog("TRANSCRIPTION_STALE", "warning");
      await refreshProfile("auto", detected);
    }).catch((reason) => { if (!disposed) setError(transcriptionErrorMessage(reason)); });
    return () => { disposed = true; unlisten?.(); };
  }, [bundle.source.durationUs, onLog, projectId, refreshProfile]);

  const changeQuality = async (value: QualityMode) => { setQuality(value); if (!hardware) return; try { await refreshProfile(value, hardware); } catch (reason) { setError(transcriptionErrorMessage(reason)); } };
  const download = async () => { if (!profile) return; setBusy(true); setError(null); try { setModel({ ...(model ?? { estimatedSizeBytes: null, message: null, model: profile.model, path: "" }), state: "downloading" }); setModel(await downloadModel(profile.model)); onNotify("Modelo local preparado"); } catch (reason) { const message = transcriptionErrorMessage(reason); setError(message); onNotify(message, "error"); } finally { setBusy(false); } };
  const transcribe = async () => { setBusy(true); setTranscribing(true); setTranscript((current) => ({ ...(current ?? emptyTranscript(bundle.source.durationUs ?? 0)), state: "preparing" })); setError(null); logBucket.current = -1; try { const result = await startTranscription(projectId, quality, language); setTranscript(result); onNotify("Transcripción completada"); } catch (reason) { const message = transcriptionErrorMessage(reason); setError(message); onNotify(message, "error"); } finally { setBusy(false); setTranscribing(false); } };
  const cancel = async () => { try { setTranscript(await cancelTranscription(projectId)); onNotify("Cancelación solicitada", "info"); } catch (reason) { onNotify(transcriptionErrorMessage(reason), "error"); } };
  const running = transcribing;

  return <Card className="p-5">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
      <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-cyan"><BrainCircuit size={18} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan">Motor de transcripción</p><h3 className="mt-1 font-bold text-ink">{transcriptStateLabel(transcript?.state ?? "not_created")}</h3></div></div>
      <div className="flex gap-2">{model && model.state !== "ready" ? <Button disabled={busy} icon={<Download size={16} />} onClick={() => void download()}>Descargar {profile?.model}</Button> : !running ? <Button disabled={busy || model?.state !== "ready"} onClick={() => void transcribe()}>Transcribir</Button> : <Button icon={<Square size={15} />} onClick={() => void cancel()} variant="secondary">Cancelar</Button>}</div>
    </div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Info icon={<Cpu size={15} />} label="Hardware" value={hardware?.gpuAdapters[0]?.name ?? hardware?.cpu ?? "Detectando…"} />
      <Info icon={<BrainCircuit size={15} />} label="Backend" value={profile ? `${profile.device.toUpperCase()} · ${profile.computeType}` : "—"} />
      <Info icon={<Gauge size={15} />} label="Modelo" value={profile?.model ?? "—"} />
      <Info icon={<MemoryStick size={15} />} label="RAM disponible" value={hardware ? formatFileSize(hardware.ramAvailableBytes) : "—"} />
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Idioma<select className="mt-2 w-full rounded-md border border-line bg-canvas p-2 text-sm normal-case text-ink" onChange={(event) => setLanguage(event.target.value as LanguageMode)} value={language}><option value="auto">Auto</option><option value="es">Español</option><option value="en">English</option></select></label><label className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Perfil<select className="mt-2 w-full rounded-md border border-line bg-canvas p-2 text-sm normal-case text-ink" onChange={(event) => void changeQuality(event.target.value as QualityMode)} value={quality}><option value="auto">Auto</option><option value="fast">Rápido</option><option value="balanced">Equilibrado</option><option value="quality">Calidad</option></select></label></div>
    {model?.state !== "ready" ? <p className="mt-4 text-xs text-warning">Se requiere descargar el modelo local de transcripción: {profile?.model ?? "—"} · {model?.estimatedSizeBytes ? formatFileSize(model.estimatedSizeBytes) : "tamaño variable"}. Descarga única y reutilizable offline.</p> : null}
    {transcript?.state === "running" ? <div className="mt-5"><div className="mb-2 flex justify-between text-xs text-muted"><span>Transcribiendo</span><span>{transcript.progress === null ? "—" : `${Math.floor(transcript.progress)} %`}</span></div><div className="h-2 rounded-full bg-canvas"><div className="h-full rounded-full bg-cyan" style={{ width: `${transcript.progress ?? 0}%` }} /></div></div> : null}
    {error ? <p className="mt-4 flex gap-2 text-sm text-danger"><AlertTriangle className="shrink-0" size={16} />{error}</p> : null}
    {transcript?.state === "completed" || transcript?.state === "stale" ? <div className="mt-5 border-t border-line pt-5"><div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Info label="Idioma" value={transcript.language ?? "—"} /><Info label="Segmentos" value={String(transcript.segmentCount)} /><Info label="Palabras" value={String(transcript.wordCount)} /><Info label="Duración" value={formatPlaybackTime(transcript.durationUs)} /></div>{transcript.message ? <p className="mt-4 text-sm text-warning">{transcript.message}</p> : null}<div className="mt-4 max-h-64 space-y-2 overflow-auto">{transcript.segments.map((segment) => <button className="block w-full rounded-lg border border-line bg-canvas/50 p-3 text-left transition hover:border-cyan/50" disabled={segment.startUs === null} key={segment.id} onClick={() => { if (segment.startUs !== null) onSeek(segment.startUs); }} type="button"><span className="font-mono text-[10px] text-cyan">{formatPlaybackTime(segment.startUs ?? 0)}</span><span className="ml-3 text-sm text-ink">{segment.text}</span></button>)}</div></div> : null}
    {hardware ? <p className="mt-5 text-xs text-muted">{hardware.cpu} · {hardware.physicalCores} núcleos / {hardware.logicalCores} hilos · {hardware.transcriptionAcceleration.reason}</p> : null}
  </Card>;
}

function emptyTranscript(durationUs: number): TranscriptStatus { return { durationUs, engine: null, language: null, message: null, processedUs: 0, progress: null, segmentCount: 0, segments: [], state: "preparing", wordCount: 0 }; }
function transcriptStateLabel(state: TranscriptStatus["state"]): string { return { cancelled: "Cancelado", completed: "Completado", error: "Error", not_created: "No iniciado", preparing: "Preparando", running: "Transcribiendo", stale: "Desactualizado" }[state]; }
function Info({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) { return <div className="rounded-lg border border-line bg-canvas/55 p-3"><div className="flex items-center gap-2 text-muted">{icon}<p className="text-[10px] font-bold uppercase tracking-[0.12em]">{label}</p></div><p className="mt-2 truncate text-sm font-semibold text-ink">{value}</p></div>; }
