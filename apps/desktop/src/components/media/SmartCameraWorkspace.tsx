import { Camera, Check, Eye, ExternalLink, ShieldAlert, Sparkles, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatTimecode } from "../../editor/timecode";
import { classifyCamera, previewCamera } from "../../editor/conflicts";
import type { CameraDecision, EdlManifest, ProjectBundle } from "../../project/contracts";
import { acceptedCameraSuggestions, cameraProgressPercent, toCameraPreview, type CameraPreview, type CameraProfile, type CameraSuggestion, type CameraSuggestionStatus, type CameraSuggestionType, type SmartCameraDocument, type SmartCameraProgress } from "../../smart-camera/models";
import { analyzeSmartCamera, applySmartCameraToEdl, cancelSmartCamera, getSmartCamera, onSmartCameraProgress, reviewAllSmartCamera, reviewSmartCamera, smartCameraErrorMessage } from "../../smart-camera/service";
import type { LogLevel } from "../../types/diagnostics";
import type { ToastTone } from "../../types/toast";
import type { ProjectContext } from "../../project/isolation";
import { Button } from "../Button";
import { Card } from "../Card";

type CameraContentMode =
  | "auto"
  | "software"
  | "gameplay"
  | "presentation"
  | "general";

interface Props {
  bundle: ProjectBundle;
  context: ProjectContext;
  edl: EdlManifest;
  onDraftChange: (camera: CameraDecision[]) => void;
  onEdlChange: (edl: EdlManifest) => void;
  onBeforeApply: () => Promise<unknown>;
  onFocusConflict: (timeUs: number, existingId: string) => void;
  onLog: (message: string, level?: LogLevel) => void;
  onNotify: (message: string, tone?: ToastTone) => void;
  onPreview: (preview: CameraPreview | null) => void;
  onSeek: (timeUs: number) => void;
  onSelect?: (id: string) => void;
  onReanalyzeFromScratch: () => Promise<boolean>;
}

