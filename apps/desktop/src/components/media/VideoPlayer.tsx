import { Expand, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PlaybackKind, PlaybackState } from "../../playback/models";
import { nextPlaybackState } from "../../playback/models";
import { playbackAssetUrl } from "../../playback/service";
import { clampTimelineUs, formatPlaybackTime, SEEK_STEP_US, usToSeconds, secondsToUs } from "../../playback/time";
import { activeCameraAt, type CameraPreview } from "../../smart-camera/models";
import type { EdlManifest } from "../../project/contracts";
import { activeCameraAt as activeEdlCameraAt, cutAt, editedDurationUs, editedToSourceUs, effectiveTracks, sourceToEditedUs, type DraftTracks, type PreviewRange } from "../../editor/edl";

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

interface VideoPlayerProps {
  aspectRatio: number;
  cameraPreview?: CameraPreview | null;
  draftRange?: PreviewRange | null;
  draftTracks?: DraftTracks | null;
  durationUs: number;
  edl: EdlManifest;
  kind: PlaybackKind;
  onError: (message: string) => void;
  path: string;
  mode: "original" | "result";
  onTimeChange?: (sourceUs: number) => void;
  seekToUs?: number | null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select") || target.isContentEditable;
}

export function VideoPlayer({ aspectRatio, cameraPreview, draftRange, draftTracks, durationUs, edl, kind, mode, onError, onTimeChange, path, seekToUs }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [playheadUs, setPlayheadUs] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const assetUrl = playbackAssetUrl(path);
  const tracks = useMemo(() => effectiveTracks(edl, draftTracks ?? null, draftRange ?? null), [draftRange, draftTracks, edl]);
  const resultDurationUs = mode === "result" ? editedDurationUs(durationUs, tracks.cuts) : durationUs;

  const seek = useCallback((targetUs: number) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = clampTimelineUs(targetUs, durationUs);
    video.currentTime = usToSeconds(clamped);
    setPlayheadUs(clamped);
    onTimeChange?.(clamped);
  }, [durationUs, onTimeChange]);

  const seekTimeline = useCallback((targetUs: number) => seek(mode === "result" ? editedToSourceUs(targetUs, tracks.cuts, durationUs) : targetUs), [durationUs, mode, seek, tracks.cuts]);

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (video.paused || video.ended) await video.play();
      else video.pause();
    } catch {
      setPlaybackState(nextPlaybackState(playbackState, "fail"));
      onError("El WebView no pudo iniciar la reproducción del archivo local.");
    }
  }, [onError, playbackState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        void togglePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekTimeline((mode === "result" ? sourceToEditedUs(playheadUs, tracks.cuts, durationUs) ?? 0 : playheadUs) - SEEK_STEP_US);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seekTimeline((mode === "result" ? sourceToEditedUs(playheadUs, tracks.cuts, durationUs) ?? 0 : playheadUs) + SEEK_STEP_US);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [durationUs, mode, playheadUs, seekTimeline, togglePlayback, tracks.cuts]);

  useEffect(() => {
    if (seekToUs === null || seekToUs === undefined || !videoRef.current) return;
    seek(seekToUs);
  }, [seek, seekToUs]);

  const changeVolume = (value: number) => {
    const next = Math.min(1, Math.max(0, value));
    setVolume(next);
    setMuted(next === 0);
    if (videoRef.current) {
      videoRef.current.volume = next;
      videoRef.current.muted = next === 0;
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
  };

  const changeRate = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate;
  };

  const requestFullscreen = async () => {
    try { await containerRef.current?.requestFullscreen(); }
    catch { onError("El modo de pantalla completa no está disponible en este WebView."); }
  };

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const previewCamera = activeCameraAt(cameraPreview ?? null, playheadUs);
  const edlCamera = mode === "result" ? activeEdlCameraAt(tracks.camera, playheadUs) : null;
  const activeCamera = previewCamera ?? (edlCamera ? { centerX: edlCamera.centerX ?? .5, centerY: edlCamera.centerY ?? .5, endUs: edlCamera.endUs, id: edlCamera.id, startUs: edlCamera.startUs, transitionUs: edlCamera.transitionUs ?? 500_000, zoom: edlCamera.zoom ?? 1 } : null);
  const timelineUs = mode === "result" ? sourceToEditedUs(playheadUs, tracks.cuts, durationUs) ?? 0 : playheadUs;

  const updatePlayhead = (sourceUs: number, video: HTMLVideoElement) => {
    if (mode === "result") {
      const removed = cutAt(tracks.cuts, sourceUs, durationUs);
      if (removed) { video.currentTime = usToSeconds(removed.endUs); sourceUs = removed.endUs; }
      if (draftRange && sourceUs >= draftRange.endUs) { video.pause(); sourceUs = draftRange.endUs; video.currentTime = usToSeconds(sourceUs); }
    }
    const value = clampTimelineUs(sourceUs, durationUs); setPlayheadUs(value); onTimeChange?.(value);
  };

  return (
    <div className="video-player overflow-hidden border border-line bg-black shadow-2xl" ref={containerRef}>
      <div className="video-stage-shell">
      <div className="video-stage relative grid place-items-center overflow-hidden bg-black" style={{ aspectRatio, width: `min(100%, calc(52vh * ${aspectRatio}))` }}>
        <video
          className={`h-full w-full ${mode === "result" ? "object-cover" : "object-contain"} will-change-transform`}
          onClick={() => void togglePlayback()}
          onEnded={() => setPlaybackState(nextPlaybackState(playbackState, "end"))}
          onError={() => { setPlaybackState("error"); onError("No se pudo decodificar la fuente de reproducción."); }}
          onLoadedMetadata={() => setPlaybackState(nextPlaybackState(playbackState, "ready"))}
          onPause={() => { if (!videoRef.current?.ended) setPlaybackState(nextPlaybackState(playbackState, "pause")); }}
          onPlay={() => setPlaybackState(nextPlaybackState(playbackState, "play"))}
          onTimeUpdate={(event) => updatePlayhead(secondsToUs(event.currentTarget.currentTime), event.currentTarget)}
          onWaiting={() => setPlaybackState("loading")}
          preload="metadata"
          ref={videoRef}
          src={assetUrl}
          style={{
            transform: `scale(${activeCamera?.zoom ?? 1})`,
            transformOrigin: `${(activeCamera?.centerX ?? 0.5) * 100}% ${(activeCamera?.centerY ?? 0.5) * 100}%`,
            transition: `transform ${Math.max(0, activeCamera?.transitionUs ?? cameraPreview?.transitionUs ?? 0) / 1_000_000}s ease-in-out`,
          }}
        />
        <span className="absolute left-4 top-4 rounded-md border border-white/15 bg-black/65 px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] text-white backdrop-blur">{kind.toUpperCase()}</span>
        {playbackState === "loading" ? <span className="absolute rounded-full bg-black/70 px-4 py-2 text-xs font-semibold text-white">Cargando…</span> : null}
        {activeCamera ? <span className="absolute right-4 top-4 rounded-md border border-cyan/30 bg-black/65 px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-cyan backdrop-blur">ENCUADRE {activeCamera.zoom.toFixed(2)}×</span> : null}
      </div>
      </div>
      <div className="relative z-10 border-t border-white/10 bg-surface px-3 py-2.5">
        <input
          aria-label="Posición del video"
          className="h-1.5 w-full cursor-pointer accent-cyan"
          max={Math.max(1, resultDurationUs)}
          min="0"
          onChange={(event) => seekTimeline(Number(event.currentTarget.value))}
          step="1000"
          type="range"
          value={timelineUs}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <PlayerButton label="Inicio" onClick={() => seekTimeline(0)}><SkipBack size={17} /></PlayerButton>
          <PlayerButton label="Retroceder 5 segundos" onClick={() => seekTimeline(timelineUs - SEEK_STEP_US)}><RotateCcw size={17} /></PlayerButton>
          <button aria-label={playbackState === "playing" ? "Pausar" : "Reproducir"} className="grid h-9 w-9 place-items-center rounded-full bg-primary text-white transition hover:bg-primary-hover" onClick={() => void togglePlayback()} type="button">
            {playbackState === "playing" ? <Pause fill="currentColor" size={17} /> : <Play fill="currentColor" size={17} />}
          </button>
          <PlayerButton label="Avanzar 5 segundos" onClick={() => seekTimeline(timelineUs + SEEK_STEP_US)}><RotateCw size={17} /></PlayerButton>
          <PlayerButton label="Final" onClick={() => seekTimeline(resultDurationUs)}><SkipForward size={17} /></PlayerButton>
          <span className="ml-1 min-w-[145px] font-mono text-xs font-semibold text-ink">{formatPlaybackTime(timelineUs)} / {formatPlaybackTime(resultDurationUs)}</span>
          <div className="ml-auto flex items-center gap-2">
            <PlayerButton label={muted ? "Activar sonido" : "Silenciar"} onClick={toggleMute}><VolumeIcon size={17} /></PlayerButton>
            <input aria-label="Volumen" className="w-20 accent-cyan" max="1" min="0" onChange={(event) => changeVolume(Number(event.currentTarget.value))} step="0.01" type="range" value={muted ? 0 : volume} />
            <select aria-label="Velocidad de preview" className="rounded-md border border-line bg-canvas px-2 py-1.5 text-xs font-semibold text-ink" onChange={(event) => changeRate(Number(event.currentTarget.value))} value={playbackRate}>
              {PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
            </select>
            <PlayerButton label="Pantalla completa" onClick={() => void requestFullscreen()}><Expand size={17} /></PlayerButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerButton({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return <button aria-label={label} className="grid h-8 w-8 place-items-center rounded-md text-muted transition hover:bg-white/5 hover:text-ink" onClick={onClick} title={label} type="button">{children}</button>;
}
