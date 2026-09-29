import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, FolderOpen, ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProjectBundle } from "../../project/contracts";
import { formatFileSize } from "../../lib/format";
import { formatTimecode } from "../../editor/timecode";
import { canLoadTimelineVisuals, timelineThumbnail } from "../../editor/visuals";
import { editedDurationUs } from "../../editor/edl";
import { canvasTranslationPercent } from "../../editor/layout";
import { estimatedSizeBytes, exportDimensions, presetSettings, recommendedPreset, validateExportConfig, type BackgroundMode, type ExportBitrate, type ExportFps, type ExportPreset, type ExportProgress, type ExportResolution, type ExportResult, type FitMode } from "../../export/models";
import { measuredRenderProgress } from "../../export/progress";
import { cancelExport, exportErrorMessage, onExportProgress, openExportFile, revealExportFile, startExport } from "../../export/service";
import { coverPlacement, exportProjectCover, getProjectCover, removeProjectCover, saveProjectCover, type ProjectCover } from "../../export/cover";
import { detectHardwareProfile, exportDiskSpace, type HardwareProfile } from "../../hardware/profile";
import { playbackAssetUrl } from "../../playback/service";
import { Button } from "../Button";
import { Modal } from "../Modal";

interface Props {
  aspectRatio: number;
  canvasOffsetX: number;
  canvasOffsetY: number;
  canvasScale: number;
  fitMode: FitMode;
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  bundle: ProjectBundle;
  edl: ProjectBundle["edl"];
  onClose: () => void;
  open: boolean;
}

function suggestedOutputPath(sourcePath: string, name: string) {
  const folder = sourcePath.replace(/[\\/][^\\/]+$/, "");
  return folder ? `${folder}\\${name}.mp4` : `${name}.mp4`;
}

