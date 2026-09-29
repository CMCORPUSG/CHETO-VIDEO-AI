import { Check, ExternalLink, Scissors, ShieldAlert, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CutDecision, EdlManifest, ProjectBundle } from "../../project/contracts";
import { acceptedSuggestions, smartCutProgressPercent, type SmartCutDocument, type SmartCutProfile, type SmartCutProgress, type SmartCutSuggestion, type SmartCutSuggestionStatus, type SmartCutType } from "../../smart-cut/models";
import { analyzeSmartCut, applySmartCutToEdl, getSmartCut, onSmartCutProgress, reviewAllSmartCutSuggestions, reviewSmartCutSuggestion, smartCutErrorMessage } from "../../smart-cut/service";
import { classifyCut, previewCuts, type Resolution, type ConflictClass } from "../../editor/conflicts";
import { formatTimecode } from "../../editor/timecode";
import type { LogLevel } from "../../types/diagnostics";
import type { ToastTone } from "../../types/toast";
import type { ProjectContext } from "../../project/isolation";
import { Button } from "../Button";
import { Card } from "../Card";

interface Props {
  bundle: ProjectBundle;
  context: ProjectContext;
  edl: EdlManifest;
  onDraftChange: (cuts: CutDecision[]) => void;
  onEdlChange: (edl: EdlManifest) => void;
  onLog: (message: string, level?: LogLevel) => void;
  onNotify: (message: string, tone?: ToastTone) => void;
  onSeek: (timeUs: number) => void;
  onSelect?: (id: string) => void;
  onBeforeApply: () => Promise<unknown>;
  onFocusConflict: (timeUs: number, existingId: string) => void;
}

