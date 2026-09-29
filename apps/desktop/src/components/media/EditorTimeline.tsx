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
import type { AssetDecision, AudioDecision, CameraDecision, CutDecision, TitleDecision, TitlePresetId, TransitionDecision } from "../../project/contracts";
import type { AudioEvent } from "../../editor/audio-intelligence";
import { formatRulerTime, formatTimecode } from "../../editor/timecode";
import { classifyCut, classifyInterval } from "../../editor/conflicts";
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
import { canLoadTimelineVisuals, timelineThumbnail, timelineWaveform, visibleThumbnailTimes, waveformPath, type WaveformView } from "../../editor/visuals";
import { manualClipSegments } from "../../editor/manual-trim";
import type { EdlManifest } from "../../project/contracts";

export type TimelineSelection = { id: string; track: "cuts" | "camera" | "audio" | "assets" | "titles" | "transitions" | "video" | "audio-source" | "marker" } | null;

interface EditorTimelineProps {
  projectId: string;
  visualSourceKey: string;
  audio: AudioDecision[];
  assets?: AssetDecision[];
  titles?: TitleDecision[];
  transitions?: TransitionDecision[];
  audioEvents?: AudioEvent[];
  selectedAudioEventId?: string | null;
  onAudioEventClick?: (event: AudioEvent) => void;
  audioPresent?: boolean;
  audioPlaced: boolean;
  camera: CameraDecision[];
  cuts: CutDecision[];
  draftCamera?: CameraDecision[];
  draftCuts?: CutDecision[];
  focusRequest?: { timeUs: number; nonce: number } | null;
  durationUs: number;
  markers?: number[];
  onChangeAudio: (item: AudioDecision) => void;
  onChangeAsset?: (item: AssetDecision) => void;
  onChangeTitle?: (item: TitleDecision) => void;
  onDropTitle?: (preset: TitlePresetId, atUs: number) => void;
  onDropAsset?: (assetId: string, atUs: number, kind: AssetDecision["kind"]) => void;
  onChangeCamera: (item: CameraDecision) => void;
  onChangeCut: (item: CutDecision) => void;
  onAddAudio: () => void;
  onAddSource: (path?: string) => void;
  onSeek: (timeUs: number) => void;
  onSelect: (selection: TimelineSelection) => void;
  playheadUs: number;
  selected: TimelineSelection;
  sourceName: string;
  sourcePlaced: boolean;
  edl: EdlManifest;
  onTrimVideo: (sourceInUs: number, sourceOutUs: number) => void;
  onSplitVideo: (sourceUs: number) => void;
  onTrimVideoToSelection: () => void;
  onRemoveVideo: () => void;
}

type DragState = {
  edge?: "start" | "end";
  id: string;
  originEndUs: number;
  originStartUs: number;
  pointerX: number;
  track: "cuts" | "camera" | "audio" | "assets" | "titles";
};

