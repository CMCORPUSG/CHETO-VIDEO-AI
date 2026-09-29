import {
  Expand,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PlaybackKind,
  PlaybackState,
} from "../../playback/models";
import { nextPlaybackState } from "../../playback/models";
import { playbackAssetUrl } from "../../playback/service";
import { libraryAssetPreview } from "../../assets/service";
import {
  clampTimelineUs,
  formatPlaybackTime,
  SEEK_STEP_US,
  secondsToUs,
  usToSeconds,
} from "../../playback/time";
import {
  activeCameraAt,
  type CameraPreview,
} from "../../smart-camera/models";
import type { EdlManifest, TitleDecision } from "../../project/contracts";
import { TitlePreview } from "./TitlePreview";
import { TitleCanvasEditor } from "./TitleCanvasEditor";
import type { BackgroundMode, FitMode } from "../../export/models";
import { cameraMotionAt, composeCanvasAndCamera } from "../../editor/camera-motion";
import { canvasTranslationPercent, fitViewer } from "../../editor/layout";
import {
  activeCameraAt as activeEdlCameraAt,
  cutAt,
  editedDurationUs,
  editedToSourceUs,
  effectiveTracks,
  sourceToEditedUs,
  type DraftTracks,
  type PreviewRange,
} from "../../editor/edl";

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

interface VideoPlayerProps {
  fitMode?: FitMode;
  backgroundMode?: BackgroundMode;
  backgroundColor?: string;
  pauseEpoch?: number;
  aspectRatio: number;
  cameraPreview?: CameraPreview | null;
  canvasOffsetX?: number;
  canvasOffsetY?: number;
  canvasScale?: number;
  draftRange?: PreviewRange | null;
  draftTracks?: DraftTracks | null;
  durationUs: number;
  edl: EdlManifest;
  externalMuted?: boolean;
  externalPlaybackRate?: number;
  externalVolume?: number;
  kind: PlaybackKind;
  liveTitle?: TitleDecision | null;
  liveTitleTimeUs?: number;
  editableTitle?: boolean;
  selectedTitleLayerId?: string | null;
  onSelectTitleLayer?: (layerId: string) => void;
  onCommitTitle?: (title: TitleDecision) => void;
  onTitleEditingChange?: (editing: boolean) => void;
  markers?: number[];
  mode: "original" | "result";
  onCanvasOffsetChange?: (x: number, y: number) => void;
  onError: (message: string) => void;
  onMutedChange?: (muted: boolean) => void;
  onPlaybackRateChange?: (rate: number) => void;
  onTimeChange?: (sourceUs: number) => void;
  onVolumeChange?: (volume: number) => void;
  path: string;
  seekToUs?: number | null;
  viewerScale?: number;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target.matches("input, textarea, select") ||
    target.isContentEditable
  );
}

