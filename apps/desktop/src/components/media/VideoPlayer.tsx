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
import type { EdlManifest } from "../../project/contracts";
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
  aspectRatio: number;
  cameraPreview?: CameraPreview | null;
  draftRange?: PreviewRange | null;
  draftTracks?: DraftTracks | null;
  durationUs: number;
  edl: EdlManifest;
  externalMuted?: boolean;
  externalPlaybackRate?: number;
  externalVolume?: number;
  kind: PlaybackKind;
  markers?: number[];
  mode: "original" | "result";
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
  aspectRatio,
  cameraPreview,
  draftRange,
  draftTracks,
  durationUs,
  edl,
  externalMuted,
  externalPlaybackRate,
  externalVolume,
  kind,
  markers = [],
  mode,
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
  const containerRef = useRef<HTMLDivElement>(null);

  const [playbackState, setPlaybackState] =
    useState<PlaybackState>("idle");

  const [playheadUs, setPlayheadUs] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(externalPlaybackRate ?? 1);
  const [volume, setVolume] = useState(externalVolume ?? 1);
  const [muted, setMuted] = useState(externalMuted ?? false);

  const assetUrl = playbackAssetUrl(path);

  useEffect(() => { if (externalPlaybackRate === undefined) return; setPlaybackRate(externalPlaybackRate); if (videoRef.current) videoRef.current.playbackRate = externalPlaybackRate; }, [externalPlaybackRate]);
  useEffect(() => { if (externalVolume === undefined) return; const next = Math.min(1, Math.max(0, externalVolume)); setVolume(next); if (videoRef.current) videoRef.current.volume = next; }, [externalVolume]);
  useEffect(() => { if (externalMuted === undefined) return; setMuted(externalMuted); if (videoRef.current) videoRef.current.muted = externalMuted; }, [externalMuted]);

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
  }, [seek, seekToUs]);

  const changeVolume = (value: number) => {
    const next = Math.min(1, Math.max(0, value));

    setVolume(next);
    setMuted(next === 0);
    onVolumeChange?.(next);
    onMutedChange?.(next === 0);

    if (videoRef.current) {
      videoRef.current.volume = next;
      videoRef.current.muted = next === 0;
    }
  };

  const toggleMute = () => {
    const next = !muted;

    setMuted(next);
    onMutedChange?.(next);

    if (videoRef.current) {
      videoRef.current.muted = next;
    }
  };

  const changeRate = (rate: number) => {
    setPlaybackRate(rate);
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

  const maxStageVh = Math.max(28, Math.min(52, 18 + viewerScale * 0.34));

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
          endUs: edlCamera.endUs,
          id: edlCamera.id,
          startUs: edlCamera.startUs,
          transitionUs:
            edlCamera.transitionUs ?? 500_000,
          zoom: edlCamera.zoom ?? 1,
        }
      : null);

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
      <div className="video-stage-shell">
        <div
          className="video-stage relative grid place-items-center overflow-hidden"
          style={{
            aspectRatio,
            maxHeight: `${maxStageVh}vh`,
            width: `min(100%, calc(${maxStageVh}vh * ${aspectRatio}))`,
          }}
        >
          <video
            className={`h-full w-full ${
              mode === "result"
                ? "object-cover"
                : "object-contain"
            } will-change-transform`}
            onClick={() => void togglePlayback()}
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
            onLoadedMetadata={() =>
              setPlaybackState(
                nextPlaybackState(
                  playbackState,
                  "ready",
                ),
              )
            }
            onPause={() => {
              if (!videoRef.current?.ended) {
                setPlaybackState(
                  nextPlaybackState(
                    playbackState,
                    "pause",
                  ),
                );
              }
            }}
            onPlay={() =>
              setPlaybackState(
                nextPlaybackState(
                  playbackState,
                  "play",
                ),
              )
            }
            onTimeUpdate={(event) =>
              updatePlayhead(
                secondsToUs(
                  event.currentTarget.currentTime,
                ),
                event.currentTarget,
              )
            }
            onWaiting={() =>
              setPlaybackState("loading")
            }
            preload="metadata"
            ref={videoRef}
            src={assetUrl}
            style={{
              transform: `scale(${
                activeCamera?.zoom ?? 1
              })`,
              transformOrigin: `${
                (activeCamera?.centerX ?? 0.5) *
                100
              }% ${
                (activeCamera?.centerY ?? 0.5) *
                100
              }%`,
              transition: `transform ${
                Math.max(
                  0,
                  activeCamera?.transitionUs ??
                    cameraPreview?.transitionUs ??
                    0,
                ) / 1_000_000
              }s ease-in-out`,
            }}
          />

          <span className="player-source-badge">
            {kind.toUpperCase()}
          </span>

          {playbackState === "loading" ? (
            <span className="player-loading">
              Cargando…
            </span>
          ) : null}

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

