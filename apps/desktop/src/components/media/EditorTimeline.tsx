import { Minus, Plus, ScanLine } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import type { AudioDecision, CameraDecision, CutDecision } from "../../project/contracts";
import { formatRulerTime, formatTimecode } from "../../editor/timecode";
import {
  MAX_TIMELINE_ZOOM,
  MIN_TIMELINE_ZOOM,
  moveRange,
  pixelsToUs,
  resizeRange,
  rulerStepUs,
  snapTimeUs,
  timelineWidth,
  usToPixels,
} from "../../editor/timeline";

export type TimelineSelection = { id: string; track: "cuts" | "camera" } | null;

interface EditorTimelineProps {
  audio: AudioDecision[];
  audioPresent?: boolean;
  camera: CameraDecision[];
  cuts: CutDecision[];
  draftCamera?: CameraDecision[];
  draftCuts?: CutDecision[];
  durationUs: number;
  markers?: number[];
  onChangeCamera: (item: CameraDecision) => void;
  onChangeCut: (item: CutDecision) => void;
  onSeek: (timeUs: number) => void;
  onSelect: (selection: TimelineSelection) => void;
  playheadUs: number;
  selected: TimelineSelection;
  sourceName: string;
}

type DragState = {
  edge?: "start" | "end";
  id: string;
  originEndUs: number;
  originStartUs: number;
  pointerX: number;
  track: "cuts" | "camera";
};