export function SmartCameraWorkspace({ bundle, context, edl, onDraftChange, onEdlChange, onBeforeApply, onFocusConflict, onLog, onNotify, onPreview, onSeek, onSelect, onReanalyzeFromScratch }: Props) {
  const projectId = context.canonicalProjectId;
  const live = useRef(true);
  const analysisActive = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; if (analysisActive.current) void cancelSmartCamera(projectId).catch(() => {}); }; }, [projectId]);
  const [duplicateSummary, setDuplicateSummary] = useState({ existing: 0, batch: 0 });
  const [profile, setProfile] = useState<CameraProfile>("normal");
  const [contentMode, setContentMode] = useState<CameraContentMode>("auto");
  const [document, setDocument] = useState<SmartCameraDocument | null>(null);
  const [progress, setProgress] = useState<SmartCameraProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, "replace" | "trim_new" | "keep_existing">>({});
  const updateDocument = (value: SmartCameraDocument) => {
    if (!live.current || value.projectId !== projectId || value.sourceId !== bundle.source.sourceId) return;
    setDocument(value);
    setDuplicateSummary({ existing: value.statistics.duplicateExisting ?? 0, batch: value.statistics.duplicateBatch ?? 0 });
    onDraftChange(value.suggestions.filter((item) => item.status === "accepted").map((item) => ({
      centerX: item.centerX, centerY: item.centerY, confidence: item.confidence, easing: "ease_in_out",
      endUs: item.endUs, id: `draft-${item.id}`, mode: item.suggestionType, reason: item.reason,
      startUs: item.startUs, transitionUs: item.transitionUs, zoom: item.zoom,
    })));
  };
  const updateDocumentRef = useRef(updateDocument);
  useEffect(() => { updateDocumentRef.current = updateDocument; });

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onSmartCameraProgress((event) => {
      if (disposed || event.projectId !== projectId) return;
      setProgress(event);
      onLog(`SMART_CAMERA_${event.stage.toUpperCase()}`, event.stage === "error" ? "error" : "info");
    }).then((value) => { if (disposed) value(); else unlisten = value; });
    void getSmartCamera(projectId).then((value) => {
      if (disposed || !live.current || (value && (value.projectId !== projectId || value.sourceId !== bundle.source.sourceId))) return;
      if (value) updateDocumentRef.current(value); else setDocument(null);
      if (value) {
        setProfile(value.profile);
        if (value.contentMode) {
          setContentMode(value.contentMode);
        }
      }
      if (value?.status === "stale") onLog("SMART_CAMERA_STALE", "warning");
    }).catch((reason) => { if (!disposed) setError(smartCameraErrorMessage(reason)); });
    return () => { disposed = true; unlisten?.(); onPreview(null); };
  }, [bundle.source.sourceId, onLog, onPreview, projectId]);

  const analyze = async () => {
    analysisActive.current = true;
    setBusy(true); setError(null); setProgress({ durationUs: bundle.source.durationUs ?? 0, processedUs: 0, progress: 0, projectId, stage: "extracting_samples" }); onPreview(null);
    try { const value = await analyzeSmartCamera(projectId, profile, contentMode); if (!live.current || value.projectId !== projectId || value.sourceId !== bundle.source.sourceId) return; updateDocument(value); setDuplicateSummary({ existing: 0, batch: 0 }); setResolutions({}); onLog(`SMART_CAMERA_SUMMARY projectId=${projectId} detected=${value.statistics.total} existingEdlTotal=${edl.tracks.camera.length} existingAutomaticEdl=${edl.tracks.camera.filter(item => item.automation?.origin === "automatic" && item.automation.detector === "smart_camera").length}`); onNotify("Propuestas de encuadre listas para revisar"); }
    catch (reason) { const message = smartCameraErrorMessage(reason); if (message.toLowerCase().includes("cancelado")) onNotify(message, "info"); else { setError(message); onNotify(message, "error"); } }
    finally { analysisActive.current = false; if (live.current) setBusy(false); }
  };

  const cancel = async () => {
    try { await cancelSmartCamera(projectId); onNotify("Cancelación solicitada", "info"); }
    catch (reason) { onNotify(smartCameraErrorMessage(reason), "error"); }
  };

  const review = async (item: CameraSuggestion, status: CameraSuggestionStatus) => {
    try { updateDocument(await reviewSmartCamera(projectId, item.id, status)); }
    catch (reason) { const message = smartCameraErrorMessage(reason); setError(message); onNotify(message, "error"); }
  };

  const reviewAll = async (status: CameraSuggestionStatus) => {
    setBusy(true); setError(null);
    try { const next = await reviewAllSmartCamera(projectId, status); if (!live.current || next.projectId !== projectId || next.sourceId !== bundle.source.sourceId) return; updateDocument(next); if (status === "accepted") { const skipped = next.suggestions.filter(item => item.status === "rejected").length; setDuplicateSummary({ existing: next.statistics.duplicateExisting ?? 0, batch: next.statistics.duplicateBatch ?? 0 }); if (skipped) onLog(`SMART_CAMERA_DUPLICATE_SKIPPED projectId=${projectId} duplicates=${skipped} duplicateExisting=${next.statistics.duplicateExisting ?? 0} duplicateBatch=${next.statistics.duplicateBatch ?? 0} existingEdlTotal=${edl.tracks.camera.length} existingAutomaticEdl=${edl.tracks.camera.filter(item => item.automation?.origin === "automatic" && item.automation.detector === "smart_camera").length} new=${next.statistics.accepted}`, "info"); } }
    catch (reason) { const message = smartCameraErrorMessage(reason); setError(message); onNotify(message, "error"); }
    finally { setBusy(false); }
  };

  const preview = (item: CameraSuggestion) => {
    onPreview(toCameraPreview(item));
    onSeek(Math.max(0, item.startUs - 700_000));
    onLog("SMART_CAMERA_PREVIEW");
  };

  const apply = async () => {
    setBusy(true); setError(null);
    try { await onBeforeApply(); const result = await applySmartCameraToEdl(projectId, resolutions); if (!live.current || result.edl.projectId !== projectId || result.edl.sourceId !== bundle.source.sourceId) return; setDocument(result.document); onDraftChange([]); onPreview(null); onEdlChange(result.edl); const added=result.edl.tracks.camera.filter(item=>!edl.tracks.camera.some(current=>current.id===item.id));const zooms=added.filter(item=>item.mode!=="reset").length;const resets=added.filter(item=>item.mode==="reset").length;onNotify(result.appliedCount?`✓ EDL actualizado · ${zooms} zoom/enfoque · ${resets} restablecimientos · ${result.appliedCount} nuevos`:`EDL sin cambios · 0 nuevos`); onLog(`SMART_CAMERA_CONFLICT_BATCH_APPLIED ${result.appliedCount}`); }
    catch (reason) { const message = smartCameraErrorMessage(reason); setError(message); onNotify(message, "error"); onLog(message.toLowerCase().includes("conflicto") ? "SMART_CAMERA_CONFLICT_DETECTED" : "SMART_CAMERA_APPLY_ERROR", message.toLowerCase().includes("conflicto") ? "warning" : "error"); }
    finally { setBusy(false); }
  };

  const acceptedCount = acceptedCameraSuggestions(document).length;
  const preflight = useMemo(() => document ? previewCamera(document.suggestions, edl.tracks.camera) : null, [document, edl.tracks.camera]);
  const unresolved = preflight?.conflicts.filter((item) => !resolutions[item.proposal.id]).length ?? 0;
  const applicable = (preflight?.counts.new ?? 0) + (preflight?.conflicts.filter(({ proposal }) => resolutions[proposal.id] && resolutions[proposal.id] !== "keep_existing").length ?? 0);
  const stale = document?.status === "stale";
  return <Card className="smart-camera-square p-3">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
      <div className="flex items-center gap-3" title="Analiza el video para proponer zooms y reencuadres. No requiere cámara web."><span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-cyan"><Camera size={18} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan">Encuadre inteligente ⓘ</p><h3 className="mt-1 font-bold text-ink">Zoom y seguimiento virtual</h3></div></div>
      <div className="flex flex-wrap gap-2">{busy ? <Button icon={<Square size={14} />} onClick={() => void cancel()} variant="secondary">Cancelar</Button> : <Button icon={<Sparkles size={15} />} onClick={() => void analyze()}>{document ? "Reanalizar" : "Analizar"}</Button>}{document ? <><Button disabled={busy || stale} onClick={() => void reviewAll("accepted")} variant="secondary">Incluir todo</Button><Button disabled={busy || stale} onClick={() => void reviewAll("rejected")} variant="secondary">Excluir todo</Button></> : null}<Button disabled={busy || stale || acceptedCount === 0 || unresolved > 0 || applicable === 0} icon={<Check size={15} />} onClick={() => void apply()}>Aplicar {applicable} cambios</Button><Button disabled={busy} onClick={() => void onReanalyzeFromScratch().then(done => { if (done) { setDocument(null); onDraftChange([]); } })} variant="secondary">Reanalizar desde cero…</Button></div>
    </div>
    <div className="mt-4 grid gap-2">
      <label className="min-w-0 text-[9px] font-bold uppercase tracking-[0.08em] text-muted" title="Controla cuánta evidencia visual se exige antes de proponer un movimiento.">
        Perfil ⓘ
        <select className="mt-1.5 w-full rounded-md border border-line bg-canvas px-2.5 py-2 text-[11px] font-semibold normal-case text-ink" disabled={busy} onChange={(event) => setProfile(event.target.value as CameraProfile)} value={profile}>
          <option value="conservative">Conservador</option>
          <option value="normal">Normal</option>
          <option value="dynamic">Dinámico</option>
        </select>
      </label>
      <p className="max-w-full text-[10px] leading-4 text-muted">
        Amplía regiones importantes del video sin usar webcam. Los cambios siempre son revisables.
      </p>
    </div>
    <div className="mt-3 grid gap-1.5">
      <label className="text-[9px] font-bold uppercase tracking-[0.06em] text-muted">
        Tipo de contenido
        <select
          className="mt-1.5 w-full border border-line bg-canvas px-2 py-1.5 text-[10px] font-semibold normal-case text-ink"
          disabled={busy}
          onChange={(event) =>
            setContentMode(event.target.value as CameraContentMode)
          }
          value={contentMode}
        >
          <option value="auto">Automático</option>
          <option value="software">Software / Tutorial</option>
          <option value="gameplay">Gameplay</option>
          <option value="presentation">Presentación</option>
          <option value="general">General</option>
        </select>
      </label>

      <p className="text-[9px] leading-3.5 text-muted">
        {contentMode === "software"
          ? "Software / Tutorial: analiza cambios de región con mayor frecuencia, mantiene el foco varios segundos y usa transiciones suaves. Optimizado para fuentes largas."
          : contentMode === "gameplay"
            ? "Gameplay: detector conservador. Evita seguir cada movimiento del juego y solo propone cambios visuales sostenidos."
            : contentMode === "presentation"
              ? "Presentación: prioriza áreas estables y cambios de diapositiva con zoom moderado."
              : "Automático: comportamiento general conservador y seguro."}
      </p>
    </div>
    {busy && progress ? <div className="mt-5"><div className="mb-2 flex justify-between text-xs text-muted"><span>{stageLabel(progress.stage)}</span><span>{Math.floor(cameraProgressPercent(progress))} %</span></div><div className="h-2 rounded-full bg-canvas"><div className="h-full rounded-full bg-cyan transition-[width]" style={{ width: `${cameraProgressPercent(progress)}%` }} /></div></div> : null}
    {stale ? <p className="mt-4 flex items-center gap-2 text-sm text-warning"><ShieldAlert size={16} />El original cambió. Reanaliza antes de aplicar propuestas anteriores.</p> : null}
    {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
    {document ? <>
      <div className="mt-4 grid grid-cols-2 gap-2"><Stat label="Total" value={document.statistics.total} /><Stat label="Pendientes" value={document.statistics.pending} /><Stat label="Incluidas" value={document.statistics.accepted} /><Stat label="Conflictos" value={(preflight?.counts.conflict ?? 0) + (preflight?.counts.overlap ?? 0)} /></div>
      <p className="mt-3 text-[9px] text-muted">Antes de aplicar: {preflight?.counts.new ?? 0} nuevos · {duplicateSummary.existing} ya aplicados en este proyecto · {duplicateSummary.batch} repetidos entre propuestas · {preflight?.counts.duplicate ?? 0} duplicados · {preflight?.counts.contained ?? 0} contenidos · {(preflight?.counts.conflict ?? 0) + (preflight?.counts.overlap ?? 0)} conflictos. {unresolved > 0 ? `Resuelve ${unresolved} para continuar.` : ""}</p>
      {preflight?.conflicts.map(({proposal, existing, overlapUs: overlap}) => <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-[9px] text-ink" key={proposal.id}>
        <p>Propuesta {proposal.id}: {formatTimecode(proposal.startUs)}–{formatTimecode(proposal.endUs)} · {proposal.zoom.toFixed(2)}× · centro {Math.round(proposal.centerX * 100)}%, {Math.round(proposal.centerY * 100)}%</p>
        <p className="mt-1">Existente {existing?.id}: {formatTimecode(existing?.startUs ?? 0)}–{formatTimecode(existing?.endUs ?? 0)} · {(existing?.zoom ?? 1).toFixed(2)}× · centro {Math.round((existing?.centerX ?? 0.5) * 100)}%, {Math.round((existing?.centerY ?? 0.5) * 100)}% · solape {(overlap / 1_000_000).toFixed(2)} s</p>
        <button className="mt-1 text-cyan underline" onClick={() => onFocusConflict(proposal.startUs, existing?.id ?? proposal.id)} type="button">Ir al conflicto en la timeline</button>
        <label className="mt-2 block text-muted">Resolver<select aria-label={`Resolver conflicto ${proposal.id}`} className="mt-1 w-full border border-line bg-canvas px-2 py-1 text-ink" onChange={(event) => setResolutions(current => { const next = { ...current }; const value = event.currentTarget.value; if (value === "replace" || value === "trim_new" || value === "keep_existing") next[proposal.id] = value; else delete next[proposal.id]; return next; })} value={resolutions[proposal.id] ?? ""}><option value="">Elegir resolución</option><option value="keep_existing">Conservar existente</option><option value="replace">Reemplazar el tramo existente</option><option value="trim_new">Recortar propuesta fuera del existente</option></select></label>
      </div>)}
      <div className="mt-3 max-h-[34rem] space-y-3 overflow-auto pr-1">{document.suggestions.map(item => { const existing = edl.tracks.camera.find(camera => camera.id === item.id || ["duplicate", "contained"].includes(classifyCamera(item, camera))); const duplicate = Boolean(existing); return <SuggestionCard applied={edl.tracks.camera.some(camera => camera.id === item.id)} duplicate={duplicate} item={item} key={item.id} onPreview={() => preview(item)} onSeek={() => { onPreview(null); onSeek(item.startUs); if (existing) onSelect?.(existing.id); }} onToggle={() => void review(item, item.status === "accepted" ? "rejected" : "accepted")} />; })}{document.suggestions.length === 0 ? <p className="rounded-lg border border-line bg-canvas/40 p-4 text-sm text-muted">No se detectaron cambios visuales suficientemente sólidos con este perfil.</p> : null}</div>
    </> : null}
  </Card>;
}