export function VideoPlayer({
  fitMode = "cover",
  backgroundMode = "black",
  backgroundColor = "#000000",
  pauseEpoch = 0,
  aspectRatio,
  cameraPreview,
  canvasOffsetX = 0,
  canvasOffsetY = 0,
  canvasScale = 1,
  draftRange,
  draftTracks,
  durationUs,
  edl,
  externalMuted,
  externalPlaybackRate,
  externalVolume,
  kind,
  liveTitle = null,
  liveTitleTimeUs = 0,
  editableTitle = false,
  selectedTitleLayerId = null,
  onSelectTitleLayer,
  onCommitTitle,
  onTitleEditingChange,
  markers = [],
  mode,
  onCanvasOffsetChange,
  onError,
  onMutedChange,
  onPlaybackRateChange,
  onTimeChange,
  onVolumeChange,
  path,
  seekToUs,
  viewerScale = 78,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const backgroundRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageShellRef = useRef<HTMLDivElement>(null);
  const [stageBounds, setStageBounds] = useState({ width: 0, height: 0 });
  const [overlayUrls, setOverlayUrls] = useState<Record<string, string>>({});
  const [overlaySizes, setOverlaySizes] = useState<Record<string, { width: number; height: number }>>({});
  const [videoNativeWidth, setVideoNativeWidth] = useState(0);

  useEffect(() => {
    const shell = stageShellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setStageBounds({ width, height });
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  const [playbackState, setPlaybackState] =
    useState<PlaybackState>("idle");

  const [playheadUs, setPlayheadUs] = useState(0);
  const [localPlaybackRate, setLocalPlaybackRate] = useState(1);
  const [localVolume, setLocalVolume] = useState(1);
  const [localMuted, setLocalMuted] = useState(false);
  const playbackRate = externalPlaybackRate ?? localPlaybackRate;
  const volume = externalVolume ?? localVolume;
  const muted = externalMuted ?? localMuted;
  const panRef = useRef<{ pointerId:number; startX:number; startY:number; offsetX:number; offsetY:number; moved:boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const assetUrl = playbackAssetUrl(path);
  const overlayPaths = useMemo(() => [...new Set((edl.tracks.assets ?? [])
    .filter(item => item.kind === "overlay" && !item.muted).map(item => item.assetPath))], [edl.tracks.assets]);
  useEffect(() => {
    if (mode !== "result") return;
    let active = true;
    void Promise.all(overlayPaths.map(async path => {
      try { return [path, await libraryAssetPreview(path)] as const; }
      catch { return null; }
    })).then(values => { if (active) setOverlayUrls(Object.fromEntries(values.filter(value => value !== null))); });
    return () => { active = false; };
  }, [mode, overlayPaths]);

  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = playbackRate; }, [playbackRate]);
  useEffect(() => { if (videoRef.current) videoRef.current.volume = Math.min(1, Math.max(0, volume)); }, [volume]);
  useEffect(() => { if (videoRef.current) videoRef.current.muted = muted; }, [muted]);
  useEffect(() => { if (pauseEpoch > 0) videoRef.current?.pause(); }, [pauseEpoch]);

  const tracks = useMemo(
    () =>
      effectiveTracks(
        edl,
        draftTracks ?? null,
        draftRange ?? null,
      ),
    [draftRange, draftTracks, edl],
  );

  const resultDurationUs =
    mode === "result"
      ? editedDurationUs(durationUs, tracks.cuts)
      : durationUs;

  const seek = useCallback(
    (targetUs: number) => {
      const video = videoRef.current;

      if (!video) return;

      const clamped = clampTimelineUs(targetUs, durationUs);

      video.currentTime = usToSeconds(clamped);
      if (backgroundRef.current) backgroundRef.current.currentTime = video.currentTime;
      setPlayheadUs(clamped);
      onTimeChange?.(clamped);
    },
    [durationUs, onTimeChange],
  );

  const seekTimeline = useCallback(
    (targetUs: number) =>
      seek(
        mode === "result"
          ? editedToSourceUs(
              targetUs,
              tracks.cuts,
              durationUs,
            )
          : targetUs,
      ),
    [durationUs, mode, seek, tracks.cuts],
  );

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current;

    if (!video) return;

    try {
      if (video.paused || video.ended) {
        await video.play();
      } else {
        video.pause();
      }
    } catch {
      setPlaybackState(
        nextPlaybackState(playbackState, "fail"),
      );

      onError(
        "El WebView no pudo iniciar la reproducción del archivo local.",
      );
    }
  }, [onError, playbackState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      if (event.code === "Space") {
        event.preventDefault();
        void togglePlayback();
        return;
      }

      const currentTimelineUs =
        mode === "result"
          ? sourceToEditedUs(
              playheadUs,
              tracks.cuts,
              durationUs,
            ) ?? 0
          : playheadUs;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekTimeline(currentTimelineUs - SEEK_STEP_US);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        seekTimeline(currentTimelineUs + SEEK_STEP_US);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    durationUs,
    mode,
    playheadUs,
    seekTimeline,
    togglePlayback,
    tracks.cuts,
  ]);

  useEffect(() => {
    if (
      seekToUs === null ||
      seekToUs === undefined ||
      !videoRef.current
    ) {
      return;
    }

    seek(seekToUs);
    if (cameraPreview) void videoRef.current.play().catch(() => undefined);
  }, [cameraPreview, seek, seekToUs]);

  const changeVolume = (value: number) => {
    const next = Math.min(1, Math.max(0, value));

    setLocalVolume(next);
    setLocalMuted(next === 0);
    onVolumeChange?.(next);
    onMutedChange?.(next === 0);

    if (videoRef.current) {
      videoRef.current.volume = next;
      videoRef.current.muted = next === 0;
    }
  };

  const toggleMute = () => {
    const next = !muted;

    setLocalMuted(next);
    onMutedChange?.(next);

    if (videoRef.current) {
      videoRef.current.muted = next;
    }
  };

  const changeRate = (rate: number) => {
    setLocalPlaybackRate(rate);
    onPlaybackRateChange?.(rate);

    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const requestFullscreen = async () => {
    try {
      await containerRef.current?.requestFullscreen();
    } catch {
      onError(
        "El modo de pantalla completa no está disponible en este WebView.",
      );
    }
  };

  const fittedStage = fitViewer(stageBounds.width, stageBounds.height, aspectRatio, viewerScale);
  const visibleOverlays = mode === "result" ? (edl.tracks.assets ?? []).filter(item => {
    if (item.kind !== "overlay" || item.muted || playheadUs < item.startUs || playheadUs >= item.endUs) return false;
    return item.loop || playheadUs - item.startUs < item.sourceDurationUs;
  }) : [];
  const baseTransform = composeCanvasAndCamera(canvasScale, canvasOffsetX, canvasOffsetY, { zoom: 1, centerX: 0.5, centerY: 0.5 });
  const manualScale = baseTransform.baseScale;
  const manualOffsetX = baseTransform.baseOffsetX;
  const manualOffsetY = baseTransform.baseOffsetY;

  const beginCanvasPan = (event: import("react").PointerEvent<HTMLDivElement>) => {
    if (mode !== "result" || !onCanvasOffsetChange) return;
    panRef.current = { pointerId:event.pointerId, startX:event.clientX, startY:event.clientY, offsetX:manualOffsetX, offsetY:manualOffsetY, moved:false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveCanvasPan = (event: import("react").PointerEvent<HTMLDivElement>) => {
    const pan=panRef.current;
    if (!pan || pan.pointerId!==event.pointerId || !onCanvasOffsetChange) return;
    const bounds=event.currentTarget.getBoundingClientRect();
    const dx=((event.clientX-pan.startX)/Math.max(1,bounds.width))*2;
    const dy=((event.clientY-pan.startY)/Math.max(1,bounds.height))*2;
    if (Math.abs(dx)>0.005 || Math.abs(dy)>0.005) pan.moved=true;
    onCanvasOffsetChange(Math.min(1,Math.max(-1,pan.offsetX+dx)),Math.min(1,Math.max(-1,pan.offsetY+dy)));
  };
  const endCanvasPan = (event: import("react").PointerEvent<HTMLDivElement>) => {
    const pan=panRef.current;
    if (!pan || pan.pointerId!==event.pointerId) return;
    suppressClickRef.current=pan.moved;
    panRef.current=null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const VolumeIcon =
    muted || volume === 0
      ? VolumeX
      : volume < 0.5
        ? Volume1
        : Volume2;

  const previewCamera = activeCameraAt(
    cameraPreview ?? null,
    playheadUs,
  );

  const edlCamera =
    mode === "result"
      ? activeEdlCameraAt(tracks.camera, playheadUs)
      : null;

  const activeCamera =
    previewCamera ??
    (edlCamera
      ? {
          centerX: edlCamera.centerX ?? 0.5,
          centerY: edlCamera.centerY ?? 0.5,
          easing: edlCamera.easing ?? "linear",
          endUs: edlCamera.endUs,
          id: edlCamera.id,
          startUs: edlCamera.startUs,
          transitionUs:
            edlCamera.transitionUs ?? 500_000,
          zoom: edlCamera.zoom ?? 1,
        }
      : null);

  const motion = cameraMotionAt(activeCamera, playheadUs);
  const composed = composeCanvasAndCamera(canvasScale, canvasOffsetX, canvasOffsetY, motion);
  const cameraZoom = composed.cameraScale;
  const cameraPanX = composed.cameraPanXPercent;
  const cameraPanY = composed.cameraPanYPercent;

  const timelineUs =
    mode === "result"
      ? sourceToEditedUs(
          playheadUs,
          tracks.cuts,
          durationUs,
        ) ?? 0
      : playheadUs;

  const visibleMarkers = markers
    .map((sourceUs) => {
      const mapped =
        mode === "result"
          ? sourceToEditedUs(
              sourceUs,
              tracks.cuts,
              durationUs,
            )
          : sourceUs;

      return mapped === null
        ? null
        : {
            sourceUs,
            timelineUs: mapped,
          };
    })
    .filter(
      (
        marker,
      ): marker is {
        sourceUs: number;
        timelineUs: number;
      } => marker !== null,
    );

  const updatePlayhead = (
    sourceUs: number,
    video: HTMLVideoElement,
  ) => {
    if (mode === "result") {
      const removed = cutAt(
        tracks.cuts,
        sourceUs,
        durationUs,
      );

      if (removed) {
        video.currentTime = usToSeconds(removed.endUs);
        sourceUs = removed.endUs;
      }

      if (
        draftRange &&
        sourceUs >= draftRange.endUs
      ) {
        video.pause();
        sourceUs = draftRange.endUs;
        video.currentTime = usToSeconds(sourceUs);
      }
    }

    const value = clampTimelineUs(
      sourceUs,
      durationUs,
    );

    setPlayheadUs(value);
    onTimeChange?.(value);
  };

  return (
    <div
      className="video-player"
      ref={containerRef}
    >
      <div className="video-stage-shell" ref={stageShellRef}>
        <div
          className={`video-stage relative grid place-items-center overflow-hidden ${mode==="result"&&onCanvasOffsetChange?"cursor-grab active:cursor-grabbing":""}`}
          onPointerDown={beginCanvasPan}
          onPointerMove={moveCanvasPan}
          onPointerUp={endCanvasPan}
          onPointerCancel={endCanvasPan}
          style={{
            aspectRatio,
            width: fittedStage.width || undefined,
            height: fittedStage.height || undefined,
            backgroundColor: mode === "result" && fitMode === "center" && backgroundMode === "color" ? backgroundColor : "#000000",
          }}
        >
          {mode === "result" && fitMode === "center" && backgroundMode === "blur" ? <video aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover" muted onLoadedMetadata={event=>{event.currentTarget.currentTime=videoRef.current?.currentTime??0;}} playsInline preload="metadata" ref={backgroundRef} src={assetUrl} style={{filter:"blur(22px) brightness(0.7)",transform:"scale(1.12)"}}/> : null}
          <div
            className="video-canvas-layer h-full w-full will-change-transform"
            style={{
              transform: `translate(${canvasTranslationPercent(manualScale, manualOffsetX)}%, ${canvasTranslationPercent(manualScale, manualOffsetY)}%) scale(${manualScale})`,
              transformOrigin: "50% 50%",
            }}
          >
            <video
              className={`h-full w-full ${
                mode === "result" && fitMode === "cover"
                  ? "object-cover"
                  : "object-contain"
              } will-change-transform`}
              onClick={() => { if (suppressClickRef.current) { suppressClickRef.current=false; return; } void togglePlayback(); }}
              onEnded={() =>
                setPlaybackState(
                  nextPlaybackState(
                    playbackState,
                    "end",
                  ),
                )
              }
              onError={() => {
                setPlaybackState("error");

                onError(
                  "No se pudo decodificar la fuente de reproducción.",
                );
              }}
              onLoadedMetadata={event => {
                setVideoNativeWidth(event.currentTarget.videoWidth);
                setPlaybackState(
                  nextPlaybackState(
                    playbackState,
                    "ready",
                  ),
                );
              }}
              onPause={() => {
                backgroundRef.current?.pause();
                if (!videoRef.current?.ended) {
                  setPlaybackState(
                    nextPlaybackState(
                      playbackState,
                      "pause",
                    ),
                  );
                }
              }}
              onPlay={() => {void backgroundRef.current?.play().catch(()=>undefined);setPlaybackState(nextPlaybackState(playbackState,"play"));}}
              onTimeUpdate={(event) => {if(backgroundRef.current && Math.abs(backgroundRef.current.currentTime-event.currentTarget.currentTime)>0.12)backgroundRef.current.currentTime=event.currentTarget.currentTime;updatePlayhead(secondsToUs(event.currentTarget.currentTime),event.currentTarget);}}
              onWaiting={() =>
                setPlaybackState("loading")
              }
              preload="metadata"
              ref={videoRef}
              src={assetUrl}
              style={{
                objectPosition: manualScale === 1 && mode === "result" ? `${50 + manualOffsetX * 50}% ${50 + manualOffsetY * 50}%` : "50% 50%",
                transform: `translate(${cameraPanX}%, ${cameraPanY}%) scale(${cameraZoom})`,
                transformOrigin: "50% 50%",
                transition: "none",
              }}
            />
          </div>

          {visibleOverlays.map(item => {
            const size = overlaySizes[item.id];
            const sourceWidth = videoNativeWidth || fittedStage.width || 1;
            const width = Math.min(fittedStage.width, (size?.width ?? 0) * item.scale * fittedStage.width / sourceWidth);
            const height = size ? width * size.height / Math.max(1, size.width) : 0;
            const cycle = item.loop && item.sourceDurationUs > 0 ? Math.floor((playheadUs - item.startUs) / item.sourceDurationUs) : 0;
            return overlayUrls[item.assetPath] ? <img
              alt="" aria-hidden="true" className="pointer-events-none absolute z-10"
              key={`${item.id}-${cycle}`} src={overlayUrls[item.assetPath]}
              onLoad={event => setOverlaySizes(current => ({ ...current, [item.id]: { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight } }))}
              style={{ width: width || undefined, height: height || undefined,
                left: (fittedStage.width - width) * item.positionX,
                top: (fittedStage.height - height) * item.positionY,
                opacity: item.opacity }} /> : null;
          })}

          {liveTitle ? editableTitle && onSelectTitleLayer && onCommitTitle ? <TitleCanvasEditor title={liveTitle} timeUs={liveTitleTimeUs} aspectRatio={aspectRatio} selectedLayerId={selectedTitleLayerId} onSelectLayer={onSelectTitleLayer} onCommit={onCommitTitle} onEditingChange={onTitleEditingChange}/> : <TitlePreview aspectRatio={aspectRatio} title={liveTitle} timeUs={liveTitleTimeUs}/> : null}

          <span className="player-source-badge">{mode === "result" ? "RESULTADO · VISTA INTERACTIVA" : kind.toUpperCase()}</span>

          {playbackState === "loading" ? (
            <span className="player-loading">
              Cargando…
            </span>
          ) : null}

          {mode==="result" ? <span className="player-transform-frame" aria-hidden="true"><i/><i/><i/><i/></span> : null}

          {activeCamera ? (
            <span className="player-camera-badge">
              ENCUADRE{" "}
              {activeCamera.zoom.toFixed(2)}×
            </span>
          ) : null}
        </div>
      </div>

      <div className="player-bottom">
        <div className="player-progress-shell">
          <input
            aria-label="Posición del video"
            className="player-progress"
            max={Math.max(1, resultDurationUs)}
            min="0"
            onChange={(event) =>
              seekTimeline(
                Number(event.currentTarget.value),
              )
            }
            step="1000"
            type="range"
            value={timelineUs}
          />

          {visibleMarkers.map((marker, index) => (
            <button
              aria-label={`Ir al marcador ${index + 1}`}
              className="player-marker"
              key={`${marker.sourceUs}-${index}`}
              onClick={() =>
                seek(marker.sourceUs)
              }
              style={{
                left: `${
                  (marker.timelineUs /
                    Math.max(
                      1,
                      resultDurationUs,
                    )) *
                  100
                }%`,
              }}
              title={`Marcador ${index + 1}`}
              type="button"
            />
          ))}
        </div>

        <div className="player-controlbar">
          <div className="player-time">
            <strong>
              {formatPlaybackTime(timelineUs)}
            </strong>

            <span>/</span>

            <span>
              {formatPlaybackTime(
                resultDurationUs,
              )}
            </span>
          </div>

          <div className="player-center">
            <button
              aria-label={
                playbackState === "playing"
                  ? "Pausar"
                  : "Reproducir"
              }
              className="player-play"
              onClick={() =>
                void togglePlayback()
              }
              title="Reproducir / Pausar (Espacio)"
              type="button"
            >
              {playbackState === "playing" ? (
                <Pause
                  fill="currentColor"
                  size={16}
                />
              ) : (
                <Play
                  className="ml-0.5"
                  fill="currentColor"
                  size={16}
                />
              )}
            </button>
          </div>

          <div className="player-right">
            <button
              aria-label={
                muted
                  ? "Activar sonido"
                  : "Silenciar"
              }
              className="player-icon-button"
              onClick={toggleMute}
              title={
                muted
                  ? "Activar sonido"
                  : "Silenciar"
              }
              type="button"
            >
              <VolumeIcon size={15} />
            </button>

            <input
              aria-label="Volumen"
              className="player-volume"
              max="1"
              min="0"
              onChange={(event) =>
                changeVolume(
                  Number(
                    event.currentTarget.value,
                  ),
                )
              }
              step="0.01"
              type="range"
              value={muted ? 0 : volume}
            />

            <span className="player-volume-value">
              {Math.round(
                (muted ? 0 : volume) * 100,
              )}
              %
            </span>

            <select
              aria-label="Velocidad de reproducción"
              className="player-rate"
              onChange={(event) =>
                changeRate(
                  Number(
                    event.currentTarget.value,
                  ),
                )
              }
              value={playbackRate}
            >
              {PLAYBACK_RATES.map((rate) => (
                <option
                  key={rate}
                  value={rate}
                >
                  {rate}x
                </option>
              ))}
            </select>

            <button
              aria-label="Pantalla completa"
              className="player-icon-button"
              onClick={() =>
                void requestFullscreen()
              }
              title="Pantalla completa"
              type="button"
            >
              <Expand size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
