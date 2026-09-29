import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Expand, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EdlManifest, TitleDecision } from "../../project/contracts";
import { TitlePreview } from "./TitlePreview";
import { editedDurationUs, editedToSourceUs, sourceToEditedUs } from "../../editor/edl";
import { formatPlaybackTime } from "../../playback/time";
import { formatCommandError } from "../../playback/service";
import { previewMatchesProject } from "../../project/isolation";
import type { ProjectContext } from "../../project/isolation";
import type { BackgroundMode, FitMode } from "../../export/models";

const CHUNK_US = 15_000_000;
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
type CameraSample = { timestampUs: number; decisionId: string; stage: string; scale: number; centerX: number; centerY: number };
type Chunk = { projectId: string; sourceId: string; sourcePath: string; edlRevision: string; outputBytes: number; ffmpegExitCode: number | null; cameraSamples: CameraSample[]; path: string; startUs: number; durationUs: number; cacheHit: boolean };

export function ResultPlayer({ context, durationUs, aspectRatio, viewerScale, edl, seekToUs, onTimeChange, onError, onDiagnostic, onReady, volume, muted, onMutedChange, onVolumeChange, playbackRate, onPlaybackRateChange, canvasScale, canvasOffsetX, canvasOffsetY, fitMode, backgroundMode, backgroundColor, pauseEpoch, liveTitle, liveTitleTimeUs }: {
  context: ProjectContext;
  durationUs: number;
  aspectRatio: number;
  viewerScale: number;
  edl: EdlManifest;
  seekToUs?: number | null;
  onTimeChange?: (sourceUs: number) => void;
  onError: (message: string) => void;
  onDiagnostic?: (message: string) => void;
  onReady?: () => void;
  volume: number;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  onVolumeChange: (volume: number) => void;
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
  canvasScale: number;
  canvasOffsetX: number;
  canvasOffsetY: number;
  fitMode: FitMode;
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  pauseEpoch: number;
  liveTitle?: TitleDecision | null;
  liveTitleTimeUs?: number;
}) {
  const projectId = context.canonicalProjectId;
  const sourceId = context.sourceId ?? "";
  const sourcePath = context.sourcePath ?? "";
  const video = useRef<HTMLVideoElement>(null);
  const fallbackVideo = useRef<HTMLVideoElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const next = useRef<Chunk | null>(null);
  const generation = useRef(0);
  const lastRequestId = useRef(0);
  const live = useRef(true);
  const intentPlaying = useRef(false);
  const targetAfterLoad = useRef(0);
  const currentTime = useRef(0);
  const handledSeek = useRef<number | null>(null);
  const [chunk, setChunk] = useState<Chunk | null>(null);
  const [timelineUs, setTimelineUs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);
  const totalUs = editedDurationUs(durationUs, edl.tracks.cuts);
  const size = aspectRatio >= 16 / 9 ? { width: 960, height: Math.max(90, Math.round(960 / aspectRatio / 2) * 2) } : { height: 540, width: Math.max(160, Math.round(540 * aspectRatio / 2) * 2) };
  const { width, height } = size;
  const request = useCallback((startUs: number) => {
    const requestId = lastRequestId.current = Math.max(lastRequestId.current + 1, Date.now() * 1000);
    return invoke<Chunk>("render_result_chunk", { request: { projectId, requestId, startUs, width, height, fps: 30, canvasScale, canvasOffsetX, canvasOffsetY, fitMode, backgroundMode, backgroundColor, edl } });
  }, [projectId, width, height, canvasScale, canvasOffsetX, canvasOffsetY, fitMode, backgroundMode, backgroundColor, edl]);

  const loadAt = useCallback((targetUs: number, resume: boolean) => {
    const bounded = Math.max(0, Math.min(Math.max(0, totalUs - 1), targetUs));
    const start = Math.floor(bounded / CHUNK_US) * CHUNK_US;
    const ticket = ++generation.current;
    intentPlaying.current = resume;
    targetAfterLoad.current = (bounded - start) / 1e6;
    next.current = null;
    video.current?.pause();
    setLoading(true);
    setRenderFailed(false);
    currentTime.current = bounded;
    void invoke("cancel_result_preview", { projectId }).catch(() => {}).then(() => request(start)).then(result => {
      if (!live.current || generation.current !== ticket) return;
      if (!result?.path || result.durationUs <= 0) throw new Error("El preview Resultado no devolvió un archivo reproducible.");
      if (!previewMatchesProject({ projectId, sourceId, sourcePath, edlRevision: edl.updatedAt }, result)) {
        throw new Error(`Preview obsoleto descartado: activeProjectId=${projectId} previewProjectId=${result.projectId} sourceId=${result.sourceId} edlRevision=${result.edlRevision}`);
      }
      const currentVideo = video.current;
      const sameLoadedFile = currentVideo?.currentSrc === convertFileSrc(result.path) && currentVideo.readyState >= HTMLMediaElement.HAVE_METADATA;
      setChunk(result);
      setRenderFailed(false);
      if (sameLoadedFile && currentVideo) {
        currentVideo.currentTime = targetAfterLoad.current;
        if (currentVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !currentVideo.seeking) {
          setLoading(false);
          onReady?.();
        }
        if (intentPlaying.current) void currentVideo.play().catch(() => onError("No se pudo reanudar Resultado."));
      }
      for (const sample of result.cameraSamples ?? []) onDiagnostic?.(`CAMERA_RENDER_SAMPLE canonicalProjectId=${projectId} timestampUs=${sample.timestampUs} decisionId=${sample.decisionId} stage=${sample.stage} scale=${sample.scale.toFixed(3)} centerX=${sample.centerX.toFixed(3)} centerY=${sample.centerY.toFixed(3)} edlRevision=${result.edlRevision}`);
      setTimelineUs(bounded);
      onTimeChange?.(editedToSourceUs(bounded, edl.tracks.cuts, durationUs));
    }).catch(error => { if (live.current && generation.current === ticket) {setLoading(false);if (formatCommandError(error).includes("preview-cancelled")) return;setRenderFailed(true);if (fallbackVideo.current) fallbackVideo.current.currentTime=editedToSourceUs(bounded,edl.tracks.cuts,durationUs)/1e6;onError(`No se pudo preparar Resultado: ${formatCommandError(error, { command: "render_result_chunk", projectId, activeProjectId: projectId, sourcePath, startUs: start, durationUs: CHUNK_US, edlRevision: edl.updatedAt })}`);} });
  }, [durationUs, edl, onDiagnostic, onError, onReady, onTimeChange, projectId, request, sourceId, sourcePath, totalUs]);

  useEffect(() => { const generationRef = generation; const videoNode = video.current; live.current = true; next.current = null; loadAt(currentTime.current, intentPlaying.current); return () => {live.current = false;generationRef.current++;next.current=null;videoNode?.pause();void invoke("cancel_result_preview", {projectId}).catch(() => {});}; }, [loadAt, projectId]);
  useEffect(() => { if (seekToUs == null || handledSeek.current === seekToUs) return; handledSeek.current = seekToUs; const target = sourceToEditedUs(seekToUs, edl.tracks.cuts, durationUs) ?? 0; const current = chunk && target >= chunk.startUs && target < chunk.startUs + chunk.durationUs; if (current && video.current) {video.current.currentTime = (target - chunk.startUs) / 1e6;setTimelineUs(target);} else loadAt(target, intentPlaying.current); }, [seekToUs,chunk,durationUs,edl.tracks.cuts,loadAt]);
  useEffect(() => { if (video.current) { video.current.volume=Math.max(0,Math.min(1,volume));video.current.muted=muted;video.current.playbackRate=playbackRate; } }, [chunk,volume,muted,playbackRate]);
  useEffect(() => { if (pauseEpoch > 0) {intentPlaying.current=false;video.current?.pause();} }, [pauseEpoch]);

  const preloadNext = useCallback(() => {
    if (!chunk || next.current || chunk.startUs + chunk.durationUs >= totalUs) return;
    const ticket = generation.current;
    void request(chunk.startUs + chunk.durationUs).then(value => { if (live.current && generation.current === ticket && previewMatchesProject({ projectId, sourceId, sourcePath, edlRevision: edl.updatedAt }, value) && chunk.startUs + chunk.durationUs === value.startUs) next.current=value; }).catch(() => {});
  }, [chunk,edl.updatedAt,projectId,request,sourceId,sourcePath,totalUs]);
  const advance = () => {
    if (next.current) {const value=next.current;next.current=null;targetAfterLoad.current=0;setChunk(value);}
    else if (chunk && chunk.startUs + chunk.durationUs < totalUs) loadAt(chunk.startUs + chunk.durationUs,true);
    else {intentPlaying.current=false;setPlaying(false);}
  };
  const toggle = async () => { if (!video.current) return; if (video.current.paused) {intentPlaying.current=true;try {await video.current.play();} catch {onError("No se pudo iniciar la vista Resultado.");}} else {intentPlaying.current=false;video.current.pause();} };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target=event.target;
      if (target instanceof HTMLElement && (target.matches("input,textarea,select") || target.isContentEditable)) return;
      if (event.code==="Space") {event.preventDefault();void toggle();}
      else if (event.key==="ArrowLeft" || event.key==="ArrowRight") {event.preventDefault();loadAt(timelineUs+(event.key==="ArrowRight"?1_000_000:-1_000_000),intentPlaying.current);}
    };
    window.addEventListener("keydown",key);
    return () => window.removeEventListener("keydown",key);
  });
  return <div className="video-player" ref={holder}>
    <div className="video-stage-shell"><div className="video-stage relative grid place-items-center overflow-hidden bg-black" style={{aspectRatio,width:`min(${viewerScale}%, 100%)`}}>
      {chunk ? <video className="h-full w-full object-contain" key={chunk.path} ref={video} src={convertFileSrc(chunk.path)} preload="auto" onLoadedMetadata={event => {event.currentTarget.currentTime=targetAfterLoad.current;preloadNext();if(intentPlaying.current)void event.currentTarget.play().catch(() => onError("No se pudo reanudar Resultado."));}} onCanPlay={() => {if(chunk.edlRevision===edl.updatedAt){setLoading(false);onReady?.();}}} onTimeUpdate={event => {const value=Math.min(totalUs,chunk.startUs+Math.round(event.currentTarget.currentTime*1e6));currentTime.current=value;setTimelineUs(value);onTimeChange?.(editedToSourceUs(value,edl.tracks.cuts,durationUs));}} onEnded={advance} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onClick={()=>void toggle()} onError={event=>onError(`No se pudo reproducir el chunk procesado: ${formatCommandError(event.currentTarget.error?.message ?? "Error del reproductor", { projectId, activeProjectId: projectId, sourcePath: chunk.sourcePath, chunkStartUs: chunk.startUs, chunkEndUs: chunk.startUs + chunk.durationUs, edlRevision: chunk.edlRevision, cacheHit: chunk.cacheHit, ffmpegExitCode: chunk.ffmpegExitCode ?? "cached", mediaErrorCode: event.currentTarget.error?.code, outputPath: chunk.path, outputExists: chunk.outputBytes > 0, outputBytes: chunk.outputBytes })}`)}/> : <video aria-label="Fotograma original mientras se prepara Resultado" className="h-full w-full object-contain" muted ref={fallbackVideo} src={convertFileSrc(sourcePath)} preload="metadata" onLoadedMetadata={event=>{event.currentTarget.currentTime=editedToSourceUs(currentTime.current,edl.tracks.cuts,durationUs)/1e6;}}/>}
      {liveTitle ? <TitlePreview aspectRatio={aspectRatio} title={liveTitle} timeUs={liveTitleTimeUs ?? 0}/> : null}
      {loading ? <span className="player-loading">Actualizando Resultado…</span> : null}{renderFailed ? <span className="player-loading" role="alert">No se pudo actualizar Resultado · {chunk ? "se muestra el último bloque válido" : "se muestra el video original"}</span> : null}<span className="player-source-badge">{renderFailed ? "RESULTADO ANTERIOR" : "RESULTADO"} · {chunk?.cacheHit ? "CACHÉ" : "EDL"}</span>
    </div></div>
    <div className="player-bottom"><div className="player-progress-shell"><input aria-label="Posición del resultado" className="player-progress" max={Math.max(1,totalUs)} min={0} onChange={event=>loadAt(Number(event.target.value),intentPlaying.current)} step={1000} type="range" value={timelineUs}/></div><div className="player-controlbar"><div className="player-time"><strong>{formatPlaybackTime(timelineUs)}</strong><span>/</span><span>{formatPlaybackTime(totalUs)}</span></div><div className="player-center"><button aria-label={playing?"Pausar":"Reproducir"} className="player-play" onClick={()=>void toggle()} type="button">{playing?<Pause fill="currentColor" size={16}/>:<Play fill="currentColor" size={16}/>}</button></div><div className="player-right"><button aria-label={muted?"Activar audio":"Silenciar"} className="player-icon-button" onClick={()=>onMutedChange(!muted)} type="button">{muted?<VolumeX size={15}/>:<Volume2 size={15}/>}</button><input aria-label="Volumen Resultado" className="player-volume" max={1} min={0} onChange={event=>onVolumeChange(Number(event.target.value))} step={0.01} type="range" value={muted?0:volume}/><span className="player-volume-value">{Math.round((muted?0:volume)*100)}%</span><select aria-label="Velocidad de reproducción" className="player-rate" onChange={event=>onPlaybackRateChange(Number(event.target.value))} value={playbackRate}>{PLAYBACK_RATES.map(rate=><option key={rate} value={rate}>{rate}x</option>)}</select><button aria-label="Pantalla completa" className="player-icon-button" onClick={()=>void holder.current?.requestFullscreen()} type="button"><Expand size={15}/></button></div></div></div>
  </div>;
}
