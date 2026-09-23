import { Expand, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PlaybackKind, PlaybackState } from "../../playback/models";
import { nextPlaybackState } from "../../playback/models";
import { playbackAssetUrl } from "../../playback/service";
import { clampTimelineUs, formatPlaybackTime, SEEK_STEP_US, usToSeconds, secondsToUs } from "../../playback/time";

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

interface VideoPlayerProps {
  durationUs: number;
  kind: PlaybackKind;
  onError: (message: string) => void;
  path: string;
  seekToUs?: number | null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select") || target.isContentEditable;
}

export function VideoPlayer({ durationUs, kind, onError, path, seekToUs }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [playheadUs, setPlayheadUs] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const assetUrl = playbackAssetUrl(path);

  const seek = useCallback((targetUs: number) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = clampTimelineUs(targetUs, durationUs);
    video.currentTime = usToSeconds(clamped);
    setPlayheadUs(clamped);
  }, [durationUs]);

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
        seek(playheadUs - SEEK_STEP_US);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seek(playheadUs + SEEK_STEP_US);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playheadUs, seek, togglePlayback]);

  useEffect(() => {
    if (seekToUs === null || seekToUs === undefined || !videoRef.current) return;
    videoRef.current.currentTime = usToSeconds(clampTimelineUs(seekToUs, durationUs));
  }, [durationUs, seekToUs]);

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

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-black shadow-2xl" ref={containerRef}>
      <div className="relative grid aspect-video place-items-center bg-black">
        <video
          className="h-full w-full object-contain"
          onClick={() => void togglePlayback()}
          onEnded={() => setPlaybackState(nextPlaybackState(playbackState, "end"))}
          onError={() => { setPlaybackState("error"); onError("No se pudo decodificar la fuente de reproducción."); }}
          onLoadedMetadata={() => setPlaybackState(nextPlaybackState(playbackState, "ready"))}
          onPause={() => { if (!videoRef.current?.ended) setPlaybackState(nextPlaybackState(playbackState, "pause")); }}
          onPlay={() => setPlaybackState(nextPlaybackState(playbackState, "play"))}
          onTimeUpdate={(event) => setPlayheadUs(clampTimelineUs(secondsToUs(event.currentTarget.currentTime), durationUs))}
          onWaiting={() => setPlaybackState("loading")}
          preload="metadata"
          ref={videoRef}
          src={assetUrl}
        />
        <span className="absolute left-4 top-4 rounded-md border border-white/15 bg-black/65 px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] text-white backdrop-blur">{kind.toUpperCase()}</span>
        {playbackState === "loading" ? <span className="absolute rounded-full bg-black/70 px-4 py-2 text-xs font-semibold text-white">Cargando…</span> : null}
      </div>
      <div className="border-t border-white/10 bg-surface px-4 py-3">
        <input
          aria-label="Posición del video"
          className="h-1.5 w-full cursor-pointer accent-cyan"
          max={Math.max(1, durationUs)}
          min="0"
          onChange={(event) => seek(Number(event.currentTarget.value))}
          step="1000"
          type="range"
          value={playheadUs}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <PlayerButton label="Inicio" onClick={() => seek(0)}><SkipBack size={17} /></PlayerButton>
          <PlayerButton label="Retroceder 5 segundos" onClick={() => seek(playheadUs - SEEK_STEP_US)}><RotateCcw size={17} /></PlayerButton>
          <button aria-label={playbackState === "playing" ? "Pausar" : "Reproducir"} className="grid h-9 w-9 place-items-center rounded-full bg-primary text-white transition hover:bg-primary-hover" onClick={() => void togglePlayback()} type="button">
            {playbackState === "playing" ? <Pause fill="currentColor" size={17} /> : <Play fill="currentColor" size={17} />}
          </button>
          <PlayerButton label="Avanzar 5 segundos" onClick={() => seek(playheadUs + SEEK_STEP_US)}><RotateCw size={17} /></PlayerButton>
          <PlayerButton label="Final" onClick={() => seek(durationUs)}><SkipForward size={17} /></PlayerButton>
          <span className="ml-1 min-w-[145px] font-mono text-xs font-semibold text-ink">{formatPlaybackTime(playheadUs)} / {formatPlaybackTime(durationUs)}</span>
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