function SuggestionCard({ applied,duplicate,item,onPreview,onSeek,onToggle }: { applied:boolean;duplicate:boolean;item: CameraSuggestion; onPreview: () => void; onSeek: () => void;onToggle:()=>void }) {
  return <div className="min-w-0 rounded-xl border border-line bg-canvas/45 p-3"><label className="mb-2 flex items-center gap-2 text-xs font-bold text-cyan"><input checked={!duplicate && item.status === "accepted"} disabled={duplicate} onChange={onToggle} type="checkbox"/>Incluir</label><div className="flex flex-wrap items-start justify-between gap-3"><div><span className="inline-block min-w-24 rounded bg-primary/10 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wider text-cyan">{typeLabel(item.suggestionType)}</span><p className="mt-2 break-words font-mono text-[10px] leading-4 text-ink">{formatTimecode(item.startUs)} → {formatTimecode(item.endUs)} · {(item.durationUs / 1_000_000).toFixed(2)} s · {item.zoom.toFixed(2)}×</p><p className="mt-2 max-w-full text-[11px] leading-4 text-muted">{item.reason}</p><p className="mt-2 break-words text-[10px] font-semibold leading-4 text-ink">Centro {Math.round(item.centerX * 100)}%, {Math.round(item.centerY * 100)}% · Confianza {Math.round(item.confidence * 100)}% · {applied ? "Aplicada" : duplicate ? "Ya existe" : statusLabel(item.status)}</p></div><div className="flex min-h-10 flex-wrap gap-2"><Button icon={<ExternalLink size={14} />} onClick={onSeek} variant="secondary">Ir</Button><Button icon={<Eye size={14} />} onClick={onPreview} variant="secondary">Previsualizar</Button></div></div></div>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="min-w-0 rounded-lg border border-line bg-canvas/55 p-2.5"><p className="max-w-full text-[9px] font-bold uppercase leading-tight tracking-[0.06em] text-muted">{label}</p><p className="mt-1.5 text-base font-bold leading-none text-ink">{value}</p></div>; }
function typeLabel(type: CameraSuggestionType): string { return { focus: "Enfoque", reset: "Restablecer", zoom: "Zoom" }[type]; }
function statusLabel(status: CameraSuggestionStatus): string { return { accepted: "Incluida", pending: "Pendiente", rejected: "Excluida" }[status]; }
function stageLabel(stage: SmartCameraProgress["stage"]): string { return { analyzing_visual_changes: "Analizando cambios visuales", cancelled: "Cancelado", completed: "Completado", consolidating_movements: "Consolidando movimientos", error: "Error", extracting_samples: "Extrayendo muestras", saving: "Guardando smart_camera.json" }[stage]; }
