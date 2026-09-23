import { Check, ExternalLink, Scissors, ShieldAlert, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatPlaybackTime } from "../../playback/time";
import type { ProjectBundle } from "../../project/contracts";
import { acceptedSuggestions, smartCutProgressPercent, type SmartCutDocument, type SmartCutProfile, type SmartCutProgress, type SmartCutSuggestion, type SmartCutSuggestionStatus, type SmartCutType } from "../../smart-cut/models";
import { analyzeSmartCut, applySmartCutToEdl, getSmartCut, onSmartCutProgress, reviewSmartCutSuggestion, smartCutErrorMessage } from "../../smart-cut/service";
import type { LogLevel } from "../../types/diagnostics";
import type { ToastTone } from "../../types/toast";
import { Button } from "../Button";
import { Card } from "../Card";

interface Props {
  bundle: ProjectBundle;
  onLog: (message: string, level?: LogLevel) => void;
  onNotify: (message: string, tone?: ToastTone) => void;
  onSeek: (timeUs: number) => void;
}

export function SmartCutWorkspace({ bundle, onLog, onNotify, onSeek }: Props) {
  const projectId = bundle.project.projectId;
  const [profile, setProfile] = useState<SmartCutProfile>("conservative");
  const [document, setDocument] = useState<SmartCutDocument | null>(null);
  const [progress, setProgress] = useState<SmartCutProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onSmartCutProgress((event) => {
      if (event.projectId !== projectId) return;
      setProgress(event);
      onLog(`SMART_CUT_${event.stage.toUpperCase()}`, event.stage === "error" ? "error" : "info");
    }).then((value) => { if (disposed) value(); else unlisten = value; });
    void getSmartCut(projectId).then((value) => {
      if (disposed) return;
      setDocument(value);
      if (value) setProfile(value.profile);
      if (value?.status === "stale") onLog("SMART_CUT_STALE", "warning");
    }).catch((reason) => { if (!disposed) setError(smartCutErrorMessage(reason)); });
    return () => { disposed = true; unlisten?.(); };
  }, [onLog, projectId]);

  const analyze = async () => {
    setBusy(true); setError(null); setProgress({ completedSteps: 0, projectId, stage: "preparing", totalSteps: 5 });
    try { setDocument(await analyzeSmartCut(projectId, profile)); onNotify("Propuestas Smart Cut listas para revisar"); }
    catch (reason) { const message = smartCutErrorMessage(reason); setError(message); onNotify(message, "error"); }
    finally { setBusy(false); }
  };

  const review = async (item: SmartCutSuggestion, status: SmartCutSuggestionStatus) => {
    try { setDocument(await reviewSmartCutSuggestion(projectId, item.id, status)); }
    catch (reason) { const message = smartCutErrorMessage(reason); setError(message); onNotify(message, "error"); }
  };

  const acceptPending = async () => {
    if (!document) return;
    setBusy(true); setError(null);
    try {
      let updated = document;
      for (const item of document.suggestions.filter((value) => value.status === "pending")) updated = await reviewSmartCutSuggestion(projectId, item.id, "accepted");
      setDocument(updated);
    } catch (reason) { setError(smartCutErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    setBusy(true); setError(null);
    try { const result = await applySmartCutToEdl(projectId); setDocument(result.document); onNotify(`${result.appliedCount} cortes aplicados al EDL`); onLog("SMART_CUT_APPLIED_TO_EDL"); }
    catch (reason) { const message = smartCutErrorMessage(reason); setError(message); onNotify(message, "error"); }
    finally { setBusy(false); }
  };

  const acceptedCount = acceptedSuggestions(document).length;
  const stale = document?.status === "stale";
  return <Card className="p-5">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
      <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-cyan"><Scissors size={18} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan">Smart Cut V1</p><h3 className="mt-1 font-bold text-ink">Propuestas revisables</h3></div></div>
      <div className="flex flex-wrap gap-2"><Button disabled={busy} icon={<Sparkles size={15} />} onClick={() => void analyze()}>{document ? "Reanalizar" : "Analizar"}</Button>{document?.statistics.pending ? <Button disabled={busy || stale} onClick={() => void acceptPending()} variant="secondary">Aceptar pendientes</Button> : null}<Button disabled={busy || stale || acceptedCount === 0} icon={<Check size={15} />} onClick={() => void apply()}>Aplicar aceptadas al EDL</Button></div>
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-[220px_1fr]"><label className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Perfil<select className="mt-2 w-full rounded-md border border-line bg-canvas p-2 text-sm normal-case text-ink" disabled={busy} onChange={(event) => setProfile(event.target.value as SmartCutProfile)} value={profile}><option value="conservative">Conservador</option><option value="normal">Normal</option><option value="aggressive">Agresivo</option></select></label><p className="self-end pb-2 text-xs text-muted">El perfil sólo cambia qué propuestas se generan. Nunca modifica automáticamente el video.</p></div>
    {busy && progress ? <div className="mt-5"><div className="mb-2 flex justify-between text-xs text-muted"><span>{stageLabel(progress.stage)}</span><span>{Math.floor(smartCutProgressPercent(progress))} %</span></div><div className="h-2 rounded-full bg-canvas"><div className="h-full rounded-full bg-cyan transition-[width]" style={{ width: `${smartCutProgressPercent(progress)}%` }} /></div></div> : null}
    {stale ? <p className="mt-4 flex items-center gap-2 text-sm text-warning"><ShieldAlert size={16} />El original cambió. Reanaliza antes de aplicar decisiones antiguas.</p> : null}
    {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
    {document ? <><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Total" value={document.statistics.total} /><Stat label="Silencios" value={document.statistics.silence} /><Stat label="Muletillas" value={document.statistics.filler} /><Stat label="Repeticiones / inicios" value={document.statistics.repetition + document.statistics.falseStart} /></div><div className="mt-5 max-h-[32rem] space-y-3 overflow-auto pr-1">{document.suggestions.map((item) => <SuggestionCard item={item} key={item.id} onReview={(status) => void review(item, status)} onSeek={() => onSeek(item.startUs)} />)}{document.suggestions.length === 0 ? <p className="rounded-lg border border-line bg-canvas/40 p-4 text-sm text-muted">No se encontraron propuestas suficientemente seguras con este perfil.</p> : null}</div></> : null}
  </Card>;
}

function SuggestionCard({ item, onReview, onSeek }: { item: SmartCutSuggestion; onReview: (status: SmartCutSuggestionStatus) => void; onSeek: () => void }) {
  return <div className="rounded-xl border border-line bg-canvas/45 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><span className="rounded bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan">{typeLabel(item.suggestionType)}</span><p className="mt-3 font-mono text-xs text-ink">{formatPlaybackTime(item.startUs)} → {formatPlaybackTime(item.endUs)} · {(item.durationUs / 1_000_000).toFixed(2)} s</p><p className="mt-2 max-w-2xl text-sm text-muted">{item.reason}</p><p className="mt-2 text-xs font-semibold text-ink">Confianza {Math.round(item.confidence * 100)} % · {statusLabel(item.status)}</p></div><div className="flex gap-2"><Button icon={<ExternalLink size={14} />} onClick={onSeek} variant="secondary">Ir</Button><Button disabled={item.status === "rejected"} icon={<X size={14} />} onClick={() => onReview("rejected")} variant="secondary">Rechazar</Button><Button disabled={item.status === "accepted"} icon={<Check size={14} />} onClick={() => onReview("accepted")}>Aceptar</Button></div></div></div>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="rounded-lg border border-line bg-canvas/55 p-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">{label}</p><p className="mt-2 text-xl font-bold text-ink">{value}</p></div>; }
function typeLabel(type: SmartCutType): string { return { false_start: "Falso inicio", filler: "Muletilla", repetition: "Repetición", silence: "Silencio" }[type]; }
function statusLabel(status: SmartCutSuggestionStatus): string { return { accepted: "Aceptada", pending: "Pendiente", rejected: "Rechazada" }[status]; }
function stageLabel(stage: SmartCutProgress["stage"]): string { return { analyzing_silences: "Analizando silencios y muletillas", analyzing_transcript: "Analizando transcripción", completed: "Completado", consolidating_suggestions: "Consolidando propuestas", detecting_repetitions: "Detectando repeticiones y falsos inicios", error: "Error", preparing: "Preparando", saving: "Guardando smart_cut.json" }[stage]; }