export function EditorTimeline({
  audio,
  audioPresent = false,
  camera,
  cuts,
  draftCamera = [],
  draftCuts = [],
  durationUs,
  markers = [],
  onChangeCamera,
  onChangeCut,
  onSeek,
  onSelect,
  playheadUs,
  selected,
  sourceName,
}: EditorTimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(900);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(
    () => Number(localStorage.getItem("cheto.editor.timelineZoom")) || 8,
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<{
    id: string;
    startUs: number;
    endUs: number;
    track: "cuts" | "camera";
  } | null>(null);
  const safeDuration = Math.max(1, durationUs);
  const contentWidth = timelineWidth(
    safeDuration,
    pixelsPerSecond,
    Math.max(300, viewportWidth - 74),
  );
  const stepUs = rulerStepUs(pixelsPerSecond);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() =>
      setViewportWidth(node.clientWidth),
    );
    observer.observe(node);
    setViewportWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);
  useEffect(
    () =>
      localStorage.setItem(
        "cheto.editor.timelineZoom",
        String(pixelsPerSecond),
      ),
    [pixelsPerSecond],
  );

  const ticks = useMemo(() => {
    const visibleStartUs = Math.max(
      0,
      pixelsToUs(Math.max(0, scrollLeft - 74), pixelsPerSecond) - stepUs * 2,
    );
    const visibleEndUs = Math.min(
      safeDuration,
      pixelsToUs(scrollLeft + viewportWidth, pixelsPerSecond) + stepUs * 2,
    );
    const first = Math.floor(visibleStartUs / stepUs) * stepUs;
    const values: number[] = [];
    for (
      let value = first;
      value <= visibleEndUs && values.length < 300;
      value += stepUs
    )
      values.push(value);
    return values;
  }, [pixelsPerSecond, safeDuration, scrollLeft, stepUs, viewportWidth]);

  const snapCandidates = useMemo(
    () => [
      0,
      safeDuration,
      playheadUs,
      ...markers,
      ...cuts.flatMap((item) => [item.startUs, item.endUs]),
      ...camera.flatMap((item) => [item.startUs, item.endUs]),
    ],
    [camera, cuts, markers, playheadUs, safeDuration],
  );

  const zoom = (next: number, anchorRatio = 0.5) => {
    const viewport = viewportRef.current;
    const beforeUs = viewport
      ? pixelsToUs(
          viewport.scrollLeft - 74 + viewport.clientWidth * anchorRatio,
          pixelsPerSecond,
        )
      : 0;
    const clamped = Math.min(
      MAX_TIMELINE_ZOOM,
      Math.max(MIN_TIMELINE_ZOOM, next),
    );
    setPixelsPerSecond(clamped);
    requestAnimationFrame(() => {
      if (viewport)
        viewport.scrollLeft = Math.max(
          0,
          74 +
            usToPixels(beforeUs, clamped) -
            viewport.clientWidth * anchorRatio,
        );
    });
  };
  const fit = () =>
    zoom(
      Math.max(
        MIN_TIMELINE_ZOOM,
        (viewportWidth - 90) / Math.max(1, safeDuration / 1_000_000),
      ),
      0,
    );
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    zoom(
      pixelsPerSecond * (event.deltaY < 0 ? 1.2 : 1 / 1.2),
      Math.min(1, Math.max(0, event.clientX / Math.max(1, viewportWidth))),
    );
  };

  const seekAt = (clientX: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    onSeek(
      Math.max(
        0,
        Math.min(
          safeDuration,
          pixelsToUs(
            clientX - bounds.left + viewport.scrollLeft - 74,
            pixelsPerSecond,
          ),
        ),
      ),
    );
  };
  const scrub = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    seekAt(event.clientX);
  };

  const beginDrag = (
    event: PointerEvent<HTMLSpanElement>,
    track: "cuts" | "camera",
    item: CutDecision | CameraDecision,
    edge?: "start" | "end",
  ) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect({ id: item.id, track });
    onSeek(item.startUs);
    setDrag({
      edge,
      id: item.id,
      originEndUs: item.endUs,
      originStartUs: item.startUs,
      pointerX: event.clientX,
      track,
    });
    setPreview({
      id: item.id,
      startUs: item.startUs,
      endUs: item.endUs,
      track,
    });
  };
  const updateDrag = (event: PointerEvent<HTMLSpanElement>) => {
    if (!drag) return;
    const deltaUs = pixelsToUs(event.clientX - drag.pointerX, pixelsPerSecond);
    let range = drag.edge
      ? resizeRange(
          drag.originStartUs,
          drag.originEndUs,
          drag.edge,
          (drag.edge === "start" ? drag.originStartUs : drag.originEndUs) +
            deltaUs,
          safeDuration,
        )
      : moveRange(drag.originStartUs, drag.originEndUs, deltaUs, safeDuration);
    const anchor = drag.edge === "end" ? range.endUs : range.startUs;
    const snapped = snapTimeUs(
      anchor,
      snapCandidates,
      pixelsPerSecond,
      event.altKey,
    );
    if (drag.edge === "end")
      range = resizeRange(
        range.startUs,
        range.endUs,
        "end",
        snapped,
        safeDuration,
      );
    else if (drag.edge === "start")
      range = resizeRange(
        range.startUs,
        range.endUs,
        "start",
        snapped,
        safeDuration,
      );
    else
      range = moveRange(
        range.startUs,
        range.endUs,
        snapped - range.startUs,
        safeDuration,
      );
    setPreview({ id: drag.id, track: drag.track, ...range });
  };
  const finishDrag = () => {
    if (!drag || !preview) return;
    const changed = preview.startUs !== drag.originStartUs || preview.endUs !== drag.originEndUs;
    if (!changed) { setDrag(null); setPreview(null); return; }
    if (drag.track === "cuts") {
      const item = cuts.find((value) => value.id === drag.id);
      if (item)
        onChangeCut({
          ...item,
          startUs: preview.startUs,
          endUs: preview.endUs,
        });
    } else {
      const item = camera.find((value) => value.id === drag.id);
      if (item)
        onChangeCamera({
          ...item,
          startUs: preview.startUs,
          endUs: preview.endUs,
        });
    }
    setDrag(null);
    setPreview(null);
  };
  const displayedRange = (
    track: "cuts" | "camera",
    item: CutDecision | CameraDecision,
  ) => (preview?.track === track && preview.id === item.id ? preview : item);

  return (
    <div className="editor-timeline" aria-label="Línea de tiempo de edición">
      <div className="timeline-zoom-toolbar">
        <button
          aria-label="Alejar timeline"
          onClick={() => zoom(pixelsPerSecond / 1.25)}
          type="button"
        >
          <Minus size={13} />
        </button>
        <input
          aria-label="Zoom temporal"
          max={MAX_TIMELINE_ZOOM}
          min={MIN_TIMELINE_ZOOM}
          onChange={(event) => zoom(Number(event.target.value))}
          step="0.25"
          type="range"
          value={pixelsPerSecond}
        />
        <button
          aria-label="Acercar timeline"
          onClick={() => zoom(pixelsPerSecond * 1.25)}
          type="button"
        >
          <Plus size={13} />
        </button>
        <button onClick={fit} title="Ajustar toda la duración" type="button">
          <ScanLine size={13} /> Ajustar
        </button>
        <span>{pixelsPerSecond.toFixed(1)} px/s</span>
      </div>
      <div
        className="editor-timeline-scroll"
        onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
        onWheel={handleWheel}
        ref={viewportRef}
      >
        <div
          className="editor-timeline-canvas"
          style={{ width: contentWidth + 74 }}
        >
          <div
            className="editor-timeline-ruler"
            onPointerDown={scrub}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                seekAt(event.clientX);
            }}
            style={{ width: contentWidth }}
          >
            {ticks.map((timeUs) => (
              <span
                className="editor-timeline-tick"
                key={timeUs}
                style={{ left: usToPixels(timeUs, pixelsPerSecond) }}
              >
                <i />
                {formatRulerTime(timeUs, stepUs)}
              </span>
            ))}
          </div>
          <TimelineLane contentWidth={contentWidth} label="Video" tone="video">
            <TimelineBlock
              className="is-video"
              endUs={safeDuration}
              label={sourceName}
              pixelsPerSecond={pixelsPerSecond}
              startUs={0}
              title={`${sourceName}\nInicio ${formatTimecode(0)}\nFinal ${formatTimecode(safeDuration)}\nDuración ${formatTimecode(safeDuration)}`}
            />
          </TimelineLane>
          <TimelineLane contentWidth={contentWidth} label="Cortes" tone="cuts">
            {cuts.map((item) => (
              <EditableBlock
                item={item}
                key={item.id}
                onMove={updateDrag}
                onRelease={finishDrag}
                onStart={beginDrag}
                pixelsPerSecond={pixelsPerSecond}
                range={displayedRange("cuts", item)}
                selected={selected?.track === "cuts" && selected.id === item.id}
                track="cuts"
              />
            ))}
            {draftCuts.map((item) => (
              <TimelineBlock
                className="is-draft"
                endUs={item.endUs}
                key={`draft-${item.id}`}
                label="Propuesta"
                pixelsPerSecond={pixelsPerSecond}
                startUs={item.startUs}
              />
            ))}
          </TimelineLane>
          <TimelineLane
            contentWidth={contentWidth}
            label="Encuadre"
            tone="camera"
          >
            {camera.map((item) => (
              <EditableBlock
                item={item}
                key={item.id}
                onMove={updateDrag}
                onRelease={finishDrag}
                onStart={beginDrag}
                pixelsPerSecond={pixelsPerSecond}
                range={displayedRange("camera", item)}
                selected={
                  selected?.track === "camera" && selected.id === item.id
                }
                track="camera"
              />
            ))}
            {draftCamera.map((item) => (
              <TimelineBlock
                className="is-draft"
                endUs={item.endUs}
                key={`draft-${item.id}`}
                label={`Propuesta ${cameraLabel(item.mode)}`}
                pixelsPerSecond={pixelsPerSecond}
                startUs={item.startUs}
              />
            ))}
          </TimelineLane>
          {audioPresent ? <TimelineLane contentWidth={contentWidth} label="Audio" tone="audio">
              <TimelineBlock className="is-audio" endUs={safeDuration} label="Audio original" pixelsPerSecond={pixelsPerSecond} startUs={0} title={"Audio original · " + formatTimecode(safeDuration)} />
              {audio.map((item) => <TimelineBlock className={"is-audio-operation audio-op-"+item.operation} endUs={item.endUs} key={item.id} label={audioLabel(item)} pixelsPerSecond={pixelsPerSecond} startUs={item.startUs} title={audioLabel(item)+"\n"+formatTimecode(item.startUs)+" → "+formatTimecode(item.endUs)} />)}
            </TimelineLane> : null}
          {markers.map((marker, index) => (
            <button
              aria-label={`Ir al marcador ${index + 1}`}
              className="editor-timeline-marker"
              key={`${marker}-${index}`}
              onClick={(event) => {
                event.stopPropagation();
                onSeek(marker);
              }}
              style={{
                left: 74 + usToPixels(marker, pixelsPerSecond),
              }}
              title={`Marcador ${index + 1} · ${formatTimecode(marker)}`}
              type="button"
            >
              <span />
            </button>
          ))}

          <div
            className="editor-timeline-playhead"
            onPointerDown={scrub}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                seekAt(event.clientX);
            }}
            style={{ left: 74 + usToPixels(playheadUs, pixelsPerSecond) }}
            title={formatTimecode(playheadUs)}
          >
            <span />
            <em>{formatTimecode(playheadUs)}</em>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineLane({
  children,
  contentWidth,
  label,
  tone,
}: {
  children: ReactNode;
  contentWidth: number;
  label: string;
  tone: string;
}) {
  return (
    <div className={`editor-timeline-lane editor-timeline-lane-${tone}`}>
      <strong>{label}</strong>
      <div className="editor-timeline-track" style={{ width: contentWidth }}>
        {children}
      </div>
    </div>
  );
}
function TimelineBlock({
  className = "",
  endUs,
  label,
  pixelsPerSecond,
  startUs,
  title,
}: {
  className?: string;
  endUs: number;
  label: string;
  pixelsPerSecond: number;
  startUs: number;
  title?: string;
}) {
  return (
    <span
      className={`editor-timeline-block ${className}`}
      style={{
        left: usToPixels(startUs, pixelsPerSecond),
        width: Math.max(4, usToPixels(endUs - startUs, pixelsPerSecond)),
      }}
      title={title ?? label}
    >
      {label}
    </span>
  );
}
function EditableBlock({
  item,
  onMove,
  onRelease,
  onStart,
  pixelsPerSecond,
  range,
  selected,
  track,
}: {
  item: CutDecision | CameraDecision;
  onMove: (event: PointerEvent<HTMLSpanElement>) => void;
  onRelease: () => void;
  onStart: (
    event: PointerEvent<HTMLSpanElement>,
    track: "cuts" | "camera",
    item: CutDecision | CameraDecision,
    edge?: "start" | "end",
  ) => void;
  pixelsPerSecond: number;
  range: { startUs: number; endUs: number };
  selected: boolean;
  track: "cuts" | "camera";
}) {
  const camera = track === "camera" ? (item as CameraDecision) : null;
  const label =
    track === "cuts"
      ? `Corte · ${durationLabel(range)}`
      : `${cameraLabel(camera?.mode ?? "")} · ${durationLabel(range)}`;
  const title =
    track === "cuts"
      ? `Corte\nInicio: ${formatTimecode(range.startUs)}\nFin: ${formatTimecode(range.endUs)}\nDuración eliminada: ${formatTimecode(range.endUs - range.startUs)}`
      : `${cameraLabel(camera?.mode ?? "")}\nInicio: ${formatTimecode(range.startUs)}\nFin: ${formatTimecode(range.endUs)}\nDuración: ${formatTimecode(range.endUs - range.startUs)}\nZoom: ${(camera?.zoom ?? 1).toFixed(2)}x\nCentro: ${Math.round((camera?.centerX ?? 0.5) * 100)}%, ${Math.round((camera?.centerY ?? 0.5) * 100)}%`;
  return (
    <span
      className={`editor-timeline-block is-editable ${selected ? "is-selected" : ""}`}
      onPointerDown={(event) => onStart(event, track, item)}
      onPointerMove={onMove}
      onPointerUp={onRelease}
      style={{
        left: usToPixels(range.startUs, pixelsPerSecond),
        width: Math.max(
          8,
          usToPixels(range.endUs - range.startUs, pixelsPerSecond),
        ),
      }}
      title={title}
    >
      <i
        className="timeline-handle left"
        onPointerDown={(event) => onStart(event, track, item, "start")}
      />
      <b>{label}</b>
      <i
        className="timeline-handle right"
        onPointerDown={(event) => onStart(event, track, item, "end")}
      />
    </span>
  );
}
function durationLabel(range: { startUs: number; endUs: number }) {
  return `${((range.endUs - range.startUs) / 1_000_000).toFixed(2)} s`;
}
function cameraLabel(mode: string) {
  return mode === "reset"
    ? "Restablecer"
    : mode === "focus"
      ? "Enfoque"
      : "Zoom";
}





function audioLabel(item: AudioDecision) {
  if (item.operation === "mute_range") return "Mute";
  if (item.operation === "gain_range") return String(item.parameters.gainDb ?? 0) + " dB";
  if (item.operation === "noise_reduction_range") return "Limpiar";
  if (item.operation === "noise_reduction") return "Ruido";
  if (item.operation === "voice_focus") return "Voz";
  if (item.operation === "hum_filter") return "Hum";
  if (item.operation === "normalize") return "Normalizar";
  return item.operation;
}
