import { Camera, Check, Eye, ExternalLink, ShieldAlert, Sparkles, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatPlaybackTime } from "../../playback/time";
import type { CameraDecision, EdlManifest, ProjectBundle } from "../../project/contracts";
import { acceptedCameraSuggestions, cameraProgressPercent, toCameraPreview, type CameraPreview, type CameraProfile, type CameraSuggestion, type CameraSuggestionStatus, type CameraSuggestionType, type SmartCameraDocument, type SmartCameraProgress } from "../../smart-camera/models";
import { analyzeSmartCamera, applySmartCameraToEdl, cancelSmartCamera, getSmartCamera, onSmartCameraProgress, reviewSmartCamera, smartCameraErrorMessage } from "../../smart-camera/service";
import type { LogLevel } from "../../types/diagnostics";
import type { ToastTone } from "../../types/toast";
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
  edl: EdlManifest;
  onDraftChange: (camera: CameraDecision[]) => void;
  onEdlChange: (edl: EdlManifest) => void;
  onLog: (message: string, level?: LogLevel) => void;
  onNotify: (message: string, tone?: ToastTone) => void;
  onPreview: (preview: CameraPreview | null) => void;
  onSeek: (timeUs: number) => void;
  onSelect?: (id: string) => void;
}

export function SmartCameraWorkspace({ bundle, edl, onDraftChange, onEdlChange, onLog, onNotify, onPreview, onSeek, onSelect }: Props) {
  const projectId = bundle.project.projectId;
  const [profile, setProfile] = useState<CameraProfile>("normal");
  const [contentMode, setContentMode] = useState<CameraContentMode>("auto");
  const [document, setDocument] = useState<SmartCameraDocument | null>(null);
  const [progress, setProgress] = useState<SmartCameraProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

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
      if (value) {
        setProfile(value.profile);
        if (value.contentMode) {
          setContentMode(value.contentMode);
        }
      }
      if (value?.status === "stale") onLog("SMART_CAMERA_STALE", "warning");
    }).catch((reason) => { if (!disposed) setError(smartCameraErrorMessage(reason)); });
    return () => { disposed = true; unlisten?.(); onPreview(null); };
  }, [onLog, onPreview, projectId]);

  const analyze = async () => {
    setBusy(true); setError(null); setProgress({ durationUs: bundle.source.durationUs ?? 0, processedUs: 0, progress: 0, projectId, stage: "extracting_samples" }); onPreview(null);
    try { setDocument(await analyzeSmartCamera(projectId, profile, contentMode)); onNotify("Propuestas de encuadre listas para revisar"); }
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
    try { const result = await applySmartCameraToEdl(projectId); setDocument(result.document); onEdlChange(result.edl); const added=result.edl.tracks.camera.filter(item=>!edl.tracks.camera.some(current=>current.id===item.id));const zooms=added.filter(item=>item.mode!=="reset").length;const resets=added.filter(item=>item.mode==="reset").length;onNotify(result.appliedCount?`✓ EDL actualizado · ${zooms} zoom/enfoque · ${resets} restablecimientos · ${result.appliedCount} nuevos`:`EDL sin cambios · 0 nuevos`); onLog("SMART_CAMERA_APPLIED_TO_EDL"); }
    catch (reason) { const message = smartCameraErrorMessage(reason); setError(message); onNotify(message, "error"); }
    finally { setBusy(false); }
  };

  const acceptedCount = acceptedCameraSuggestions(document).length;
  const stale = document?.status === "stale";
  const toggleDraft=(item:CameraSuggestion)=>{const next=selected.includes(item.id)?selected.filter(id=>id!==item.id):[...selected,item.id];setSelected(next);const byId=new Set(next);onDraftChange((document?.suggestions??[]).filter(value=>byId.has(value.id)).map(value=>({centerX:value.centerX,centerY:value.centerY,confidence:value.confidence,easing:"ease_in_out",endUs:value.endUs,id:`draft-${value.id}`,mode:value.suggestionType,reason:value.reason,startUs:value.startUs,zoom:value.zoom})));};
  return <Card className="smart-camera-square p-3">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
      <div className="flex items-center gap-3" title="Analiza el video para proponer zooms y reencuadres. No requiere cámara web."><span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-cyan"><Camera size={18} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan">Encuadre inteligente ⓘ</p><h3 className="mt-1 font-bold text-ink">Zoom y seguimiento virtual</h3></div></div>
      <div className="flex flex-wrap gap-2">{busy ? <Button icon={<Square size={14} />} onClick={() => void cancel()} variant="secondary">Cancelar</Button> : <Button icon={<Sparkles size={15} />} onClick={() => void analyze()}>{document ? "Reanalizar" : "Analizar"}</Button>}<Button disabled={busy || stale || acceptedCount === 0} icon={<Check size={15} />} onClick={() => void apply()}>Aplicar aceptadas al EDL</Button></div>
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
          ? "Software: encuadre más activo y estable para zonas de trabajo."
          : contentMode === "gameplay"
            ? "Gameplay: movimientos conservadores para evitar zooms innecesarios."
            : contentMode === "presentation"
              ? "Presentación: prioriza áreas estables de contenido."
              : "Automático: comportamiento general conservador."}
      </p>
    </div>
    {busy && progress ? <div className="mt-5"><div className="mb-2 flex justify-between text-xs text-muted"><span>{stageLabel(progress.stage)}</span><span>{Math.floor(cameraProgressPercent(progress))} %</span></div><div className="h-2 rounded-full bg-canvas"><div className="h-full rounded-full bg-cyan transition-[width]" style={{ width: `${cameraProgressPercent(progress)}%` }} /></div></div> : null}
    {stale ? <p className="mt-4 flex items-center gap-2 text-sm text-warning"><ShieldAlert size={16} />El original cambió. Reanaliza antes de aplicar propuestas anteriores.</p> : null}
    {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
    {document ? <><div className="mt-4 grid grid-cols-2 gap-2"><Stat label="Total" value={document.statistics.total} /><Stat label="Zoom" value={document.statistics.zoom} /><Stat label="Enfoque" value={document.statistics.focus} /><Stat label="Selección" value={selected.length} /></div><p className="mt-3 text-xs text-muted">Marca movimientos para probar 10/30 s sin escribir el EDL.</p><div className="mt-3 max-h-[34rem] space-y-3 overflow-auto pr-1">{document.suggestions.map((item) => <SuggestionCard applied={edl.tracks.camera.some(camera=>camera.id===item.id)} item={item} key={item.id} onPreview={() => preview(item)} onReview={(status) => void review(item, status)} onSeek={() => {onSeek(item.startUs);if(edl.tracks.camera.some(camera=>camera.id===item.id))onSelect?.(item.id);}} onToggle={()=>toggleDraft(item)} selected={selected.includes(item.id)} />)}{document.suggestions.length === 0 ? <p className="rounded-lg border border-line bg-canvas/40 p-4 text-sm text-muted">No se detectaron cambios visuales suficientemente sólidos con este perfil.</p> : null}</div></> : null}
  </Card>;
}