function outputWithName(path: string, name: string) {
  const safe = name.trim().replace(/[<>:"/\\|?*]+/g, "_");
  return path.replace(/[^\\/]+$/, `${safe}.mp4`);
}

export function ExportModal({ aspectRatio, bundle, canvasOffsetX, canvasOffsetY, canvasScale, fitMode, backgroundMode, backgroundColor, edl, onClose, open }: Props) {
  const initialName = `${bundle.project.name.replace(/[^\w-]+/g, "_")}_editado`;
  const [name, setName] = useState(initialName);
  const [path, setPath] = useState(() => {
    const folder = localStorage.getItem("cheto-video-ai.default-export-folder");
    return folder ? `${folder.replace(/[\\/]$/, "")}\\${initialName}.mp4` : suggestedOutputPath(bundle.source.path, initialName);
  });
  const [resolution, setResolution] = useState<ExportResolution>("original");
  const [fps, setFps] = useState<ExportFps>("original");
  const [bitrate, setBitrate] = useState<ExportBitrate>("auto");
  const [audio, setAudio] = useState(bundle.source.audio.present);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [lastExport, setLastExport] = useState<{ path: string; completedAt: number; status: "completada" | "fallida" } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [profile, setProfile] = useState<HardwareProfile | null>(null);
  const [freeBytes, setFreeBytes] = useState(0);
  const [preset, setPreset] = useState<ExportPreset>("balanced");
  const [cover, setCover] = useState<ProjectCover | null>(null);
  const [exportCover, setExportCover] = useState(false);
  const [coverOutput, setCoverOutput] = useState<string | null>(null);
  const [coverImageRatio, setCoverImageRatio] = useState(1);
  const presetTouched = useRef(false);
  const coverSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const coverRevision = useRef(0);

  const sourceWidth = bundle.source.video.displayWidth ?? bundle.source.video.width ?? 1920;
  const sourceHeight = bundle.source.video.displayHeight ?? bundle.source.video.height ?? 1080;
  const dimensions = useMemo(() => exportDimensions(resolution, sourceWidth, sourceHeight, aspectRatio), [aspectRatio, resolution, sourceHeight, sourceWidth]);
  const effectiveFps = fps === "original" ? bundle.source.video.fps.decimal ?? 30 : Number(fps);
  const durationUs = editedDurationUs(bundle.source.durationUs ?? 0, edl.tracks.cuts);
  const effectiveAudio = audio && edl.audioOnTimeline !== false;
  const estimate = estimatedSizeBytes(durationUs, bitrate, effectiveAudio);
  const measured = progress ? measuredRenderProgress(progress.processedUs, progress.durationUs, elapsed) : null;
  const recommendation = profile ? recommendedPreset(profile, sourceWidth, sourceHeight, durationUs, freeBytes) : null;
  const presetLabels: Record<ExportPreset, string> = { fast: "Rápido", balanced: "Equilibrado", high: "Alta calidad", maximum: "Máxima calidad", custom: "Personalizado" };

  useEffect(() => {
    if (!open) return;
    let active = true;
    void detectHardwareProfile().then(value => { if (active) setProfile(value); }).catch(() => { if (active) setProfile(null); });
    void getProjectCover(bundle.project.projectId).then(value => { if (active) setCover(value); }).catch(() => { if (active) setCover(null); });
    return () => { active = false; };
  }, [open, bundle.project.projectId]);

  useEffect(() => {
    if (!open || !path) return;
    let active = true;
    void exportDiskSpace(path).then(([bytes]) => { if (active) setFreeBytes(bytes); }).catch(() => { if (active) setFreeBytes(0); });
    return () => { active = false; };
  }, [open, path]);

  useEffect(() => {
    if (!recommendation || presetTouched.current) return;
    const options = presetSettings(recommendation);
    setPreset(recommendation);
    setResolution(options.resolution);
    setBitrate(options.bitrate);
  }, [recommendation, sourceHeight]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onExportProgress((value) => {
      if (!disposed && value.projectId === bundle.project.projectId) setProgress(value);
    }).then((value) => { if (disposed) value(); else unlisten = value; });
    return () => { disposed = true; unlisten?.(); };
  }, [bundle.project.projectId, open]);

  useEffect(() => {
    if (!open || !canLoadTimelineVisuals()) return;
    let disposed = false;
    const timeUs = Math.min(Math.round((bundle.source.durationUs ?? 0) * 0.1), 10_000_000);
    void timelineThumbnail(bundle.project.projectId, timeUs).then((url) => { if (!disposed) setPreviewUrl(url); }).catch(() => { if (!disposed) setPreviewUrl(null); });
    return () => { disposed = true; };
  }, [bundle.project.projectId, bundle.source.durationUs, open]);

  useEffect(() => {
    if (!busy || startedAt === null) return;
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy, startedAt]);

  const changeName = (value: string) => {
    setName(value);
    setPath((current) => outputWithName(current, value));
  };

  const browse = async () => {
    setError(null);
    try {
      const selected = await save({ defaultPath: path || suggestedOutputPath(bundle.source.path, name), filters: [{ name: "Video MP4", extensions: ["mp4"] }] });
      if (selected) {
        const next = selected.toLowerCase().endsWith(".mp4") ? selected : `${selected}.mp4`;
        setPath(next);
        setName(next.replace(/^.*[\\/]/, "").replace(/\.mp4$/i, ""));
      }
    } catch (reason) { setError(`No se pudo abrir el selector de destino: ${exportErrorMessage(reason)}`); }
  };

  const chooseCover = async () => {
    try {
      const selected = await openDialog({ multiple: false, filters: [{ name: "Imagen", extensions: ["jpg", "jpeg", "png", "webp"] }] });
      if (!selected || Array.isArray(selected)) return;
      ++coverRevision.current;
      await coverSaveQueue.current.catch(() => undefined);
      setCover(await saveProjectCover(bundle.project.projectId, { path: selected, fit: cover?.fit ?? "cover", scale: cover?.scale ?? 1, offsetX: cover?.offsetX ?? 0, offsetY: cover?.offsetY ?? 0 }));
      setError(null);
    } catch (reason) { setError(`No se pudo guardar la portada: ${exportErrorMessage(reason)}`); }
  };

  const changeCover = (next: ProjectCover) => {
    const revision = ++coverRevision.current;
    setCover(next);
    coverSaveQueue.current = coverSaveQueue.current.catch(() => undefined).then(async () => {
      const saved = await saveProjectCover(bundle.project.projectId, next);
      if (revision === coverRevision.current) setCover(saved);
    }).catch(reason => { if (revision === coverRevision.current) setError(`No se pudo ajustar la portada: ${exportErrorMessage(reason)}`); throw reason; });
  };

  const deleteCover = async () => {
    try { ++coverRevision.current; await coverSaveQueue.current.catch(() => undefined); await removeProjectCover(bundle.project.projectId); setCover(null); setExportCover(false); }
    catch (reason) { setError(`No se pudo quitar la portada: ${exportErrorMessage(reason)}`); }
  };

  const applyPreset = (next: ExportPreset) => {
    presetTouched.current = true;
    setPreset(next);
    if (next === "custom") return;
    const options = presetSettings(next);
    setResolution(options.resolution);
    setBitrate(options.bitrate);
    setFps("original");
  };

  const run = async () => {
    const config = { aspectRatio, bitrate, canvasOffsetX, canvasOffsetY, canvasScale, fitMode, backgroundMode, backgroundColor, fps: effectiveFps, height: dimensions.height, includeAudio: effectiveAudio, outputPath: path, preset, projectId: bundle.project.projectId, width: dimensions.width };
    const issue = !name.trim() ? "Escribe un título para el video." : validateExportConfig(config);
    if (issue) { setError(issue); return; }
    setBusy(true); setStartedAt(Date.now()); setElapsed(0); setProgress(null); setError(null); setResult(null); setCopied(false);
    try {
      await coverSaveQueue.current;
      const completed = await startExport(config);
      setResult(completed);
      setLastExport({ path: completed.outputPath, completedAt: Date.now(), status: "completada" });
      if (cover && exportCover) {
        const imagePath = completed.outputPath.replace(/\.mp4$/i, ".cover.jpg");
        try { setCoverOutput(await exportProjectCover(bundle.project.projectId, imagePath, dimensions.width, dimensions.height)); }
        catch (reason) { setError(`Video exportado. No se pudo generar el JPG de portada: ${exportErrorMessage(reason)}`); }
      }
    }
    catch (reason) { setLastExport({ path, completedAt: Date.now(), status: "fallida" }); setError(exportErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const close = () => { if (!busy) onClose(); };

  return <Modal description="Render local no destructivo mediante FFmpeg." onClose={close} open={open} size="large" title="Exportar video">
    {busy ? <div className="export-state">
      <p className="text-[11px] font-semibold text-ink">{progress?.stage === "preparing" || !progress ? "Preparando exportación" : "Exportando video"}</p>
      <strong className="mt-5 block font-mono text-[34px] text-ink">{Math.floor(progress?.progress ?? 0)}%</strong>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full bg-cyan transition-[width]" style={{ width: `${progress?.progress ?? 0}%` }}/></div>
      <p className="mt-3 font-mono text-[9px] text-muted">{formatTimecode(progress?.processedUs ?? 0)} / {formatTimecode(progress?.durationUs ?? durationUs)}</p>
      <p className="mt-2 text-[9px] text-muted">Velocidad: {measured ? `${measured.speed.toFixed(2)}× tiempo real` : "Calculando…"} · {elapsed} s transcurridos · {measured ? `~${measured.remainingSeconds} s restantes` : "Calculando tiempo restante"}</p>
      <div className="mt-6 flex justify-end"><Button onClick={() => void cancelExport(bundle.project.projectId)} variant="danger">Cancelar exportación</Button></div>
    </div> : result ? <div className="export-state">
      <div className="flex items-center gap-2 text-success"><CheckCircle2 size={18}/><strong className="text-[13px]">Exportación completada</strong></div>
      <p className="mt-4 text-[10px] font-semibold text-ink">Archivo:</p><p className="mt-1 break-all font-mono text-[10px] text-ink/75">{result.outputPath}</p>
      <p className="mt-2 text-[9px] text-muted">{result.encoder} · {formatFileSize(result.fileSizeBytes)}</p>
      {coverOutput ? <p className="mt-2 break-all text-[9px] text-muted">Portada JPG: {coverOutput}</p> : null}
      {error ? <p className="mt-2 text-[9px] text-warning">{error}</p> : null}
      <div className="mt-6 flex flex-wrap justify-end gap-2"><Button onClick={() => void openExportFile(result.outputPath)} variant="secondary">Abrir archivo</Button><Button onClick={() => void revealExportFile(result.outputPath)} variant="secondary">Abrir carpeta</Button><Button onClick={() => void navigator.clipboard.writeText(result.outputPath).then(() => setCopied(true)).catch(reason => setError(`No se pudo copiar la ruta: ${exportErrorMessage(reason)}`))} variant="secondary">{copied ? "Ruta copiada" : "Copiar ruta"}</Button><Button onClick={close}>Cerrar</Button></div>
    </div> : <div className="export-form">
      <div className="export-layout">
        <div className="export-preview">
          <div className="export-preview-frame" style={{ aspectRatio, position: "relative", backgroundColor: fitMode==="center"&&backgroundMode==="color"?backgroundColor:"#000000" }}>{previewUrl ? <>{fitMode==="center"&&backgroundMode==="blur"?<img alt="" aria-hidden="true" src={previewUrl} style={{position:"absolute",inset:0,objectFit:"cover",filter:"blur(18px) brightness(0.7)",transform:"scale(1.12)"}}/>:null}<img alt="Fotograma real con el encuadre del lienzo" src={previewUrl} style={{position:"relative",objectFit:fitMode==="cover"?"cover":"contain",objectPosition:canvasScale===1?`${50+canvasOffsetX*50}% ${50+canvasOffsetY*50}%`:"50% 50%",transform:`translate(${canvasTranslationPercent(canvasScale,canvasOffsetX)}%, ${canvasTranslationPercent(canvasScale,canvasOffsetY)}%) scale(${canvasScale})`}}/></> : <p>Vista previa no disponible</p>}</div>
          <p className="mt-2 truncate text-[9px] font-medium text-ink/80" title={bundle.source.fileName}>{bundle.source.fileName}</p>
          <p className="mt-1 text-[8px] text-muted">{dimensions.width} × {dimensions.height} · {effectiveFps.toFixed(2)} FPS</p>
          <section className="export-cover-section">
            <div className="flex items-center justify-between gap-2"><strong>Portada del proyecto</strong><div className="flex gap-1"><Button icon={<ImagePlus size={12}/>} onClick={() => void chooseCover()} variant="secondary">{cover ? "Reemplazar" : "Elegir"}</Button>{cover ? <Button aria-label="Quitar portada" icon={<Trash2 size={12}/>} onClick={() => void deleteCover()} variant="ghost">Quitar</Button> : null}</div></div>
            {cover ? <>
              <div className="export-cover-frame" style={{ aspectRatio }}><img alt="Portada del proyecto" onLoad={event => setCoverImageRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} src={playbackAssetUrl(cover.path)} style={coverPlacement(coverImageRatio, aspectRatio, cover)}/></div>
              <div className="export-cover-controls"><label>Ajuste <select className="cheto-input" onChange={event => void changeCover({ ...cover, fit: event.target.value as ProjectCover["fit"] })} value={cover.fit}><option value="cover">Cubrir</option><option value="contain">Contener</option></select></label><label>Escala <input aria-label="Escala de portada" max="2.5" min="0.5" onChange={event => void changeCover({ ...cover, scale: Number(event.target.value) })} step="0.05" type="range" value={cover.scale}/></label><label>X <input aria-label="Posición X de portada" max="1" min="-1" onChange={event => void changeCover({ ...cover, offsetX: Number(event.target.value) })} step="0.05" type="range" value={cover.offsetX}/></label><label>Y <input aria-label="Posición Y de portada" max="1" min="-1" onChange={event => void changeCover({ ...cover, offsetY: Number(event.target.value) })} step="0.05" type="range" value={cover.offsetY}/></label></div>
              <label className="export-cover-toggle"><input checked={exportCover} onChange={event => setExportCover(event.target.checked)} type="checkbox"/> Exportar JPG junto al MP4</label>
              <p className="text-[8px] text-muted">La portada queda en el proyecto. El JPG asociado no se incrusta en el MP4.</p>
            </> : <p className="mt-2 text-[8px] text-muted">Elige una imagen para previsualizarla y ajustarla.</p>}
          </section>
        </div>
        <div className="export-settings">
          <Field label="Título"><input className="cheto-input" onChange={(event) => changeName(event.currentTarget.value)} value={name}/></Field>
          <Field label="Guardar en"><div className="flex min-w-0 gap-1.5"><input aria-label="Ruta exacta de exportación" className="cheto-input min-w-0 flex-1" onChange={(event) => setPath(event.currentTarget.value)} title={path} value={path}/><Button aria-label="Cambiar ubicación y nombre de exportación" icon={<FolderOpen size={14}/>} onClick={() => void browse()} variant="secondary">Cambiar ubicación</Button></div></Field>
          <p className="break-all font-mono text-[9px] text-ink" data-testid="export-exact-path">Archivo final: {path}</p>
          {lastExport ? <p className="break-all text-[9px] text-muted">Última exportación de esta sesión: {new Date(lastExport.completedAt).toLocaleString()} · {lastExport.status} · {lastExport.path}</p> : null}
          <h3 className="export-section-title">Exportación de video</h3>
          <div className="export-recommendation"><strong>{recommendation ? `Recomendado para tu PC: ${presetLabels[recommendation]}` : "Analizando recomendación local…"}</strong><span>{dimensions.width} × {dimensions.height} · {effectiveFps.toFixed(2)} FPS · H.264 · {profile?.nvencAvailable && (preset === "fast" || preset === "balanced") ? "NVENC validado" : "libx264 (CPU)"}</span><small>El perfil Rápido conserva la resolución original. La aceleración se usa cuando pasó la prueba de codificación.</small></div>
          <Field label="Calidad"><select className="cheto-input" onChange={event => applyPreset(event.target.value as ExportPreset)} value={preset}>{(Object.keys(presetLabels) as ExportPreset[]).map(value => <option key={value} value={value}>{presetLabels[value]}{value === recommendation ? " · Recomendado" : ""}</option>)}</select></Field>
          <div className="export-option-grid">
            <Field label="Resolución"><select className="cheto-input" onChange={(event) => { presetTouched.current = true; setResolution(event.currentTarget.value as ExportResolution); setPreset("custom"); }} value={resolution}><option value="original">Original · {sourceWidth} × {sourceHeight}</option><option value="480">480p</option><option value="720">720p</option><option value="1080">1080p</option><option value="1440">1440p</option><option value="2160">2160p / 4K</option></select></Field>
            <Field label="Tasa de bits"><select className="cheto-input" onChange={(event) => { presetTouched.current = true; setBitrate(event.currentTarget.value as ExportBitrate); setPreset("custom"); }} value={bitrate}><option value="auto">Automática</option><option value="low">Baja</option><option value="medium">Recomendada</option><option value="high">Alta</option><option value="max">Máxima</option></select></Field>
            <Field label="Códec"><output className="cheto-input">H.264</output></Field>
            <Field label="Formato"><output className="cheto-input">MP4</output></Field>
            <Field label="Cuadros por segundo"><select className="cheto-input" onChange={(event) => { presetTouched.current = true; setFps(event.currentTarget.value as ExportFps); setPreset("custom"); }} value={fps}><option value="original">Original · {(bundle.source.video.fps.decimal ?? 30).toFixed(2)} FPS</option>{[24,25,30,50,60].map((value) => <option key={value} value={value}>{value} FPS</option>)}</select></Field>
            <Field label="Espacio cromático"><output className="cheto-input">YUV 4:2:0 · salida MP4</output></Field>
          </div>
          {dimensions.width > sourceWidth || dimensions.height > sourceHeight ? <p className="mt-2 text-[8px] text-warning">Escalado: aumentar la resolución no recupera detalle inexistente en la fuente.</p> : null}
          {effectiveFps > (bundle.source.video.fps.decimal ?? 30) + 0.01 ? <p className="text-[8px] text-warning">Subir FPS duplica cuadros; no crea movimiento nuevo por interpolación.</p> : null}
          {preset === "maximum" ? <p className="text-[8px] text-warning">Máxima calidad puede tardar considerablemente más en videos largos.</p> : null}
          <div className="export-audio-row"><span>Exportar audio <small>{edl.audioOnTimeline === false ? "Fuera de timeline" : "AAC"}</small></span><input aria-label="Exportar audio" checked={effectiveAudio} disabled={!bundle.source.audio.present || edl.audioOnTimeline === false} onChange={(event) => setAudio(event.currentTarget.checked)} type="checkbox"/></div>
        </div>
      </div>
      {error ? <p className="mt-3 rounded-md bg-danger/[0.07] p-2 text-[9px] text-danger">{error}</p> : null}
      <footer className="export-footer"><div><span>Duración <strong>{formatTimecode(durationUs)}</strong></span><span>Tamaño aprox. <strong>{formatFileSize(estimate)}</strong></span><span>Libre <strong>{freeBytes ? formatFileSize(freeBytes) : "Sin dato"}</strong></span>{freeBytes > 0 && estimate > freeBytes ? <span className="text-warning">Espacio insuficiente</span> : null}</div><div className="flex gap-2"><Button onClick={close} variant="secondary">Cancelar</Button><Button disabled={!path || (freeBytes > 0 && estimate > freeBytes)} onClick={() => void run()}>Exportar</Button></div></footer>
    </div>}
  </Modal>;
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return <label className="export-field min-w-0"><span>{label}</span>{children}</label>;
}