export function SmartCutWorkspace({ bundle, context, edl, onDraftChange, onEdlChange, onLog, onNotify, onSeek, onSelect, onBeforeApply, onFocusConflict }: Props) {
  const projectId = context.canonicalProjectId;
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [profile, setProfile] = useState<SmartCutProfile>("conservative");
  const [document, setDocument] = useState<SmartCutDocument | null>(null);
  const [progress, setProgress] = useState<SmartCutProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, Extract<Resolution, "merge" | "replace" | "keep_existing">>>({});
  const updateDocument = (value: SmartCutDocument) => {
    if (!live.current || value.projectId !== projectId || value.sourceId !== bundle.source.sourceId) return;
    setDocument(value);
    onDraftChange(value.suggestions.filter((item) => item.status === "accepted").map((item) => ({
      action: "remove", confidence: item.confidence, endUs: item.endUs, id: `draft-${item.id}`, reason: item.reason, startUs: item.startUs,
    })));
  };
  const updateDocumentRef = useRef(updateDocument);
  useEffect(() => { updateDocumentRef.current = updateDocument; });

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onSmartCutProgress((event) => {
      if (disposed || event.projectId !== projectId) return;
      setProgress(event);
      onLog(`SMART_CUT_${event.stage.toUpperCase()}`, event.stage === "error" ? "error" : "info");
    }).then((value) => { if (disposed) value(); else unlisten = value; });
    void getSmartCut(projectId).then((value) => {
      if (disposed || value?.projectId !== projectId || value?.sourceId !== bundle.source.sourceId) return;
      if (value) updateDocumentRef.current(value); else setDocument(null);
      if (value) setProfile(value.profile);
      if (value?.status === "stale") onLog("SMART_CUT_STALE", "warning");
    }).catch((reason) => { if (!disposed) setError(smartCutErrorMessage(reason)); });
    return () => { disposed = true; unlisten?.(); };
  }, [bundle.source.sourceId, onLog, projectId]);

  const analyze = async () => {
    setBusy(true); setError(null); setProgress({ completedSteps: 0, projectId, stage: "preparing", totalSteps: 5 });
    try { const value = await analyzeSmartCut(projectId, profile); if (!live.current || value.projectId !== projectId || value.sourceId !== bundle.source.sourceId) return; updateDocument(value); setResolutions({}); onLog(`SMART_CUT_SUMMARY projectId=${projectId} audioStream=${value.audioStream ?? 0} sampleRate=${value.sampleRate ?? "unknown"} channels=${value.channels ?? "unknown"} durationMs=${value.source.durationUs / 1000} analysisDurationMs=${value.analysisDurationMs ?? "unknown"} silenceThresholdDb=-35 minimumSilenceMs=${profile === "conservative" ? 1500 : profile === "normal" ? 1200 : 1000} rawSilenceCount=${value.diagnostics?.[0]?.rawSilenceCount ?? "unknown"} rawSilenceDurationMs=${value.diagnostics?.[0]?.rawSilenceDurationMs ?? "unknown"} candidatesDetected=${value.statistics.candidatesDetected ?? value.statistics.total} candidatesRejected=${value.statistics.candidatesRejected ?? 0} finalProposals=${value.statistics.total}`); onNotify(value.statistics.total ? "Propuestas de cortes listas para revisar" : "0 pausas suficientemente seguras detectadas"); }
    catch (reason) { const message = smartCutErrorMessage(reason); setError(message); onNotify(message, "error"); }
    finally { setBusy(false); }
  };

  const review = async (item: SmartCutSuggestion, status: SmartCutSuggestionStatus) => {
    try { updateDocument(await reviewSmartCutSuggestion(projectId, item.id, status)); }
    catch (reason) { const message = smartCutErrorMessage(reason); setError(message); onNotify(message, "error"); }
  };

  const reviewAll = async (status: SmartCutSuggestionStatus) => {
    setBusy(true); setError(null);
    try { const next = await reviewAllSmartCutSuggestions(projectId, status); updateDocument(next); if (status === "accepted") { const skipped = next.suggestions.filter((item) => item.status !== "accepted").length; if (skipped) onLog("SMART_CUT_DUPLICATE_SKIPPED", "info"); } }
    catch (reason) { setError(smartCutErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    if (unresolved > 0) { setError(`Revisa ${unresolved} conflicto(s) antes de aplicar.`); return; }
    setBusy(true); setError(null);
    try { await onBeforeApply(); const result = await applySmartCutToEdl(projectId, resolutions); if (!live.current || result.edl.projectId !== projectId || result.edl.sourceId !== bundle.source.sourceId) return; setDocument(result.document); onDraftChange([]); onEdlChange(result.edl); const seconds=result.edl.tracks.cuts.filter(cut=>!edl.tracks.cuts.some(current=>current.id===cut.id)).reduce((sum,cut)=>sum+(cut.endUs-cut.startUs)/1_000_000,0); onNotify(result.appliedCount?`✓ EDL actualizado · ${result.appliedCount} cortes nuevos o fusionados · ${seconds.toFixed(2)} s eliminados`:`EDL sin cambios · 0 nuevos`); onLog("SMART_CUT_BATCH_APPLIED"); }
    catch (reason) { const message = smartCutErrorMessage(reason); setError(message); const conflict = typeof reason === "object" && reason !== null && "code" in reason && reason.code === "edit-conflict"; onNotify(message, conflict ? "info" : "error"); onLog(conflict ? "SMART_CUT_CONFLICT_DETECTED" : "SMART_CUT_EDL_WRITE_FAILED", conflict ? "warning" : "error"); }
    finally { setBusy(false); }
  };

  const acceptedCount = acceptedSuggestions(document).length;
  const preflight = useMemo(() => document ? previewCuts(document.suggestions, edl.tracks.cuts) : null, [document, edl.tracks.cuts]);
  const unresolved = preflight?.conflicts.filter((item) => !resolutions[item.proposal.id]).length ?? 0;
  const applicable = preflight ? preflight.counts.new + preflight.counts.contains + preflight.counts.mergeable + preflight.conflicts.filter((item) => resolutions[item.proposal.id] && resolutions[item.proposal.id] !== "keep_existing").length : 0;
  const stale = document?.status === "stale";
  return <Card className="p-5">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
      <div className="flex items-center gap-3" title="Propone eliminar silencios o fragmentos innecesarios. Nunca modifica el original."><span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-cyan"><Scissors size={18} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan">Cortes inteligentes ⓘ</p><h3 className="mt-1 font-bold text-ink">Propuestas revisables</h3></div></div>
      <div className="flex flex-wrap gap-2"><Button disabled={busy} icon={<Sparkles size={15} />} onClick={() => void analyze()}>{document ? "Reanalizar" : "Analizar"}</Button>{document ? <><Button disabled={busy || stale} onClick={() => void reviewAll("accepted")} variant="secondary">Seleccionar todo</Button><Button disabled={busy || stale} onClick={() => void reviewAll("rejected")} variant="secondary">Deseleccionar todo</Button></> : null}<Button disabled={busy || stale || acceptedCount === 0 || unresolved > 0 || applicable === 0} icon={<Check size={15} />} onClick={() => void apply()}>Aplicar {applicable} cambios</Button></div>
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-[220px_1fr]"><label className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Perfil<select className="mt-2 w-full rounded-md border border-line bg-canvas p-2 text-sm normal-case text-ink" disabled={busy} onChange={(event) => setProfile(event.target.value as SmartCutProfile)} value={profile}><option value="conservative">Conservador</option><option value="normal">Normal</option><option value="aggressive">Agresivo</option></select></label><p className="self-end pb-2 text-xs text-muted">{profile === "conservative" ? "Pausa mínima 1,50 s · margen de voz 180 ms · corte mínimo 400 ms" : profile === "normal" ? "Pausa mínima 1,20 s · margen de voz 150 ms · corte mínimo 300 ms" : "Pausa mínima 1,00 s · margen de voz 100 ms · corte mínimo 180 ms"}. Nunca modifica automáticamente el video.</p></div>
    {busy && progress ? <div className="mt-5"><div className="mb-2 flex justify-between text-xs text-muted"><span>{stageLabel(progress.stage)}</span><span>{Math.floor(smartCutProgressPercent(progress))} %</span></div><div className="h-2 rounded-full bg-canvas"><div className="h-full rounded-full bg-cyan transition-[width]" style={{ width: `${smartCutProgressPercent(progress)}%` }} /></div></div> : null}
    {stale ? <p className="mt-4 flex items-center gap-2 text-sm text-warning"><ShieldAlert size={16} />El original cambió. Reanaliza antes de aplicar decisiones antiguas.</p> : null}
    {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
    {document?.diagnostics?.length ? <div className="mt-3 rounded border border-line bg-canvas/40 p-3 text-[10px] text-muted"><p className="font-bold text-ink">Silencios medidos · audio {document.audioStream ?? 0} · {document.sampleRate ?? "?"} Hz · {document.channels ?? "?"} canales</p>{document.diagnostics.map(item => <p className="mt-1" key={item.thresholdDb}>{item.thresholdDb} dB: detectados {item.rawSilenceCount} · muy cortos {item.tooShort} · inseguros {item.unsafeCount} · candidatos {item.candidateCount}</p>)}<p className="mt-1">Fusionados {Math.max(0, (document.diagnostics[0]?.candidateCount ?? 0) - document.statistics.total)} · propuestas finales {document.statistics.total}</p></div> : null}
    {document ? <><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Total" value={document.statistics.total} /><Stat label="Incluidas" value={document.statistics.accepted} /><Stat label="Duplicadas" value={preflight?.counts.duplicate ?? 0} /><Stat label="Conflictos" value={unresolved} /></div><p className="mt-3 text-xs text-muted">Resumen: {applicable} cambios · {(preflight?.counts.duplicate ?? 0) + (preflight?.counts.contained ?? 0)} omitidos · {unresolved} pendientes. {preflight?.counts.mergeable ?? 0} fusiones seguras.</p><p className="mt-1 text-xs text-muted">Detector: {document.statistics.candidatesDetected ?? document.statistics.total} candidatos · {document.statistics.candidatesRejected ?? 0} descartados por duración, seguridad o fusión · {document.statistics.total} propuestas finales.</p>{preflight?.conflicts.map(({proposal,existing,overlapUs:overlap}) => <div className="mt-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-ink" key={proposal.id}><strong>Conflicto de corte · {proposal.id}</strong><p className="mt-1">Propuesta {formatTimecode(proposal.startUs)} → {formatTimecode(proposal.endUs)}</p><p>Existente {existing?.id}: {formatTimecode(existing?.startUs ?? 0)} → {formatTimecode(existing?.endUs ?? 0)}</p><p>Solapamiento {(overlap/1_000_000).toFixed(3)} s</p><div className="mt-2 flex items-center gap-2"><Button onClick={() => { if (existing) onFocusConflict(proposal.startUs, existing.id); else onSeek(proposal.startUs); }} variant="secondary">Ir al conflicto</Button><select aria-label={`Resolver conflicto de corte ${proposal.id}`} className="min-w-0 flex-1 border border-line bg-canvas px-2 py-1" onChange={(event) => setResolutions((current) => { const next = { ...current }; const value = event.currentTarget.value; if (value === "merge" || value === "replace" || value === "keep_existing") next[proposal.id] = value; else delete next[proposal.id]; return next; })} value={resolutions[proposal.id] ?? ""}><option value="">Resolver antes de aplicar</option><option value="merge">Fusionar</option><option value="replace">Reemplazar existente</option><option value="keep_existing">Conservar existente</option></select></div></div>)}<div className="mt-3 max-h-[32rem] space-y-3 overflow-auto pr-1">{document.suggestions.map((item) => { const existing = edl.tracks.cuts.find((cut) => cut.id === item.id || ["duplicate", "contained"].includes(classifyCut(item, cut))); const entry = preflight?.entries.find((value) => value.proposal.id === item.id); return <SuggestionCard applied={Boolean(existing)} duplicate={Boolean(existing)} item={item} key={item.id} onSeek={() => {onSeek(item.startUs);if(existing)onSelect?.(existing.id);}} onToggle={()=>void review(item,item.status==="accepted"?"rejected":"accepted")} status={entry?.classification} />; })}{document.suggestions.length === 0 ? <p className="rounded-lg border border-line bg-canvas/40 p-4 text-sm text-muted">0 pausas suficientemente seguras detectadas. Revisa los umbrales y el desglose de silencios medidos.</p> : null}</div></> : null}
  </Card>;
}

function SuggestionCard({ applied, duplicate, item, onSeek, onToggle, status }: { applied:boolean; duplicate: boolean; item: SmartCutSuggestion; onSeek: () => void;onToggle:()=>void; status?: ConflictClass }) {
  return <div className="rounded-xl border border-line bg-canvas/45 p-4"><label className="mb-2 flex items-center gap-2 text-xs font-bold text-cyan"><input checked={!duplicate && item.status === "accepted"} disabled={duplicate} onChange={onToggle} type="checkbox"/>Incluir</label><div className="flex flex-wrap items-start justify-between gap-3"><div><span className="inline-block min-w-24 rounded bg-primary/10 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wider text-cyan">{typeLabel(item.suggestionType)}</span><p className="mt-3 font-mono text-xs text-ink">{formatTimecode(item.startUs)} → {formatTimecode(item.endUs)} · {(item.durationUs / 1_000_000).toFixed(2)} s</p><p className="mt-2 max-w-2xl text-sm text-muted">{item.reason}</p><p className="mt-2 text-xs font-semibold text-ink">Confianza {Math.round(item.confidence * 100)} % · {applied?"Ya existe":status === "overlap" || status === "conflict" ? "Conflicto · revisar" : statusLabel(item.status)}</p></div><Button icon={<ExternalLink size={14} />} onClick={onSeek} variant="secondary">Ir</Button></div></div>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="rounded-lg border border-line bg-canvas/55 p-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">{label}</p><p className="mt-2 text-xl font-bold text-ink">{value}</p></div>; }
function typeLabel(type: SmartCutType): string { return { false_start: "Falso inicio", filler: "Muletilla", repetition: "Repetición", silence: "Silencio" }[type]; }
function statusLabel(status: SmartCutSuggestionStatus): string { return { accepted: "Incluida", pending: "Pendiente", rejected: "Excluida" }[status]; }
function stageLabel(stage: SmartCutProgress["stage"]): string { return { analyzing_silences: "Analizando silencios y muletillas", completed: "Completado", consolidating_suggestions: "Consolidando propuestas", detecting_repetitions: "Detectando repeticiones y falsos inicios", error: "Error", preparing: "Preparando", saving: "Guardando smart_cut.json" }[stage]; }