function SuggestionCard({ applied,item,onPreview,onReview,onSeek,onToggle,selected }: { applied:boolean;item: CameraSuggestion; onPreview: () => void; onReview: (status: CameraSuggestionStatus) => void; onSeek: () => void;onToggle:()=>void;selected:boolean }) {
  return <div className="min-w-0 rounded-xl border border-line bg-canvas/45 p-3"><label className="mb-2 flex items-center gap-2 text-xs font-bold text-cyan"><input checked={selected} onChange={onToggle} type="checkbox"/>Incluir en prueba temporal</label><div className="flex flex-wrap items-start justify-between gap-3"><div><span className="inline-block min-w-24 rounded bg-primary/10 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wider text-cyan">{typeLabel(item.suggestionType)}</span><p className="mt-2 break-words font-mono text-[10px] leading-4 text-ink">{formatPlaybackTime(item.startUs)} → {formatPlaybackTime(item.endUs)} · {(item.durationUs / 1_000_000).toFixed(2)} s · {item.zoom.toFixed(2)}×</p><p className="mt-2 max-w-full text-[11px] leading-4 text-muted">{item.reason}</p><p className="mt-2 break-words text-[10px] font-semibold leading-4 text-ink">Centro {Math.round(item.centerX * 100)}%, {Math.round(item.centerY * 100)}% · Confianza {Math.round(item.confidence * 100)}% · {applied?"Aplicada":statusLabel(item.status)}</p></div><div className="flex min-h-10 flex-wrap gap-2"><Button icon={<ExternalLink size={14} />} onClick={onSeek} variant="secondary">Ir</Button><Button icon={<Eye size={14} />} onClick={onPreview} variant="secondary">Previsualizar</Button><Button disabled={item.status === "rejected"} icon={<X size={14} />} onClick={() => onReview("rejected")} variant="secondary">Rechazar</Button><Button disabled={item.status === "accepted"} icon={<Check size={14} />} onClick={() => onReview("accepted")}>Aceptar</Button></div></div></div>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="min-w-0 rounded-lg border border-line bg-canvas/55 p-2.5"><p className="max-w-full text-[9px] font-bold uppercase leading-tight tracking-[0.06em] text-muted">{label}</p><p className="mt-1.5 text-base font-bold leading-none text-ink">{value}</p></div>; }
function typeLabel(type: CameraSuggestionType): string { return { focus: "Enfoque", reset: "Restablecer", zoom: "Zoom" }[type]; }
function statusLabel(status: CameraSuggestionStatus): string { return { accepted: "Aceptada", pending: "Pendiente", rejected: "Rechazada" }[status]; }
function stageLabel(stage: SmartCameraProgress["stage"]): string { return { analyzing_visual_changes: "Analizando cambios visuales", cancelled: "Cancelado", completed: "Completado", consolidating_movements: "Consolidando movimientos", error: "Error", extracting_samples: "Extrayendo muestras", saving: "Guardando smart_camera.json" }[stage]; }
