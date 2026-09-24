import { Camera, Check, Eye, ExternalLink, ShieldAlert, Sparkles, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatPlaybackTime } from "../../playback/time";
import type { ProjectBundle } from "../../project/contracts";
import { acceptedCameraSuggestions, cameraProgressPercent, toCameraPreview, type CameraPreview, type CameraProfile, type CameraSuggestion, type CameraSuggestionStatus, type CameraSuggestionType, type SmartCameraDocument, type SmartCameraProgress } from "../../smart-camera/models";
import { analyzeSmartCamera, applySmartCameraToEdl, cancelSmartCamera, getSmartCamera, onSmartCameraProgress, reviewSmartCamera, smartCameraErrorMessage } from "../../smart-camera/service";
import type { LogLevel } from "../../types/diagnostics";
import type { ToastTone } from "../../types/toast";
import { Button } from "../Button";
import { Card } from "../Card";

interface Props {
  bundle: ProjectBundle;
  onLog: (message: string, level?: LogLevel) => void;
  onNotify: (message: string, tone?: ToastTone) => void;
  onPreview: (preview: CameraPreview | null) => void;
  onSeek: (timeUs: number) => void;
}

export function SmartCameraWorkspace({ bundle, onLog, onNotify, onPreview, onSeek }: Props) {
  const projectId = bundle.project.projectId;
  const [profile, setProfile] = useState<CameraProfile>("normal");
  const [document, setDocument] = useState<SmartCameraDocument | null>(null);
  const [progress, setProgress] = useState<SmartCameraProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onSmartCameraProgress((event) => {
      if (event.projectId !== projectId) return;
      setProgress(event);
      onLog(`SMART_CAMERA_${event.stage.toUpperCase()}`, event.stage === "error" ? "error" : "info");
    }).then((value) => { if (disposed) value(); else unlisten = value; });
    void getSmartCamera(projectId).then((value) => {
      if (disposed) return;
      setDocument(value);
      if (value) setProfile(value.profile);
      if (value?.status === "stale") onLog("SMART_CAMERA_STALE", "warning");
    }).catch((reason) => { if (!disposed) setError(smartCameraErrorMessage(reason)); });
    return () => { disposed = true; unlisten?.(); onPreview(null); };
  }, [onLog, onPreview, projectId]);

  const analyze = async () => {
    setBusy(true); setError(null); setProgress({ durationUs: bundle.source.durationUs ?? 0, processedUs: 0, progress: 0, projectId, stage: "extracting_samples" }); onPreview(null);
    try { setDocument(await analyzeSmartCamera(projectId, profile)); onNotify("Propuestas Smart Camera listas para revisar"); }
    catch (reason) { const message = smartCameraErrorMessage(reason); if (message.toLowerCase().includes("cancelado")) onNotify(message, "info"); else { setError(message); onNotify(message, "error"); } }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    try { await cancelSmartCamera(projectId); onNotify("Cancelación solicitada", "info"); }
    catch (reason) { onNotify(smartCameraErrorMessage(reason), "error"); }
  };

  const review = async (item: CameraSuggestion, status: CameraSuggestionStatus) => {
    try { setDocument(await reviewSmartCamera(projectId, item.id, status)); }
    catch (reason) { const message = smartCameraErrorMessage(reason); setError(message); onNotify(message, "error"); }
  };

  const preview = (item: CameraSuggestion) => {
    onPreview(toCameraPreview(item));
    onSeek(item.startUs);
    onLog("SMART_CAMERA_PREVIEW");
  };

  const apply = async () => {
    setBusy(true); setError(null);
    try { const result = await applySmartCameraToEdl(projectId); setDocument(result.document); onNotify(`${result.appliedCount} movimientos aplicados al EDL`); onLog("SMART_CAMERA_APPLIED_TO_EDL"); }
    catch (reason) { const message = smartCameraErrorMessage(reason); setError(message); onNotify(message, "error"); }
    finally { setBusy(false); }
  };

  const acceptedCount = acceptedCameraSuggestions(document).length;
  const stale = document?.status === "stale";
  return <Card className="p-5">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
      <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-cyan"><Camera size={18} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan">Smart Camera V1</p><h3 className="mt-1 font-bold text-ink">Zoom y encuadre revisables</h3></div></div>
      <div className="flex flex-wrap gap-2">{busy ? <Button icon={<Square size={14} />} onClick={() => void cancel()} variant="secondary">Cancelar</Button> : <Button icon={<Sparkles size={15} />} onClick={() => void analyze()}>{document ? "Reanalizar" : "Analizar"}</Button>}<Button disabled={busy || stale || acceptedCount === 0} icon={<Check size={15} />} onClick={() => void apply()}>Aplicar aceptadas al EDL</Button></div>
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-[220px_1fr]"><label className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Perfil<select className="mt-2 w-full rounded-md border border-line bg-canvas p-2 text-sm normal-case text-ink" disabled={busy} onChange={(event) => setProfile(event.target.value as CameraProfile)} value={profile}><option value="conservative">Conservador</option><option value="normal">Normal</option><option value="dynamic">Dinámico</option></select></label><p className="self-end pb-2 text-xs text-muted">Analiza muestras visuales de baja resolución. Sólo genera propuestas; no altera el original ni los cortes.</p></div>
    {busy && progress ? <div className="mt-5"><div className="mb-2 flex justify-between text-xs text-muted"><span>{stageLabel(progress.stage)}</span><span>{Math.floor(cameraProgressPercent(progress))} %</span></div><div className="h-2 rounded-full bg-canvas"><div className="h-full rounded-full bg-cyan transition-[width]" style={{ width: `${cameraProgressPercent(progress)}%` }} /></div></div> : null}
    {stale ? <p className="mt-4 flex items-center gap-2 text-sm text-warning"><ShieldAlert size={16} />El original cambió. Reanaliza antes de aplicar propuestas anteriores.</p> : null}
    {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
    {document ? <><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Total" value={document.statistics.total} /><Stat label="Zoom" value={document.statistics.zoom} /><Stat label="Enfoque" value={document.statistics.focus} /><Stat label="Aceptadas" value={document.statistics.accepted} /></div><div className="mt-5 max-h-[34rem] space-y-3 overflow-auto pr-1">{document.suggestions.map((item) => <SuggestionCard item={item} key={item.id} onPreview={() => preview(item)} onReview={(status) => void review(item, status)} onSeek={() => onSeek(item.startUs)} />)}{document.suggestions.length === 0 ? <p className="rounded-lg border border-line bg-canvas/40 p-4 text-sm text-muted">No se detectaron cambios visuales suficientemente sólidos con este perfil.</p> : null}</div></> : null}
  </Card>;
}

function SuggestionCard({ item, onPreview, onReview, onSeek }: { item: CameraSuggestion; onPreview: () => void; onReview: (status: CameraSuggestionStatus) => void; onSeek: () => void }) {
  return <div className="rounded-xl border border-line bg-canvas/45 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><span className="rounded bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan">{typeLabel(item.suggestionType)}</span><p className="mt-3 font-mono text-xs text-ink">{formatPlaybackTime(item.startUs)} → {formatPlaybackTime(item.endUs)} · {(item.durationUs / 1_000_000).toFixed(2)} s · {item.zoom.toFixed(2)}×</p><p className="mt-2 max-w-2xl text-sm text-muted">{item.reason}</p><p className="mt-2 text-xs font-semibold text-ink">Centro {Math.round(item.centerX * 100)}%, {Math.round(item.centerY * 100)}% · Confianza {Math.round(item.confidence * 100)}% · {statusLabel(item.status)}</p></div><div className="flex flex-wrap gap-2"><Button icon={<ExternalLink size={14} />} onClick={onSeek} variant="secondary">Ir</Button><Button icon={<Eye size={14} />} onClick={onPreview} variant="secondary">Preview</Button><Button disabled={item.status === "rejected"} icon={<X size={14} />} onClick={() => onReview("rejected")} variant="secondary">Rechazar</Button><Button disabled={item.status === "accepted"} icon={<Check size={14} />} onClick={() => onReview("accepted")}>Aceptar</Button></div></div></div>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="rounded-lg border border-line bg-canvas/55 p-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">{label}</p><p className="mt-2 text-xl font-bold text-ink">{value}</p></div>; }
function typeLabel(type: CameraSuggestionType): string { return { focus: "Enfoque", reset: "Restablecer", zoom: "Zoom" }[type]; }
function statusLabel(status: CameraSuggestionStatus): string { return { accepted: "Aceptada", pending: "Pendiente", rejected: "Rechazada" }[status]; }
function stageLabel(stage: SmartCameraProgress["stage"]): string { return { analyzing_visual_changes: "Analizando cambios visuales", cancelled: "Cancelado", completed: "Completado", consolidating_movements: "Consolidando movimientos", error: "Error", extracting_samples: "Extrayendo muestras", saving: "Guardando smart_camera.json" }[stage]; }