export function EditorTimeline({
  projectId,
  visualSourceKey,
  audio,
  assets = [],
  titles = [],
  transitions = [],
  audioEvents = [],
  selectedAudioEventId,
  onAudioEventClick,
  audioPresent = false,
  audioPlaced,
  camera,
  cuts,
  draftCamera = [],
  draftCuts = [],
  focusRequest,
  durationUs,
  markers = [],
  onChangeAudio,
  onChangeAsset,
  onChangeTitle,
  onDropTitle,
  onDropAsset,
  onChangeCamera,
  onChangeCut,
  onAddAudio,
  onAddSource,
  onSeek,
  onSelect,
  playheadUs,
  selected,
  sourceName,
  sourcePlaced,
  edl,
  onTrimVideo,
  onSplitVideo,
  onTrimVideoToSelection,
  onRemoveVideo,
}: EditorTimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const horizontalRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(900);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [collapsedAssets, setCollapsedAssets] = useState<Record<string, boolean>>({});
  const visualKey = `${projectId}:${visualSourceKey}`;
  const thumbnailCache = useRef<{ key: string; values: Record<number, string>; failed: Set<number> }>({ key: visualKey, values: {}, failed: new Set() });
  const [thumbnailState, setThumbnails] = useState<{ key: string; values: Record<number, string> }>({ key: visualKey, values: {} });
  const [waveformState, setWaveform] = useState<{ key: string; view: WaveformView } | null>(null);
  const [waveformError, setWaveformError] = useState<string | null>(null);
  const thumbnails = thumbnailState.key === visualKey ? thumbnailState.values : {};
  const waveformKey = `${visualKey}:${Math.max(0, Number(audio.find((item) => item.operation === "source_stream")?.parameters.index ?? 0))}`;
  const waveform = waveformState?.key === waveformKey ? waveformState.view : null;
  const waveformD = useMemo(() => waveform ? waveformPath(waveform.peaks) : "", [waveform]);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(
    () => Number(localStorage.getItem("cheto.editor.timelineZoom")) || 8,
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  const [videoMenu, setVideoMenu] = useState<{ x: number; y: number; sourceUs: number } | null>(null);
  const [trimPreview, setTrimPreview] = useState<{ edge: "start" | "end"; sourceUs: number } | null>(null);
  const [preview, setPreview] = useState<{
    id: string;
    startUs: number;
    endUs: number;
    track: "cuts" | "camera" | "audio" | "assets" | "titles";
  } | null>(null);
  const safeDuration = Math.max(1, durationUs);
  const videoSegments = manualClipSegments(edl, safeDuration);
  const trimStart = trimPreview?.edge === "start" ? trimPreview.sourceUs : videoSegments[0]?.startUs ?? 0;
  const trimEnd = trimPreview?.edge === "end" ? trimPreview.sourceUs : videoSegments.at(-1)?.endUs ?? safeDuration;
  const contentWidth = timelineWidth(
    safeDuration,
    pixelsPerSecond,
    Math.max(300, viewportWidth - 74),
  );
  useEffect(() => {
    if (!focusRequest || !viewportRef.current) return;
    const viewport = viewportRef.current;
    viewport.scrollLeft = Math.max(0, usToPixels(focusRequest.timeUs, pixelsPerSecond) + 74 - viewport.clientWidth / 2);
  }, [focusRequest, pixelsPerSecond]);
  const stepUs = rulerStepUs(pixelsPerSecond);
  const visibleStartUs = Math.max(0, pixelsToUs(Math.max(0, scrollLeft - 74), pixelsPerSecond));
  const visibleEndUs = Math.min(safeDuration, pixelsToUs(Math.max(0, scrollLeft - 74) + viewportWidth, pixelsPerSecond));
  const streamIndex = Math.max(0, Number(audio.find((item) => item.operation === "source_stream")?.parameters.index ?? 0));
  const fadeInUs = Math.min(safeDuration, Math.max(0, Number(audio.find((item) => item.operation === "fade_in")?.parameters.durationUs ?? 0)));
  const fadeOutUs = Math.min(safeDuration, Math.max(0, Number(audio.find((item) => item.operation === "fade_out")?.parameters.durationUs ?? 0)));
  const thumbnailTimes = useMemo(
    () => visibleThumbnailTimes(visibleStartUs, visibleEndUs, pixelsPerSecond),
    [visibleStartUs, visibleEndUs, pixelsPerSecond],
  );

  useEffect(() => {
    if (!sourcePlaced || !canLoadTimelineVisuals()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (thumbnailCache.current.key !== visualKey) thumbnailCache.current = { key: visualKey, values: {}, failed: new Set() };
        for (const timeUs of thumbnailTimes) {
          if (cancelled) return;
          if (thumbnailCache.current.values[timeUs] || thumbnailCache.current.failed.has(timeUs)) continue;
          try {
            const url = await timelineThumbnail(projectId, timeUs);
            if (cancelled) return;
            if (thumbnailCache.current.key !== visualKey) return;
            thumbnailCache.current.values[timeUs] = url;
            const cachedTimes = Object.keys(thumbnailCache.current.values);
            if (cachedTimes.length > 180) {
              for (const stale of cachedTimes.slice(0, 30)) delete thumbnailCache.current.values[Number(stale)];
            }
            setThumbnails({ key: visualKey, values: { ...thumbnailCache.current.values } });
          } catch {
            if (!cancelled && thumbnailCache.current.key === visualKey) thumbnailCache.current.failed.add(timeUs);
          }
        }
      })();
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [projectId, sourcePlaced, thumbnailTimes, visualKey]);

  useEffect(() => {
    if (!sourcePlaced || !audioPlaced || !audioPresent || !canLoadTimelineVisuals() || visibleEndUs <= visibleStartUs) return;
    let cancelled = false;
    const bins = Math.max(64, Math.min(800, Math.round(viewportWidth / 2)));
    const timer = window.setTimeout(() => {
      void timelineWaveform(projectId, streamIndex, visibleStartUs, visibleEndUs, bins)
        .then((view) => { if (!cancelled) { setWaveform({ key: waveformKey, view }); setWaveformError(null); } })
        .catch(() => { if (!cancelled) { setWaveform(null); setWaveformError(waveformKey); } });
    }, 240);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [audioPlaced, audioPresent, projectId, sourcePlaced, streamIndex, visibleEndUs, visibleStartUs, viewportWidth, waveformKey]);

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
      ...audio.flatMap((item) => [item.startUs, item.endUs]),
      ...assets.flatMap((item) => [item.startUs, item.endUs]),
      ...titles.flatMap((item) => [item.startUs, item.endUs]),
      ...transitions.map((item) => item.atUs),
    ],
    [assets, audio, camera, cuts, titles, transitions, markers, playheadUs, safeDuration],
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
    if (event.shiftKey && !event.ctrlKey) {
      event.preventDefault();
      if (viewportRef.current) viewportRef.current.scrollLeft += event.deltaX || event.deltaY;
      return;
    }
    if (!event.ctrlKey) return;
    event.preventDefault();
    zoom(
      pixelsPerSecond * (event.deltaY < 0 ? 1.2 : 1 / 1.2),
      Math.min(1, Math.max(0, (event.clientX - (viewportRef.current?.getBoundingClientRect().left ?? 0)) / Math.max(1, viewportWidth))),
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
  const timeAtClient = (clientX: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return 0;
    const bounds = viewport.getBoundingClientRect();
    return Math.max(0, Math.min(safeDuration, pixelsToUs(clientX - bounds.left + viewport.scrollLeft - 74, pixelsPerSecond)));
  };
  const trimHandle = (event: PointerEvent<HTMLSpanElement>, edge: "start" | "end") => {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setTrimPreview({ edge, sourceUs: edge === "start" ? trimStart : trimEnd });
  };
  const moveTrimHandle = (event: PointerEvent<HTMLSpanElement>) => {
    if (!trimPreview || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const snapped = snapTimeUs(timeAtClient(event.clientX), snapCandidates, pixelsPerSecond, event.altKey);
    setTrimPreview({ edge: trimPreview.edge, sourceUs: trimPreview.edge === "start" ? Math.min(snapped, trimEnd - 100_000) : Math.max(snapped, trimStart + 100_000) });
  };
  const finishTrimHandle = () => {
    if (!trimPreview) return;
    onTrimVideo(trimPreview.edge === "start" ? trimPreview.sourceUs : trimStart, trimPreview.edge === "end" ? trimPreview.sourceUs : trimEnd);
    setTrimPreview(null);
  };
  const scrub = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    seekAt(event.clientX);
  };

  const beginDrag = (
    event: PointerEvent<HTMLSpanElement>,
    track: "cuts" | "camera" | "audio" | "assets" | "titles",
    item: CutDecision | CameraDecision | AudioDecision | AssetDecision | TitleDecision,
    edge?: "start" | "end",
  ) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect({ id: item.id, track });
    onSeek(track === "titles" ? Math.min(item.endUs - 1, item.startUs + Math.max(200_000, (item as TitleDecision).animationInUs)) : item.startUs);
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
    } else if (drag.track === "camera") {
      const item = camera.find((value) => value.id === drag.id);
      if (item)
        onChangeCamera({
          ...item,
          startUs: preview.startUs,
          endUs: preview.endUs,
        });
    } else if (drag.track === "assets") {
      const item = assets.find(value => value.id === drag.id);
      if (item) onChangeAsset?.({ ...item, startUs: preview.startUs, endUs: preview.endUs });
    } else if (drag.track === "titles") {
      const item = titles.find(value => value.id === drag.id);
      if (item) onChangeTitle?.({ ...item, startUs: preview.startUs, endUs: preview.endUs });
    } else {
      const item = audio.find((value) => value.id === drag.id);
      if (item)
        onChangeAudio({
          ...item,
          startUs: preview.startUs,
          endUs: preview.endUs,
        });
    }
    setDrag(null);
    setPreview(null);
  };
  const displayedRange = (
    track: "cuts" | "camera" | "audio" | "assets" | "titles",
    item: CutDecision | CameraDecision | AudioDecision | AssetDecision | TitleDecision,
  ) => (preview?.track === track && preview.id === item.id ? preview : item);

  const dropAsset = (event: import("react").DragEvent<HTMLDivElement>, kind: AssetDecision["kind"]) => {
    event.preventDefault();
    const assetId = event.dataTransfer.getData("application/x-cheto-asset-id");
    if (!assetId || !viewportRef.current) return;
    const bounds = viewportRef.current.getBoundingClientRect();
    const raw = pixelsToUs(event.clientX - bounds.left + viewportRef.current.scrollLeft - 74, pixelsPerSecond);
    onDropAsset?.(assetId, Math.max(0, Math.min(safeDuration, snapTimeUs(raw, snapCandidates, pixelsPerSecond, event.altKey))), kind);
  };
  const dropTitle = (event: import("react").DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const preset = event.dataTransfer.getData("application/x-cheto-title-preset") as TitlePresetId;
    if (!preset || !viewportRef.current) return;
    const bounds = viewportRef.current.getBoundingClientRect();
    const raw = pixelsToUs(event.clientX - bounds.left + viewportRef.current.scrollLeft - 74, pixelsPerSecond);
    onDropTitle?.(preset, Math.max(0, Math.min(safeDuration, snapTimeUs(raw, snapCandidates, pixelsPerSecond, event.altKey))));
  };

  return (
    <div className="editor-timeline" aria-label="Línea de tiempo de edición" onContextMenu={event => event.preventDefault()} onPointerDown={() => videoMenu && setVideoMenu(null)}>
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
        onScroll={(event) => { const left = event.currentTarget.scrollLeft; setScrollLeft(left); if (horizontalRef.current && horizontalRef.current.scrollLeft !== left) horizontalRef.current.scrollLeft = left; }}
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
          <TimelineLane contentWidth={contentWidth} label="Video" tone="video" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const path = event.dataTransfer.getData("application/x-cheto-media-path"); if (path) onAddSource(path); else if ((event.dataTransfer.getData("application/x-cheto-source") || event.dataTransfer.getData("text/plain")) === projectId) onAddSource(); }}>
            {sourcePlaced ? <>{videoSegments.map((segment, index) => <span
              className={`editor-timeline-block is-video ${selected?.track === "video" && selected.id === segment.id ? "is-selected" : ""}`}
              key={segment.id}
              onClick={event => { onSelect({ id: segment.id, track: "video" }); seekAt(event.clientX); }}
              onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onSelect({ id: segment.id, track: "video" }); setVideoMenu({ x: event.clientX, y: event.clientY, sourceUs: timeAtClient(event.clientX) }); }}
              role="button" tabIndex={0}
              style={{ left: usToPixels(index === 0 ? trimStart : segment.startUs, pixelsPerSecond), width: Math.max(4, usToPixels((index === videoSegments.length - 1 ? trimEnd : segment.endUs) - (index === 0 ? trimStart : segment.startUs), pixelsPerSecond)) }}
              title={`${sourceName}\nInicio ${formatTimecode(segment.startUs)}\nFinal ${formatTimecode(segment.endUs)}`}
            >{index === 0 ? <i className="timeline-video-trim-handle left" aria-label="Recortar inicio" onPointerDown={event => trimHandle(event,"start")} onPointerMove={moveTrimHandle} onPointerUp={finishTrimHandle} title={`Inicio ${formatTimecode(trimStart)}`}/> : null}{index === videoSegments.length - 1 ? <i className="timeline-video-trim-handle right" aria-label="Recortar final" onPointerDown={event => trimHandle(event,"end")} onPointerMove={moveTrimHandle} onPointerUp={finishTrimHandle} title={`Final ${formatTimecode(trimEnd)}`}/> : null}</span>)}
            <div className="timeline-thumbnails" aria-hidden="true">
              {thumbnailTimes.map((timeUs) => (
                <span className={`timeline-thumbnail-slot ${thumbnails[timeUs] ? "is-ready" : ""}`} key={timeUs} style={{ left: usToPixels(timeUs, pixelsPerSecond) }}>
                  {thumbnails[timeUs] ? <img src={thumbnails[timeUs]} alt="" /> : null}
                </span>
              ))}
            </div>
            <span className="timeline-video-name" title={sourceName}>{sourceName}</span>
            </> : <button className="timeline-empty-source" onClick={() => onAddSource()} type="button">Arrastra el video desde Medios o pulsa para añadirlo</button>}
          </TimelineLane>
          <TimelineLane contentWidth={contentWidth} label="Títulos" tone="titles" onDragOver={event => event.preventDefault()} onDrop={dropTitle}>
            {titles.filter(item => item.endUs >= visibleStartUs && item.startUs <= visibleEndUs).map(item => <span
              className={`editor-timeline-block is-editable is-title ${selected?.track === "titles" && selected.id === item.id ? "is-selected" : ""}`}
              key={item.id}
              onPointerDown={event => beginDrag(event, "titles", item)}
              onPointerMove={updateDrag}
              onPointerUp={finishDrag}
              style={{left:usToPixels(displayedRange("titles",item).startUs,pixelsPerSecond),width:Math.max(8,usToPixels(displayedRange("titles",item).endUs-displayedRange("titles",item).startUs,pixelsPerSecond))}}
              title={`${item.text} · ${formatTimecode(item.startUs)} → ${formatTimecode(item.endUs)}`}
            ><i className="timeline-handle left" onPointerDown={event => beginDrag(event,"titles",item,"start")}/><b>{item.text || "Título"}</b><i className="timeline-handle right" onPointerDown={event => beginDrag(event,"titles",item,"end")}/></span>)}
          </TimelineLane>
          <TimelineLane contentWidth={contentWidth} label="Transiciones" tone="transitions">
            {transitions.filter(item => item.atUs + item.durationUs >= visibleStartUs && item.atUs <= visibleEndUs).map(item => <button className={`editor-timeline-block is-transition ${selected?.track === "transitions" && selected.id === item.id ? "is-selected" : ""}`} key={item.id} onClick={() => {onSelect({track:"transitions",id:item.id});onSeek(item.atUs);}} style={{left:usToPixels(item.atUs,pixelsPerSecond),width:Math.max(14,usToPixels(item.durationUs,pixelsPerSecond))}} title={`${item.kind} · ${formatTimecode(item.atUs)}`} type="button">{item.kind}</button>)}
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
                className={cuts.some(existing => ["overlap", "conflict"].includes(classifyCut(item, existing))) ? "is-draft is-conflict" : "is-draft"}
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
                className={camera.some(existing => { const relation = classifyInterval(item, existing); return relation !== "new" && relation !== "touching" && (relation === "overlap" || relation === "contains" || existing.mode !== item.mode || Math.abs((existing.zoom ?? 1) - (item.zoom ?? 1)) > 0.01 || Math.abs((existing.centerX ?? 0.5) - (item.centerX ?? 0.5)) > 0.02 || Math.abs((existing.centerY ?? 0.5) - (item.centerY ?? 0.5)) > 0.02); }) ? "is-draft is-conflict" : "is-draft"}
                endUs={item.endUs}
                key={`draft-${item.id}`}
                label={`Propuesta ${cameraLabel(item.mode)}`}
                pixelsPerSecond={pixelsPerSecond}
                startUs={item.startUs}
              />
            ))}
          </TimelineLane>
          {audioPresent ? <TimelineLane contentWidth={contentWidth} label="Audio" tone="audio">
              {audioPlaced ? <><TimelineBlock className="is-audio" endUs={safeDuration} label={`Pista ${streamIndex + 1} · Audio original`} pixelsPerSecond={pixelsPerSecond} startUs={0} onClick={() => onSelect({ id: "source-audio", track: "audio-source" })} selected={selected?.track === "audio-source"} title={`Pista ${streamIndex + 1} · Audio original · ${formatTimecode(safeDuration)}`} /><span className="timeline-audio-name">Pista {streamIndex + 1} · Audio original</span></> : <button className="timeline-empty-source" onClick={onAddAudio} type="button">Audio fuera de la timeline · pulsa para restaurarlo</button>}
              {audioPlaced && waveform && waveform.endUs > waveform.startUs ? <svg className="timeline-waveform" aria-label="Forma de onda real" preserveAspectRatio="none" style={{ left: usToPixels(waveform.startUs, pixelsPerSecond), width: usToPixels(waveform.endUs - waveform.startUs, pixelsPerSecond) }} viewBox={`0 0 ${waveform.peaks.length} 34`}><path d={waveformD} /></svg> : null}
              {audioPlaced && audioEvents.map(event => <button aria-label={`Ir a voz probable en ${formatTimecode(event.startUs)}`} className={`timeline-audio-ai-event ${selectedAudioEventId === event.id ? "is-selected" : ""}`} key={event.id} onClick={click => { click.stopPropagation(); onAudioEventClick?.(event); }} style={{ left: usToPixels(event.startUs, pixelsPerSecond), width: Math.max(3, usToPixels(event.endUs - event.startUs, pixelsPerSecond)) }} title={`Voz probable · ${formatTimecode(event.startUs)} → ${formatTimecode(event.endUs)}`} type="button" />)}
              {audioPlaced && !waveform && canLoadTimelineVisuals() ? <span className="timeline-waveform-status">{waveformError === waveformKey ? "Onda no disponible" : "Analizando audio real…"}</span> : null}
              {audioPlaced && fadeInUs > 0 ? <span aria-label="Fade in" className="timeline-fade-visual is-in" style={{ left: 0, width: usToPixels(fadeInUs, pixelsPerSecond) }} /> : null}
              {audioPlaced && fadeOutUs > 0 ? <span aria-label="Fade out" className="timeline-fade-visual is-out" style={{ left: usToPixels(safeDuration - fadeOutUs, pixelsPerSecond), width: usToPixels(fadeOutUs, pixelsPerSecond) }} /> : null}
              {audioPlaced && audio.filter((item) => !(item.startUs === 0 && item.endUs === safeDuration)).map((item) => (
                  <EditableAudioBlock
                    item={item}
                    key={item.id}
                    onMove={updateDrag}
                    onRelease={finishDrag}
                    onStart={beginDrag}
                    pixelsPerSecond={pixelsPerSecond}
                    range={displayedRange("audio", item)}
                    selected={selected?.track === "audio" && selected.id === item.id}
                  />
              ))}
              {audioPlaced ? <div className="timeline-audio-badges">{audio.filter((item) => item.startUs === 0 && item.endUs === safeDuration && item.operation !== "source_stream").map((item) => <button className={selected?.track === "audio" && selected.id === item.id ? "is-selected" : ""} key={item.id} onClick={() => onSelect({ id: item.id, track: "audio" })} title={audioLabel(item)} type="button">{audioLabel(item)}</button>)}</div> : null}
            </TimelineLane> : null}
          {(["sfx", "music", "overlay"] as const).map(kind => <TimelineLane
            collapsed={Boolean(collapsedAssets[kind])}
            contentWidth={contentWidth}
            key={kind}
            label={kind === "sfx" ? "SFX" : kind === "music" ? "Música" : "GIF"}
            onDragOver={event => event.preventDefault()}
            onDrop={event => dropAsset(event, kind)}
            onToggle={() => setCollapsedAssets(current => ({...current,[kind]:!current[kind]}))}
            tone={kind}
          >
            {assets.filter(item => item.kind === kind && item.endUs >= visibleStartUs && item.startUs <= visibleEndUs).map(item => <EditableAssetBlock
              item={item}
              key={item.id}
              onMove={updateDrag}
              onRelease={finishDrag}
              onStart={beginDrag}
              pixelsPerSecond={pixelsPerSecond}
              range={displayedRange("assets",item)}
              selected={selected?.track === "assets" && selected.id === item.id}
            />)}
          </TimelineLane>)}
          {markers.map((marker, index) => (
            <button
              aria-label={`Ir al marcador ${index + 1}`}
              className={`editor-timeline-marker ${selected?.track === "marker" && selected.id === String(marker) ? "is-selected" : ""}`}
              key={`${marker}-${index}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelect({ id: String(marker), track: "marker" });
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
      {videoMenu ? <div className="timeline-video-context-menu" role="menu" style={{ left: videoMenu.x, top: videoMenu.y }} onPointerDown={event => event.stopPropagation()}>{[
        ["Cortar aquí", () => onSplitVideo(videoMenu.sourceUs)],
        ["Dividir clip", () => onSplitVideo(videoMenu.sourceUs)],
        ["Establecer inicio aquí", () => onTrimVideo(videoMenu.sourceUs, trimEnd)],
        ["Establecer final aquí", () => onTrimVideo(trimStart, videoMenu.sourceUs)],
        ["Recortar al rango seleccionado", onTrimVideoToSelection],
        ["Duplicar · aún no disponible", null],
        ["Quitar de la timeline", onRemoveVideo],
      ].map(([label, action]) => <button disabled={!action} key={label as string} onClick={() => { (action as () => void)(); setVideoMenu(null); }} role="menuitem" type="button">{label as string}</button>)}</div> : null}
      <div aria-label="Desplazamiento horizontal de timeline" className="editor-timeline-horizontal" onScroll={event => { const left = event.currentTarget.scrollLeft; setScrollLeft(left); if (viewportRef.current && viewportRef.current.scrollLeft !== left) viewportRef.current.scrollLeft = left; }} ref={horizontalRef}><div style={{ width: contentWidth + 74, height: 1 }} /></div>
    </div>
  );
}

function TimelineLane({
  collapsed,
  children,
  contentWidth,
  label,
  onDragOver,
  onDrop,
  onToggle,
  tone,
}: {
  children: ReactNode;
  collapsed?: boolean;
  contentWidth: number;
  label: string;
  onDragOver?: (event: import("react").DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: import("react").DragEvent<HTMLDivElement>) => void;
  onToggle?: () => void;
  tone: string;
}) {
  return (
    <div className={`editor-timeline-lane editor-timeline-lane-${tone}`} onDragOver={onDragOver} onDrop={onDrop}>
      {onToggle ? <button aria-label={`${collapsed ? "Expandir" : "Colapsar"} pista ${label}`} className="editor-asset-lane-toggle" onClick={onToggle} type="button">{collapsed ? "▸" : "▾"} {label}</button> : <strong>{label}</strong>}
      <div className="editor-timeline-track" style={{ width: contentWidth, display: collapsed ? "none" : undefined }}>
        {children}
      </div>
    </div>
  );
}
function TimelineBlock({
  className = "",
  endUs,
  label,
  onClick,
  pixelsPerSecond,
  selected = false,
  startUs,
  title,
}: {
  className?: string;
  endUs: number;
  label: string;
  onClick?: (event?: import("react").MouseEvent<HTMLSpanElement>) => void;
  pixelsPerSecond: number;
  selected?: boolean;
  startUs: number;
  title?: string;
}) {
  return (
    <span
      className={`editor-timeline-block ${className} ${selected ? "is-selected" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); } } : undefined}
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
  if (item.operation === "gain_range") return (typeof item.parameters.gainDb === "number" ? item.parameters.gainDb : 0) + " dB";
  if (item.operation === "noise_reduction_range") return "Limpiar";
  if (item.operation === "noise_reduction") return "Ruido";
  if (item.operation === "voice_focus") return "Voz";
  if (item.operation === "hum_filter") return "Hum";
  if (item.operation === "normalize") return "Normalizar";
  if (item.operation === "peak_limiter") return "Picos";
  if (item.operation === "master_gain") return "Gain";
  if (item.operation === "fade_in") return "Fade in";
  if (item.operation === "fade_out") return "Fade out";
  if (item.operation === "mute") return "Silenciado";
  if (item.operation === "notch_range") return "Pitido";
  return item.operation;
}

function EditableAudioBlock({
  item,
  onMove,
  onRelease,
  onStart,
  pixelsPerSecond,
  range,
  selected,
}: {
  item: AudioDecision;
  onMove: (event: PointerEvent<HTMLSpanElement>) => void;
  onRelease: () => void;
  onStart: (
    event: PointerEvent<HTMLSpanElement>,
    track: "cuts" | "camera" | "audio",
    item: CutDecision | CameraDecision | AudioDecision,
    edge?: "start" | "end",
  ) => void;
  pixelsPerSecond: number;
  range: { startUs: number; endUs: number };
  selected: boolean;
}) {
  const label = audioLabel(item);
  return (
    <span
      className={`editor-timeline-block is-editable is-audio-operation audio-op-${item.operation} ${selected ? "is-selected" : ""}`}
      onPointerDown={(event) => onStart(event, "audio", item)}
      onPointerMove={onMove}
      onPointerUp={onRelease}
      style={{
        left: usToPixels(range.startUs, pixelsPerSecond),
        width: Math.max(8, usToPixels(range.endUs - range.startUs, pixelsPerSecond)),
      }}
      title={label + "\n" + formatTimecode(range.startUs) + " → " + formatTimecode(range.endUs)}
    >
      <i className="timeline-handle left" onPointerDown={(event) => onStart(event, "audio", item, "start")} />
      <b>{label}</b>
      <i className="timeline-handle right" onPointerDown={(event) => onStart(event, "audio", item, "end")} />
    </span>
  );
}

function EditableAssetBlock({ item, onMove, onRelease, onStart, pixelsPerSecond, range, selected }: {
  item: AssetDecision;
  onMove: (event: PointerEvent<HTMLSpanElement>) => void;
  onRelease: () => void;
  onStart: (event: PointerEvent<HTMLSpanElement>, track: "cuts" | "camera" | "audio" | "assets", item: CutDecision | CameraDecision | AudioDecision | AssetDecision, edge?: "start" | "end") => void;
  pixelsPerSecond: number;
  range: { startUs: number; endUs: number };
  selected: boolean;
}) {
  const name = item.assetPath.split(/[\\/]/).at(-1) ?? item.kind;
  return <span
    className={`editor-timeline-block is-editable is-asset asset-${item.kind} ${selected ? "is-selected" : ""}`}
    onPointerDown={event => onStart(event, "assets", item)}
    onPointerMove={onMove}
    onPointerUp={onRelease}
    style={{ left: usToPixels(range.startUs, pixelsPerSecond), width: Math.max(8, usToPixels(range.endUs - range.startUs, pixelsPerSecond)) }}
    title={`${name} · ${formatTimecode(range.startUs)} → ${formatTimecode(range.endUs)}`}
  ><i className="timeline-handle left" onPointerDown={event => onStart(event, "assets", item, "start")}/><b>{item.muted ? "× " : ""}{name}</b><i className="timeline-handle right" onPointerDown={event => onStart(event, "assets", item, "end")}/></span>;
}
