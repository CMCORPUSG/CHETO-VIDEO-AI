import { BookmarkPlus, Camera, CheckCircle2, ChevronLeft, ChevronRight, Cpu, Download, FileVideo, Film, Gauge, Headphones, Library, LoaderCircle, Move, PanelLeftClose, PanelRightClose, Redo2, RotateCcw, Scissors, Trash2, Type, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { formatFileSize } from "../../lib/format";
import type { AssetDecision, ProjectBundle, TitleDecision, TitlePresetId, TransitionDecision, TransitionKind } from "../../project/contracts";
import type { LogLevel } from "../../types/diagnostics";
import { preferredPlaybackKind, type PlaybackPreference, type PlaybackSource, type ProxyStatus } from "../../playback/models";
import { cancelProxy, createProxy, getProxyStatus, onProxyDiagnostic, onProxyProgress, formatCommandError, playbackErrorMessage, resolvePlaybackSource } from "../../playback/service";
import type { CameraPreview } from "../../smart-camera/models";
import { editedDurationUs, previewRange, removedDurationUs, selectionRange, withLinkedSourcePlacement, type DraftTracks, type PreviewRange } from "../../editor/edl";
import { applyManualTrim, clipBounds, splitManualClip } from "../../editor/manual-trim";
import { clampPanelWidth, resolveAspectRatio, type AspectMode } from "../../editor/layout";
import { DEFAULT_CANVAS_SCALE, normalizeCanvasScale } from "../../editor/canvas-transform";
import { applyReanalysisCleanup, loadProjectBundle, previewReanalysisCleanup, saveProjectEdl } from "../../project/service";
import { projectContextDiagnostic, responseMatchesProject, type ProjectContext } from "../../project/isolation";
import type { EdlManifest } from "../../project/contracts";
import { Button } from "../Button";
import { Card } from "../Card";
import { SmartCutWorkspace } from "./SmartCutWorkspace";
import { SmartCameraWorkspace } from "./SmartCameraWorkspace";
import { EditorTimeline, type TimelineSelection } from "./EditorTimeline";
import { TimelineInspector } from "./TimelineInspector";
import { ExportModal } from "./ExportModal";
import { VideoPlayer } from "./VideoPlayer";
import { ResultPlayer } from "./ResultPlayer";
import { AudioInspector, AudioWorkspace } from "./AudioWorkspace";
import { MediaLibrary } from "./MediaLibrary";
import { AssetLibraryWorkspace } from "./AssetLibraryWorkspace";
import { AssetInspector } from "./AssetInspector";
import { TitleWorkspace } from "./TitleWorkspace";
import { createTitleRenderGate } from "../../visual/title-render";
import type { BackgroundMode, FitMode } from "../../export/models";
import { createTitle } from "../../visual/titles";
import { normalizeTemplateInstance, resolveManifest } from "../../templates/engine";
import { TEMPLATE_REGISTRY, type TemplateManifest } from "../../templates/registry";
import { editLayerLayout, resolveLayerLayout } from "../../templates/layers";
import { createAssetDecision } from "../../assets/decisions";
import { loadAssets, saveAssets, type LibraryAsset } from "../../assets/library";
import { listBuiltinAssets } from "../../assets/service";
import { addImportedMedia, loadImportedMedia, mediaFromProbe, removeImportedMedia, saveImportedMedia, type ImportedMedia } from "../../media/library";
import { probeVideo, selectVideoPath } from "../../media/service";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import type { AudioAnalysis, AudioAnalysisProgress, AudioEvent } from "../../editor/audio-intelligence";

interface MediaWorkspaceProps {
  bundle: ProjectBundle;
  context: ProjectContext;
  onReplaceSource: (path: string) => Promise<void>;
  onLog: (message: string, level?: LogLevel) => void;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
}

const initialStatus: ProxyStatus = { message: null, metadata: null, processedUs: null, progress: null, state: "not_created" };
function storedWidth(key: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
function storedNumber(key: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) ? value : fallback;
}
function storedCanvasScale(key: string) {
  if (typeof window === "undefined") return DEFAULT_CANVAS_SCALE;
  return normalizeCanvasScale(window.localStorage.getItem(key), DEFAULT_CANVAS_SCALE);
}

export function MediaWorkspace({ bundle, context, onReplaceSource, onLog, onNotify }: MediaWorkspaceProps) {
  const projectId = context.canonicalProjectId;
  const [status, setStatus] = useState<ProxyStatus>(initialStatus);
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const mounted = useRef(true);
  const proxyGenerating = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (proxyGenerating.current) void cancelProxy(projectId).catch(() => {}); }; }, [projectId]);
  const registryReported = useRef(false);
  useEffect(() => {
    if (registryReported.current) return;
    registryReported.current = true;
    onLog(`TEMPLATE_REGISTRY_LOADED count=${TEMPLATE_REGISTRY.listTemplates().length}`);
    for (const error of TEMPLATE_REGISTRY.errors) onLog(`TEMPLATE_VALIDATION_FAILED ${error}`, "error");
  }, [onLog]);
  const [error, setError] = useState<string | null>(null);
  const [requestedSeekUs, setRequestedSeekUs] = useState<number | null>(null);
  const [cameraPreview, setCameraPreview] = useState<CameraPreview | null>(null);
  const [cameraLivePreview, setCameraLivePreview] = useState(false);
  const [titleLivePreview, setTitleLivePreview] = useState(false);
  const [titleOverlayVisible, setTitleOverlayVisible] = useState(false);
  const [selectedTitleLayerId, setSelectedTitleLayerId] = useState<string | null>(null);
  const [titleTextEditing, setTitleTextEditing] = useState(false);
  const handleResultReady = useCallback(() => setTitleOverlayVisible(false), []);
  const titleRenderGate = useRef<ReturnType<typeof createTitleRenderGate> | null>(null);
  const [importedMedia, setImportedMedia] = useState<ImportedMedia[]>(() => loadImportedMedia(projectId));
  const [selectedMediaPath, setSelectedMediaPath] = useState(bundle.source.path);
  const [previewMediaPath, setPreviewMediaPath] = useState<string | null>(null);
  const [replacementPath, setReplacementPath] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const primaryMedia: ImportedMedia = { path: bundle.source.path, fileName: bundle.source.fileName, durationUs: bundle.source.durationUs ?? 0, width: bundle.source.video.displayWidth ?? bundle.source.video.width, height: bundle.source.video.displayHeight ?? bundle.source.video.height, fps: bundle.source.video.fps.decimal, sizeBytes: bundle.source.fileSizeBytes, lastModifiedMs: null };
  const mediaItems = [primaryMedia, ...importedMedia.filter(item => item.path !== bundle.source.path)];
  const selectedMedia = mediaItems.find(item => item.path === selectedMediaPath) ?? primaryMedia;
  const previewMedia = mediaItems.find(item => item.path === previewMediaPath) ?? null;

  const [edl, setEdl] = useState<EdlManifest>(bundle.edl);
  const edlSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const edlSaveRevision = useRef(0);
  const lastEdlRevisionMs = useRef(Number.isFinite(Date.parse(bundle.edl.updatedAt)) ? Date.parse(bundle.edl.updatedAt) : 0);
  const currentProjectId = useRef(projectId);
  useEffect(() => { currentProjectId.current = projectId; }, [projectId]);
  const [activeTool, setActiveTool] = useState<"project"|"cut"|"camera"|"audio"|"assets"|"titles">("project");
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>(loadAssets);
  const [builtinAssets, setBuiltinAssets] = useState<LibraryAsset[]>([]);
  const allAssets = [...builtinAssets, ...libraryAssets];
  useEffect(() => { saveAssets(libraryAssets); }, [libraryAssets]);
  useEffect(() => { let active = true; void listBuiltinAssets().then(items => {
    if (!active) return;
    let saved: unknown = [];
    try { saved = JSON.parse(localStorage.getItem("cheto.builtinFavorites.v1") ?? "[]"); } catch { /* reset malformed preference */ }
    const favorites = new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : []);
    setBuiltinAssets(items.map(item => ({ ...item, favorite: favorites.has(item.id) })));
  }).catch(() => {}); return () => { active = false; }; }, []);
  const updateAllAssets = (items: LibraryAsset[]) => {
    const builtins = items.filter(item => item.origin === "builtin");
    setBuiltinAssets(builtins);
    setLibraryAssets(items.filter(item => item.origin !== "builtin"));
    localStorage.setItem("cheto.builtinFavorites.v1", JSON.stringify(builtins.filter(item => item.favorite).map(item => item.id)));
  };
  const [previewMode, setPreviewMode] = useState<"original"|"result">(bundle.edl.sourceOnTimeline === false ? "original" : "result");
  const [viewerScale, setViewerScale] = useState(() => storedWidth("cheto.editor.viewerScale.v2", 78));
  const [aspectMode, setAspectMode] = useState<AspectMode>("original");
  const [customAspectWidth, setCustomAspectWidth] = useState(16);
  const [customAspectHeight, setCustomAspectHeight] = useState(9);
  const playheadUs = useRef(0);
  useEffect(() => {
    const gate = createTitleRenderGate(() => {
      setRequestedSeekUs(playheadUs.current);
      setTitleLivePreview(false);
    });
    titleRenderGate.current = gate;
    return () => { gate.cancel(); titleRenderGate.current = null; };
  }, []);
  const cameraRenderGate = useRef<ReturnType<typeof createTitleRenderGate> | null>(null);
  useEffect(() => {
    const gate = createTitleRenderGate(() => {
      setRequestedSeekUs(playheadUs.current);
      setCameraLivePreview(false);
    });
    cameraRenderGate.current = gate;
    return () => { gate.cancel(); cameraRenderGate.current = null; };
  }, []);
  const [visiblePlayheadUs, setVisiblePlayheadUs] = useState(0);
  const markerStorageKey = `cheto.editor.markers.${projectId}`;
  const [markers, setMarkers] = useState<number[]>(() => {
    try {
      const value = window.localStorage.getItem(markerStorageKey);
      const parsed: unknown = value ? JSON.parse(value) : [];

      return Array.isArray(parsed)
        ? parsed.filter((item): item is number => typeof item === "number")
        : [];
    } catch {
      return [];
    }
  });
  const [draftTracks, setDraftTracks] = useState<DraftTracks|null>(null);
  const [draftRange, setDraftRange] = useState<PreviewRange|null>(null);
  const [selectionInUs, setSelectionInUs] = useState<number|null>(null);
  const [selectionOutUs, setSelectionOutUs] = useState<number|null>(null);
  const [timelineSelection, setTimelineSelection] = useState<TimelineSelection>(null);
  const [timelineFocus, setTimelineFocus] = useState<{ timeUs: number; nonce: number } | null>(null);
  const [audioAnalysisState, setAudioAnalysisState] = useState<{ stream: number; value: AudioAnalysis } | null>(null);
  const [audioAnalysisBusy, setAudioAnalysisBusy] = useState(false);
  const [audioAnalysisProgress, setAudioAnalysisProgress] = useState<AudioAnalysisProgress | null>(null);
  const [audioAnalysisError, setAudioAnalysisError] = useState<string | null>(null);
  const [selectedAudioEventId, setSelectedAudioEventId] = useState<string | null>(null);
  const analysisStreamIndex = Number(edl.tracks.audio.find(item => item.operation === "source_stream")?.parameters.index ?? 0);
  const audioAnalysis = audioAnalysisState?.stream === analysisStreamIndex ? audioAnalysisState.value : null;
  const [undoStack, setUndoStack] = useState<EdlManifest[]>([]);
  const [redoStack, setRedoStack] = useState<EdlManifest[]>([]);
  const progressBucket = useRef(-1);
  const [toolsWidth, setToolsWidth] = useState(() => storedWidth("cheto.editor.toolsWidth.v2", 340));
  const [inspectorWidth, setInspectorWidth] = useState(() => storedWidth("cheto.editor.inspectorWidth", 320));
  const [timelineHeight, setTimelineHeight] = useState(() => Math.min(Math.max(300, storedWidth("cheto.editor.timelineHeight", 320)), Math.max(220, window.innerHeight - 360)));
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [audioVolume, setAudioVolume] = useState(1);
  const [audioMuted, setAudioMuted] = useState(false);
  const [audioRate, setAudioRate] = useState(1);
  const [audioPreviewEpoch, setAudioPreviewEpoch] = useState(0);
  const canvasScaleKey = `cheto.editor.canvasScale.${projectId}`;
  const canvasOffsetXKey = `cheto.editor.canvasOffsetX.${projectId}`;
  const canvasOffsetYKey = `cheto.editor.canvasOffsetY.${projectId}`;
  const [canvasScale, setCanvasScale] = useState(() => storedCanvasScale(canvasScaleKey));
  const [canvasOffsetX, setCanvasOffsetX] = useState(() => storedNumber(canvasOffsetXKey, 0));
  const [canvasOffsetY, setCanvasOffsetY] = useState(() => storedNumber(canvasOffsetYKey, 0));
  const [fitMode, setFitMode] = useState<FitMode>(() => (localStorage.getItem(`cheto.editor.fitMode.${projectId}`) as FitMode | null) ?? "cover");
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(() => (localStorage.getItem(`cheto.editor.backgroundMode.${projectId}`) as BackgroundMode | null) ?? "black");
  const [backgroundColor, setBackgroundColor] = useState(() => localStorage.getItem(`cheto.editor.backgroundColor.${projectId}`) ?? "#000000");
  const resizeRef = useRef<{ side: "left" | "right" | "vertical"; startX: number; startY: number; startWidth: number } | null>(null);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (!resize) return;
      const available = Math.max(640, window.innerWidth);
      if (resize.side === "vertical") {
        setTimelineHeight(clampPanelWidth(resize.startWidth + resize.startY - event.clientY, 150, Math.max(220, window.innerHeight - 360)));
      } else if (resize.side === "left") {
        setToolsWidth(clampPanelWidth(resize.startWidth + event.clientX - resize.startX, 280, 420));
      } else {
        const maxWidth = Math.max(260, Math.min(520, available - toolsWidth - 520));
        setInspectorWidth(clampPanelWidth(resize.startWidth + resize.startX - event.clientX, 240, maxWidth));
      }
    };

    const stopResize = () => {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [toolsWidth]);

  useEffect(() => { window.localStorage.setItem("cheto.editor.toolsWidth.v2", String(Math.round(toolsWidth))); }, [toolsWidth]);
  useEffect(() => { window.localStorage.setItem("cheto.editor.inspectorWidth", String(Math.round(inspectorWidth))); }, [inspectorWidth]);
  useEffect(() => { window.localStorage.setItem("cheto.editor.timelineHeight", String(Math.round(timelineHeight))); }, [timelineHeight]);
  useEffect(() => { window.localStorage.setItem("cheto.editor.viewerScale.v2", String(Math.round(viewerScale))); }, [viewerScale]);
  useEffect(() => { window.localStorage.setItem(markerStorageKey, JSON.stringify(markers)); }, [markerStorageKey, markers]);
  const canvasScaleWarning = useRef(false);
  useEffect(() => {
    const raw = window.localStorage.getItem(canvasScaleKey);
    if (raw !== null && normalizeCanvasScale(raw) !== Number(raw) && !canvasScaleWarning.current) {
      canvasScaleWarning.current = true;
      onLog("CANVAS_SCALE_NORMALIZED", "warning");
    }
  }, [canvasScaleKey, onLog]);
  useEffect(() => { window.localStorage.setItem(canvasScaleKey, String(canvasScale)); }, [canvasScale, canvasScaleKey]);
  useEffect(() => { window.localStorage.setItem(canvasOffsetXKey, String(canvasOffsetX)); }, [canvasOffsetX, canvasOffsetXKey]);
  useEffect(() => { localStorage.setItem(`cheto.editor.fitMode.${projectId}`, fitMode); }, [fitMode, projectId]);
  useEffect(() => { localStorage.setItem(`cheto.editor.backgroundMode.${projectId}`, backgroundMode); }, [backgroundMode, projectId]);
  useEffect(() => { localStorage.setItem(`cheto.editor.backgroundColor.${projectId}`, backgroundColor); }, [backgroundColor, projectId]);
  useEffect(() => { window.localStorage.setItem(canvasOffsetYKey, String(canvasOffsetY)); }, [canvasOffsetY, canvasOffsetYKey]);

  const beginInspectorResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    resizeRef.current = {
      side: "right",
      startX: event.clientX,
      startY: event.clientY,
      startWidth: inspectorWidth,
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    event.preventDefault();
  };

  const beginToolsResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    resizeRef.current = { side: "left", startX: event.clientX, startY: event.clientY, startWidth: toolsWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    event.preventDefault();
  };

  const beginVerticalResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    resizeRef.current = { side: "vertical", startX: event.clientX, startY: event.clientY, startWidth: timelineHeight };
    document.body.style.cursor = "row-resize"; document.body.style.userSelect = "none"; event.preventDefault();
  };

  const resolveSource = useCallback(async (nextPreference: PlaybackPreference, currentStatus?: ProxyStatus) => {
    try {
      const effective = nextPreference === "proxy" && currentStatus && preferredPlaybackKind(currentStatus, nextPreference) === "original" ? "original" : nextPreference;
      const resolved = await resolvePlaybackSource(projectId, effective);
      if (!mounted.current) return;
      if (!responseMatchesProject(projectId, resolved.projectId, bundle.source.sourceId, resolved.sourceId)) {
        onLog(`PLAYBACK_PROJECT_MISMATCH activeProjectId=${projectId} resolvedProjectId=${resolved.projectId} sourceId=${resolved.sourceId}`, "error");
        return;
      }
      setSource(resolved);
      setError(null);
    } catch (reason) {
      const message = formatCommandError(reason, { command: "get_playback_source", projectId, preference: nextPreference });
      if (!mounted.current) return;
      setError(message);
      onLog(`PLAYBACK_ERROR ${message}`, "error");
    }
  }, [bundle.source.sourceId, onLog, projectId]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void)[] = [];
    void Promise.all([
      onProxyProgress((progress) => {
        if (disposed || progress.projectId !== projectId) return;
        setStatus((current) => ({ ...current, state: progress.status, progress: progress.progress, processedUs: progress.processedUs }));
        const bucket = Math.floor(progress.progress / 25);
        if (bucket > progressBucket.current && progress.status === "generating") {
          progressBucket.current = bucket;
          onLog("PROXY_PROGRESS");
        }
      }),
      onProxyDiagnostic((diagnostic) => {
        if (!disposed && diagnostic.projectId === projectId) onLog(diagnostic.event, diagnostic.event.includes("FAILED") ? "error" : diagnostic.event.includes("FALLBACK") || diagnostic.event.includes("STALE") ? "warning" : "info");
      }),
    ]).then((unlisteners) => {
      if (disposed) unlisteners.forEach((unlisten) => unlisten());
      else cleanup = unlisteners;
    });
    void getProxyStatus(projectId).then((next) => {
      if (disposed) return;
      setStatus(next);
      if (next.state === "stale") onLog("PROXY_STALE", "warning");
      return resolveSource("auto", next);
    }).catch((reason) => {
      if (!disposed) {
        const message = formatCommandError(reason, { command: "get_proxy_status", projectId });
        setError(message);
        onLog(`PLAYBACK_ERROR ${message}`, "error");
      }
    });
    return () => { disposed = true; cleanup.forEach((unlisten) => unlisten()); };
  }, [onLog, projectId, resolveSource]);

  const startProxy = async () => {
    proxyGenerating.current = true;
    setError(null);
    setStatus((current) => ({ ...current, state: "preparing", progress: 0 }));
    progressBucket.current = -1;
    try {
      const next = await createProxy(projectId);
      if (!mounted.current) return;
      setStatus(next);
      if (next.state === "available") {
        await resolveSource("proxy", next);
        onNotify("Proxy de trabajo disponible");
      }
    } catch (reason) {
      if (!mounted.current) return;
      const message = playbackErrorMessage(reason);
      setStatus((current) => ({ ...current, message, state: "error" }));
      setError(message);
      onNotify(message, "error");
    } finally {
      proxyGenerating.current = false;
    }
  };

  const stopProxy = async () => {
    try { setStatus(await cancelProxy(projectId)); onNotify("Cancelación solicitada", "info"); }
    catch (reason) { onNotify(playbackErrorMessage(reason), "error"); }
  };

  const durationUs = bundle.source.durationUs ?? 0;
  const handleCameraPreview = useCallback((value: CameraPreview | null) => {
    setCameraPreview(value);
    if (value) setPreviewMode("result");
  }, []);
  const sourcePlaced = edl.sourceOnTimeline !== false;
  const contextReady = context.status === "ready" && edl.projectId === projectId && edl.sourceId === context.sourceId
    && source?.projectId === projectId && source.sourceId === context.sourceId;
  const activeContext: ProjectContext = {
    ...context,
    status: contextReady ? "ready" : "loading",
    proxyPath: source?.kind === "proxy" ? source.path : null,
    edlRevision: edl.updatedAt,
  };
  const audioPlaced = edl.audioOnTimeline !== false;
  const recommend = durationUs >= 30 * 60 * 1_000_000 || bundle.source.fileSizeBytes >= 1_000_000_000;
  const isGenerating = status.state === "preparing" || status.state === "generating";
  const proxyAvailable = status.state === "available";
  const proxy = status.metadata?.proxy;
  const removedUs=removedDurationUs(edl.tracks.cuts,durationUs);
  const resultUs=sourcePlaced?editedDurationUs(durationUs,edl.tracks.cuts):0;
  const runPreview=(seconds:10|30)=>{const current=playheadUs.current;setDraftRange(previewRange(current,seconds,durationUs));setPreviewMode("result");setRequestedSeekUs(current);};
  const runSelection=()=>{const range=selectionRange(selectionInUs,selectionOutUs,durationUs);if(range){setDraftRange(range);setPreviewMode("result");setRequestedSeekUs(range.startUs);}};
  const updatePlayhead=useCallback((value:number)=>{playheadUs.current=value;setVisiblePlayheadUs(value);},[]);
  const toggleMarker=useCallback(()=>{
    const current=Math.round(playheadUs.current/1000)*1000;

    setMarkers((currentMarkers)=>{
      const existing=currentMarkers.find(
        (marker)=>Math.abs(marker-current)<=250_000,
      );

      if(existing!==undefined){
        return currentMarkers.filter(
          (marker)=>marker!==existing,
        );
      }

      return [...currentMarkers,current].sort(
        (a,b)=>a-b,
      );
    });
  },[]);
  const handlePlaybackError=useCallback((message:string)=>{const detailed=formatCommandError(message,{projectId,sourcePath:source?.path ?? bundle.source.path,mode:previewMode,edlRevision:edl.updatedAt});setError(detailed);onLog(`PLAYBACK_ERROR ${detailed}`,"error");if(message.includes("Resultado"))onLog(`RESULT_PREVIEW_FAILED ${detailed}`,"error");},[bundle.source.path,edl.updatedAt,onLog,previewMode,projectId,source?.path]);
  const sourceAspect = (bundle.source.video.displayWidth ?? bundle.source.video.width ?? 16) / Math.max(1, bundle.source.video.displayHeight ?? bundle.source.video.height ?? 9);
  const aspectRatio = resolveAspectRatio(aspectMode, sourceAspect, customAspectWidth, customAspectHeight);
  const persistEdl = useCallback(async (next: EdlManifest) => {
    if (!contextReady || next.projectId !== projectId || next.sourceId !== context.sourceId) {
      onLog(`PROJECT_CONTEXT_MISMATCH ${projectContextDiagnostic(context)}`, "error");
      return;
    }
    const beforeRevision = edl.updatedAt;
    const nextRevisionMs = Math.max(Date.now(), lastEdlRevisionMs.current + 1);
    lastEdlRevisionMs.current = nextRevisionMs;
    const stamped = { ...next, updatedAt: new Date(nextRevisionMs).toISOString() };
    const appliedAudio = next.tracks.audio.filter(item => typeof item.parameters.audioAiEventId === "string"
      && !edl.tracks.audio.some(previous => previous.id === item.id));
    const appliedAssets = (next.tracks.assets ?? []).filter(item => !(edl.tracks.assets ?? []).some(previous => previous.id === item.id));
    const revision = ++edlSaveRevision.current;
    setEdl(stamped);
    const save = edlSaveQueue.current.then(() => saveProjectEdl(stamped));
    edlSaveQueue.current = save.catch(() => undefined);
    try { const saved = await save; if (currentProjectId.current !== projectId || !mounted.current) return; if (revision === edlSaveRevision.current) setEdl(saved); for (const item of appliedAudio) onLog(`AUDIO_AI_EVENT_APPLIED canonicalProjectId=${projectId} decisionId=${item.id} startUs=${item.startUs} endUs=${item.endUs} operation=${item.operation} edlRevisionBefore=${beforeRevision} edlRevisionAfter=${saved.updatedAt}`); for (const item of appliedAssets) onLog(`ASSET_APPLIED projectId=${projectId} assetId=${item.assetId} assetType=${item.kind} track=assets startUs=${item.startUs} edlRevisionBefore=${beforeRevision} edlRevisionAfter=${saved.updatedAt}`); }
    catch (reason) { if (revision === edlSaveRevision.current && currentProjectId.current === projectId) { const message=formatCommandError(reason,{command:"save_project_edl",projectId,edlRevision:stamped.updatedAt});onNotify(`No se pudo guardar el EDL: ${message}`,"error"); } }
  },[context,contextReady,edl,onLog,onNotify,projectId]);
  const adoptAppliedEdl = useCallback((next: EdlManifest) => { setUndoStack(stack => [...stack.slice(-49), edl]); setRedoStack([]); void persistEdl(next); }, [edl, persistEdl]);
  const focusConflict = useCallback((track: "cuts" | "camera", timeUs: number, existingId: string) => { setRequestedSeekUs(timeUs); setVisiblePlayheadUs(timeUs); setTimelineSelection({ track, id: existingId }); setTimelineFocus({ timeUs, nonce: Date.now() }); }, []);
  const beforeSmartApply = useCallback(() => edlSaveQueue.current, []);
  const commitEdl = useCallback((next: EdlManifest) => { setUndoStack(stack=>[...stack.slice(-49),edl]);setRedoStack([]);void persistEdl(next); },[edl,persistEdl]);
  const undo = useCallback(()=>{const previous=undoStack.at(-1);if(!previous)return;setUndoStack(stack=>stack.slice(0,-1));setRedoStack(stack=>[...stack,edl]);void persistEdl(previous);},[edl,persistEdl,undoStack]);
  const redo = useCallback(()=>{const next=redoStack.at(-1);if(!next)return;setRedoStack(stack=>stack.slice(0,-1));setUndoStack(stack=>[...stack,edl]);void persistEdl(next);},[edl,persistEdl,redoStack]);
  const changeCut=useCallback((item:EdlManifest["tracks"]["cuts"][number])=>commitEdl({...edl,tracks:{...edl.tracks,cuts:edl.tracks.cuts.map(value=>value.id===item.id?{...item,automation:item.automation?{...item.automation,origin:"manual",manualAction:"modified"}:undefined}:value)}}),[commitEdl,edl]);
  const trimVideo=useCallback((sourceInUs:number,sourceOutUs:number)=>{const bounds=clipBounds(edl,durationUs);if(Math.round(sourceInUs)===bounds.sourceInUs&&Math.round(sourceOutUs)===bounds.sourceOutUs)return;const next=applyManualTrim(edl,durationUs,sourceInUs,sourceOutUs);if(!next){onNotify("El recorte debe durar al menos 0.1 segundos.","error");return;}commitEdl(next);setPreviewMode("result");setRequestedSeekUs(next.manualTrim!.sourceInUs);},[commitEdl,durationUs,edl,onNotify]);
  const splitVideo=useCallback((sourceUs:number)=>{const next=splitManualClip(edl,durationUs,sourceUs);if(!next){onNotify("El punto de división debe estar dentro del clip.","error");return;}commitEdl(next);setTimelineSelection({track:"video",id:`source-${next.manualSplitPointsUs!.indexOf(Math.round(sourceUs))+1}`});},[commitEdl,durationUs,edl,onNotify]);
  const trimVideoToSelection=useCallback(()=>{const range=selectionRange(selectionInUs,selectionOutUs,durationUs);if(!range){onNotify("Marca Entrada y Salida antes de recortar.","error");return;}trimVideo(range.startUs,range.endUs);},[durationUs,onNotify,selectionInUs,selectionOutUs,trimVideo]);
  const {sourceInUs:clipInUs,sourceOutUs:clipOutUs}=clipBounds(edl,durationUs);
  const outsideTrimCount=[...edl.tracks.camera,...edl.tracks.audio.filter(item=>item.operation!=="source_stream"),...(edl.tracks.titles??[]),...(edl.tracks.assets??[])].filter(item=>item.endUs<=clipInUs||item.startUs>=clipOutUs).length+(edl.tracks.transitions??[]).filter(item=>item.atUs<clipInUs||item.atUs>=clipOutUs).length;
  const changeCamera=useCallback((item:EdlManifest["tracks"]["camera"][number])=>{setCameraLivePreview(true);cameraRenderGate.current?.schedule();commitEdl({...edl,tracks:{...edl.tracks,camera:edl.tracks.camera.map(value=>value.id===item.id?{...item,automation:item.automation?{...item.automation,origin:"manual",manualAction:"modified"}:undefined}:value)}});},[commitEdl,edl]);
  const changeAudio=useCallback((audio:EdlManifest["tracks"]["audio"])=>commitEdl({...edl,tracks:{...edl.tracks,audio}}),[commitEdl,edl]);
  const addTitle=useCallback((preset:TitlePresetId | TemplateManifest, atUs=visiblePlayheadUs)=>{const manifest=typeof preset==="string"?null:preset;const item=createTitle((manifest?.legacyPresetId ?? preset) as TitlePresetId,atUs,durationUs);if(manifest){item.templateId=manifest.templateId;item.templateVersion=manifest.templateVersion;item.templateSnapshot=manifest;item.parameters={};item.font=manifest.fontRefs.find(ref=>ref.startsWith("pack:"))??item.font;}commitEdl({...edl,tracks:{...edl.tracks,titles:[...(edl.tracks.titles??[]),item]}});setTimelineSelection({track:"titles",id:item.id});setPreviewMode("result");setTitleLivePreview(true);setTitleOverlayVisible(true);titleRenderGate.current?.schedule();setRequestedSeekUs(Math.min(item.endUs-1,item.startUs+Math.max(200_000,item.animationInUs)));onLog(`TEMPLATE_INSTANCE_CREATED templateId=${item.templateId} templateVersion=${item.templateVersion} instanceId=${item.instanceId}`);},[commitEdl,durationUs,edl,onLog,visiblePlayheadUs]);
  const changeTitle=useCallback((item:TitleDecision)=>{
    item=normalizeTemplateInstance(item,durationUs);
    const manifest=resolveManifest(item);
    if(manifest.error)onLog(manifest.error,"error");
    else if(manifest.fallbackUsed)onLog(`TEMPLATE_FALLBACK_USED templateId=${item.templateId} templateVersion=${item.templateVersion} instanceId=${item.instanceId}`,"warning");
    setTitleLivePreview(true);
    setTitleOverlayVisible(true);
    titleRenderGate.current?.schedule();
    if(visiblePlayheadUs<item.startUs||visiblePlayheadUs>=item.endUs){const at=Math.min(item.endUs-1,item.startUs+Math.max(200_000,item.animationInUs));setRequestedSeekUs(at);setVisiblePlayheadUs(at);}
    commitEdl({...edl,tracks:{...edl.tracks,titles:(edl.tracks.titles??[]).map(value=>value.id===item.id?item:value)}});
  },[commitEdl,durationUs,edl,onLog,visiblePlayheadUs]);
  const duplicateTitle=useCallback((item:TitleDecision)=>{
    const length=item.endUs-item.startUs;
    const start=Math.min(item.endUs,Math.max(0,durationUs-length));
    const id=globalThis.crypto.randomUUID();
    const copy={...item,id,instanceId:id,startUs:start,endUs:start+length,parameters:{...item.parameters}};
    commitEdl({...edl,tracks:{...edl.tracks,titles:[...(edl.tracks.titles??[]),copy]}});
    setTimelineSelection({track:"titles",id});
    setRequestedSeekUs(start+Math.min(600_000,length-1));
    onLog(`TEMPLATE_INSTANCE_CREATED templateId=${copy.templateId} templateVersion=${copy.templateVersion} instanceId=${id}`);
  },[commitEdl,durationUs,edl,onLog]);
  const addTransition=useCallback((kind:TransitionKind,atUs=visiblePlayheadUs)=>{const item:TransitionDecision={id:crypto.randomUUID(),kind,atUs:Math.max(0,Math.min(durationUs,atUs)),durationUs:600_000};commitEdl({...edl,tracks:{...edl.tracks,transitions:[...(edl.tracks.transitions??[]),item]}});setTimelineSelection({track:"transitions",id:item.id});setPreviewMode("result");},[commitEdl,durationUs,edl,visiblePlayheadUs]);
  const changeTransition=useCallback((item:TransitionDecision)=>commitEdl({...edl,tracks:{...edl.tracks,transitions:(edl.tracks.transitions??[]).map(value=>value.id===item.id?item:value)}}),[commitEdl,edl]);
  const addAssetPlacement=useCallback((asset:LibraryAsset,atUs:number)=>{const item=createAssetDecision(asset,atUs,durationUs);commitEdl({...edl,tracks:{...edl.tracks,assets:[...(edl.tracks.assets??[]),item]}});setTimelineSelection({track:"assets",id:item.id});},[commitEdl,durationUs,edl]);
  const changeAssetItem=useCallback((item:AssetDecision)=>{const previous=(edl.tracks.assets??[]).find(value=>value.id===item.id);commitEdl({...edl,tracks:{...edl.tracks,assets:(edl.tracks.assets??[]).map(value=>value.id===item.id?item:value)}});if(item.kind==="music"&&item.ducking&&!previous?.ducking)onLog("MUSIC_DUCKING_APPLIED");},[commitEdl,edl,onLog]);
  const duplicateAssetItem=useCallback(()=>{if(timelineSelection?.track!=="assets")return;const item=(edl.tracks.assets??[]).find(value=>value.id===timelineSelection.id);if(!item)return;const length=item.endUs-item.startUs;const start=Math.min(item.endUs,Math.max(0,durationUs-length));const copy={...item,id:globalThis.crypto.randomUUID(),startUs:start,endUs:start+length};commitEdl({...edl,tracks:{...edl.tracks,assets:[...(edl.tracks.assets??[]),copy]}});setTimelineSelection({track:"assets",id:copy.id});},[commitEdl,durationUs,edl,timelineSelection]);
  const relinkAsset=useCallback((asset:LibraryAsset)=>{const placements=edl.tracks.assets??[];if(placements.some(item=>item.assetId===asset.id))commitEdl({...edl,tracks:{...edl.tracks,assets:placements.map(item=>item.assetId===asset.id?{...item,assetPath:asset.path}:item)}});},[commitEdl,edl]);
  const focusAudioEvent=useCallback((event:AudioEvent)=>{setSelectedAudioEventId(event.id);setRequestedSeekUs(event.startUs);setVisiblePlayheadUs(event.startUs);setSelectionInUs(event.startUs);setSelectionOutUs(event.endUs);setTimelineFocus({timeUs:event.startUs,nonce:Date.now()});setTimelineSelection(null);setActiveTool("audio");},[]);
  const changeAudioItem=useCallback((item:EdlManifest["tracks"]["audio"][number])=>commitEdl({...edl,tracks:{...edl.tracks,audio:edl.tracks.audio.map(value=>value.id===item.id?item:value)}}),[commitEdl,edl]);
  const replaceCamera=useCallback((item:EdlManifest["tracks"]["camera"][number],conflictIds:string[])=>{
    const conflicts=new Set(conflictIds);
    setCameraLivePreview(true);
    cameraRenderGate.current?.schedule();
    commitEdl({...edl,tracks:{...edl.tracks,camera:edl.tracks.camera.filter(value=>value.id===item.id||!conflicts.has(value.id)).map(value=>value.id===item.id?{...item,automation:item.automation?{...item.automation,origin:"manual",manualAction:"modified"}:undefined}:value)}});
  },[commitEdl,edl]);
  const deleteSelected=useCallback(()=>{
    if(!timelineSelection)return;
    if(timelineSelection.track==="video") commitEdl(withLinkedSourcePlacement(edl,false));
    else if(timelineSelection.track==="audio-source") commitEdl({...edl,audioOnTimeline:false});
    else if(timelineSelection.track==="marker") setMarkers(current=>current.filter(value=>String(value)!==timelineSelection.id));
    else if(timelineSelection.track==="assets") commitEdl({...edl,tracks:{...edl.tracks,assets:(edl.tracks.assets??[]).filter(item=>item.id!==timelineSelection.id)}});
    else if(timelineSelection.track==="titles") commitEdl({...edl,tracks:{...edl.tracks,titles:(edl.tracks.titles??[]).filter(item=>item.id!==timelineSelection.id)}});
    else if(timelineSelection.track==="transitions") commitEdl({...edl,tracks:{...edl.tracks,transitions:(edl.tracks.transitions??[]).filter(item=>item.id!==timelineSelection.id)}});
    else commitEdl({...edl,tracks:{...edl.tracks,[timelineSelection.track]:edl.tracks[timelineSelection.track].filter(item=>item.id!==timelineSelection.id)}});
    setTimelineSelection(null);
  },[commitEdl,edl,timelineSelection]);
  const addSource=(path?:string)=>{ if(path && path!==bundle.source.path){ setSelectedMediaPath(path); setReplacementPath(path); setActiveTool("project"); return; } if(!sourcePlaced) commitEdl(withLinkedSourcePlacement(edl,true)); setTimelineSelection({id:"source-0",track:"video"}); setPreviewMode("result"); setPreviewMediaPath(null); };
  const importMedia=useCallback(async(path?:string)=>{setMediaBusy(true);try{const selected=path??await selectVideoPath();if(!selected)return;const result=await probeVideo(selected);const next=mediaFromProbe(result.metadata);setImportedMedia(current=>addImportedMedia(current,next));setSelectedMediaPath(next.path);onNotify(`Video importado: ${next.fileName}`);onLog(`MEDIA_IMPORTED ${next.fileName}`);}catch(reason){const message=reason instanceof Error?reason.message:typeof reason==="object"&&reason!==null&&"message" in reason?String(reason.message):String(reason);onNotify(`No se pudo importar el video: ${message}`,"error");onLog("MEDIA_IMPORT_ERROR","error");}finally{setMediaBusy(false);}},[onLog,onNotify]);
  const removeMedia=useCallback((path:string)=>{if(path===bundle.source.path)return;setImportedMedia(current=>removeImportedMedia(current,path,bundle.source.path));if(selectedMediaPath===path)setSelectedMediaPath(bundle.source.path);if(previewMediaPath===path){setPreviewMediaPath(null);setPreviewMode("result");}if(replacementPath===path)setReplacementPath(null);onNotify("Medio quitado de la biblioteca. El archivo original permanece en disco.");onLog(`MEDIA_REMOVED_FROM_LIBRARY ${path}`);},[bundle.source.path,onLog,onNotify,previewMediaPath,replacementPath,selectedMediaPath]);
  useEffect(()=>{saveImportedMedia(projectId,importedMedia);},[projectId,importedMedia]);
  useEffect(()=>{if(!isTauri())return;let disposed=false;let unlisten:(()=>void)|undefined;void getCurrentWindow().onDragDropEvent(event=>{if(disposed||event.payload.type!=="drop"||!event.payload.paths.length)return;if(activeTool==="assets")window.dispatchEvent(new CustomEvent("cheto-import-assets",{detail:event.payload.paths}));else void importMedia(event.payload.paths[0]);}).then(value=>{if(disposed)value();else unlisten=value;});return()=>{disposed=true;unlisten?.();};},[activeTool,importMedia,projectId]);
  const replaceSelectedSource=async()=>{if(!replacementPath)return;setMediaBusy(true);try{const old=primaryMedia;setImportedMedia(current=>addImportedMedia(current,old));saveImportedMedia(projectId,addImportedMedia(importedMedia,old));await onReplaceSource(replacementPath);setReplacementPath(null);setPreviewMediaPath(null);onNotify("Fuente sustituida. Añade el nuevo video a la timeline.");}catch(reason){onNotify(formatCommandError(reason,{command:"replace_source",projectId,sourcePath:replacementPath}),"error");}finally{setMediaBusy(false);}};
  const addAudio=()=>{ if(!audioPlaced) commitEdl({...edl,audioOnTimeline:true}); setTimelineSelection({id:"source-audio",track:"audio-source"}); };
  useEffect(()=>{const handler=(event:KeyboardEvent)=>{if(isTypingTarget(event.target)||titleTextEditing)return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="z"){event.preventDefault();if(event.shiftKey)redo();else undo();}else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="y"){event.preventDefault();redo();}else if(activeTool==="titles"&&selectedTitleLayerId&&timelineSelection?.track==="titles"&&["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)){const title=(edl.tracks.titles??[]).find(item=>item.id===timelineSelection.id);if(!title)return;event.preventDefault();const layout=resolveLayerLayout(title,selectedTitleLayerId,aspectRatio);const step=event.shiftKey?0.01:0.002;changeTitle(editLayerLayout(title,selectedTitleLayerId,aspectRatio,{x:layout.x+(event.key==="ArrowLeft"?-step:event.key==="ArrowRight"?step:0),y:layout.y+(event.key==="ArrowUp"?-step:event.key==="ArrowDown"?step:0)}));}else if(event.key==="Delete"&&timelineSelection){event.preventDefault();deleteSelected();}else if(event.key==="Delete"&&activeTool==="project"&&selectedMediaPath!==bundle.source.path){event.preventDefault();removeMedia(selectedMediaPath);}};window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler);},[activeTool,aspectRatio,bundle.source.path,changeTitle,deleteSelected,edl,redo,removeMedia,selectedMediaPath,selectedTitleLayerId,timelineSelection,titleTextEditing,undo]);
  const selectedCut=timelineSelection?.track==="cuts"?edl.tracks.cuts.find(item=>item.id===timelineSelection.id)??null:null;
  const selectedCamera=timelineSelection?.track==="camera"?edl.tracks.camera.find(item=>item.id===timelineSelection.id)??null:null;
  const selectedLiveTitle=timelineSelection?.track==="titles"?(edl.tracks.titles??[]).find(item=>item.id===timelineSelection.id)??null:null;
  const canvasTitle=activeTool==="titles" ? selectedLiveTitle ?? (edl.tracks.titles??[]).find(item=>visiblePlayheadUs>=item.startUs&&visiblePlayheadUs<item.endUs)??null : selectedLiveTitle;

  const proxyPanel=<div className="space-y-3"><MediaLibrary items={mediaItems} selectedPath={selectedMedia.path} sourcePath={bundle.source.path} busy={mediaBusy} onAdd={()=>addSource(selectedMedia.path)} onImport={()=>void importMedia()} onRemove={removeMedia} onSelect={path=>{setSelectedMediaPath(path);setReplacementPath(null);setTimelineSelection(null);}} onPreview={path=>{setSelectedMediaPath(path);setPreviewMediaPath(path);setPreviewMode("original");setRequestedSeekUs(0);setTimelineSelection(null);}}/>{replacementPath?<Card className="border-warning/40 bg-warning/5 p-3"><p className="text-[10px] font-bold text-warning">Este proyecto admite una fuente principal vinculada con su audio.</p><p className="mt-1 text-[9px] text-muted">Sustituirla reinicia cortes, encuadres y operaciones de audio. El archivo anterior seguirá en Medios y ninguno de los originales se modifica.</p><div className="mt-2 flex gap-2"><Button disabled={mediaBusy} onClick={()=>void replaceSelectedSource()}>Sustituir fuente</Button><Button onClick={()=>setReplacementPath(null)} variant="secondary">Cancelar</Button></div></Card>:null}<Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
          <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-cyan"><Film size={18} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan">Proxy de trabajo</p><h3 className="mt-1 font-bold text-ink">{proxyStateLabel(status.state)}</h3></div></div>
          <div className="flex flex-wrap gap-2">
            {!isGenerating && !proxyAvailable ? <Button onClick={() => void startProxy()}>{status.state === "stale" || status.state === "error" ? "Regenerar" : "Crear proxy"}</Button> : null}
            {isGenerating ? <Button onClick={() => void stopProxy()} variant="secondary">Cancelar</Button> : null}
            {source?.kind === "proxy" ? <Button onClick={() => void resolveSource("original")} variant="secondary">Usar original</Button> : null}
            {proxyAvailable && source?.kind !== "proxy" ? <Button onClick={() => void resolveSource("proxy", status)} variant="secondary">Usar proxy</Button> : null}
          </div>
        </div>
        {isGenerating ? <div className="mt-5"><div className="mb-2 flex justify-between text-xs font-semibold text-muted"><span>{status.state === "preparing" ? "Preparando" : "Generando"}</span><span>{status.progress === null ? "—" : `${Math.floor(status.progress)} %`}</span></div><div className="h-2 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-cyan transition-[width]" style={{ width: `${status.progress ?? 0}%` }} /></div></div> : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <ProxyDetail icon={<CheckCircle2 size={15} />} label="Estado" value={proxyStateLabel(status.state)} />
          <ProxyDetail icon={<Gauge size={15} />} label="Resolución" value={proxy ? `${proxy.width} × ${proxy.height}` : "—"} />
          <ProxyDetail icon={<Cpu size={15} />} label="Encoder" value={proxy?.encoder ?? "—"} />
          <ProxyDetail icon={<Film size={15} />} label="Tamaño" value={proxy ? formatFileSize(proxy.fileSizeBytes) : "—"} />
        </div>
        <p className="mt-5 text-xs text-muted">{recommend ? "Crear un proxy de trabajo puede mejorar la fluidez de edición." : "El archivo original puede reproducirse directamente."} El original siempre permanece como fuente maestra.</p>
      </Card></div>;
  const reanalyzeFromScratch = async (): Promise<boolean> => {
    if (!contextReady) return false;
    try {
      await edlSaveQueue.current;
      const plan = await previewReanalysisCleanup(projectId);
      const approved = window.confirm(`Reanalizar desde cero este proyecto?\n\nSe quitarán ${plan.automaticCameraCount} cámaras automáticas identificadas y se invalidarán las propuestas Smart Cut/Camera. Se conservarán cámaras manuales, títulos, audio, assets y SFX. ${plan.legacyUnclassifiedCameraCount} cámaras sin procedencia verificable se conservarán. Se guardará una copia del EDL antes del cambio.\n\n¿Continuar?`);
      if (!approved) return false;
      await applyReanalysisCleanup(projectId, plan.edlRevision);
      const refreshed = await loadProjectBundle(projectId);
      setEdl(refreshed.edl);
      lastEdlRevisionMs.current = Math.max(lastEdlRevisionMs.current, Date.parse(refreshed.edl.updatedAt) || 0);
      setUndoStack([]); setRedoStack([]); setDraftTracks(null); setCameraPreview(null);
      setTimelineSelection(null); setPreviewMode("result");
      onLog(`REANALYSIS_CLEANUP projectId=${projectId} automaticCameraRemoved=${plan.automaticCameraCount} manualOrUnknownPreserved=${plan.preservedCameraCount} edlRevisionBefore=${plan.edlRevision} edlRevisionAfter=${refreshed.edl.updatedAt}`);
      onNotify("Resultados automáticos anteriores invalidados; puedes reanalizar.");
      return true;
    } catch (reason) { onNotify(formatCommandError(reason), "error"); return false; }
  };
  const toolPanel=!contextReady?<Card className="p-5">Preparando contexto del proyecto…</Card>:activeTool==="project"?proxyPanel:activeTool==="cut"?<SmartCutWorkspace bundle={bundle} context={activeContext} edl={edl} onDraftChange={(cuts)=>setDraftTracks(current=>({camera:current?.camera??[],cuts}))} onEdlChange={adoptAppliedEdl} onBeforeApply={beforeSmartApply} onFocusConflict={(timeUs,id)=>focusConflict("cuts",timeUs,id)} onLog={onLog} onNotify={onNotify} onSeek={setRequestedSeekUs} onSelect={(id)=>setTimelineSelection({id,track:"cuts"})}/>:activeTool==="camera"?<SmartCameraWorkspace bundle={bundle} context={activeContext} edl={edl} onDraftChange={(camera)=>setDraftTracks(current=>({camera,cuts:current?.cuts??[]}))} onEdlChange={adoptAppliedEdl} onBeforeApply={beforeSmartApply} onFocusConflict={(timeUs,id)=>focusConflict("camera",timeUs,id)} onLog={onLog} onNotify={onNotify} onPreview={handleCameraPreview} onSeek={setRequestedSeekUs} onSelect={(id)=>setTimelineSelection({id,track:"camera"})} onReanalyzeFromScratch={reanalyzeFromScratch}/>:activeTool==="titles"?<TitleWorkspace onPackEvent={onLog} key={selectedLiveTitle?.id ?? "gallery"} selectedLayerId={selectedTitleLayerId} onSelectLayer={setSelectedTitleLayerId} onAddTitle={addTitle} onAddTransition={addTransition} selectedTitle={(edl.tracks.titles??[]).find(item=>timelineSelection?.track==="titles"&&item.id===timelineSelection.id)??null} selectedTransition={(edl.tracks.transitions??[]).find(item=>timelineSelection?.track==="transitions"&&item.id===timelineSelection.id)??null} onChangeTitle={changeTitle} onChangeTransition={changeTransition} onDuplicateTitle={duplicateTitle} durationUs={durationUs} aspectRatio={aspectRatio}/>:activeTool==="assets"?<AssetLibraryWorkspace assets={allAssets} edl={edl} markers={markers} onAssetsChange={updateAllAssets} onAdd={addAssetPlacement} onRelink={relinkAsset} onLog={onLog} playheadUs={visiblePlayheadUs}/>:<AudioWorkspace projectId={projectId} playheadUs={visiblePlayheadUs} onPreviewStart={()=>setAudioPreviewEpoch(value=>value+1)} analysis={audioAnalysis} analysisBusy={audioAnalysisBusy} setAnalysisBusy={setAudioAnalysisBusy} setAnalysisProgress={setAudioAnalysisProgress} analysisProgress={audioAnalysisProgress} analysisError={audioAnalysisError} setAnalysisError={setAudioAnalysisError} onAnalysisChange={value=>setAudioAnalysisState({stream:analysisStreamIndex,value})} selectedEventId={selectedAudioEventId} onEventFocus={focusAudioEvent} onLog={onLog} audio={edl.tracks.audio} assets={edl.tracks.assets??[]} durationUs={durationUs} hasAudio={bundle.source.audio.present} muted={audioMuted} onAudioChange={changeAudio} onMutedChange={setAudioMuted} onRateChange={setAudioRate} onVolumeChange={setAudioVolume} rate={audioRate} sourceAudioStreams={bundle.source.streams.audio} selectionInUs={selectionInUs} selectionOutUs={selectionOutUs} volume={audioVolume}/>;
  const panel=timelineSelection?.track==="assets"
    ? <AssetInspector item={(edl.tracks.assets??[]).find(item=>item.id===timelineSelection.id)??null} onChange={changeAssetItem} onDelete={deleteSelected} onDuplicate={duplicateAssetItem}/>
    : timelineSelection?.track==="titles" || timelineSelection?.track==="transitions"
    ? <TitleWorkspace onPackEvent={onLog} key={selectedLiveTitle?.id ?? "gallery"} selectedLayerId={selectedTitleLayerId} onSelectLayer={setSelectedTitleLayerId} onAddTitle={addTitle} onAddTransition={addTransition} selectedTitle={(edl.tracks.titles??[]).find(item=>timelineSelection?.track==="titles"&&item.id===timelineSelection.id)??null} selectedTransition={(edl.tracks.transitions??[]).find(item=>timelineSelection?.track==="transitions"&&item.id===timelineSelection.id)??null} onChangeTitle={changeTitle} onChangeTransition={changeTransition} onDuplicateTitle={duplicateTitle} durationUs={durationUs} aspectRatio={aspectRatio}/>
    : activeTool==="audio"
    ? <AudioInspector audio={edl.tracks.audio} durationUs={durationUs} hasAudio={bundle.source.audio.present} onAudioChange={changeAudio} projectId={projectId} selectedAudio={timelineSelection?.track==="audio"?edl.tracks.audio.find(item=>item.id===timelineSelection.id)??null:null} sourceAudioStreams={bundle.source.streams.audio} visualSourceKey={`${source?.path ?? bundle.source.path}:${bundle.source.fileSizeBytes}:${bundle.source.modifiedAt}:${status.metadata?.createdAt ?? ""}`}/>
    : <>{activeTool === "project" && timelineSelection?.track !== "video" ? <Card className="mb-3 p-3"><p className="text-[10px] font-bold text-cyan">Medio seleccionado</p><p className="mt-2 break-all text-[10px] text-ink">{selectedMedia.fileName}</p><p className="mt-1 font-mono text-[9px] text-muted">{formatShort(selectedMedia.durationUs)} · {selectedMedia.width ?? "?"} × {selectedMedia.height ?? "?"} · {selectedMedia.fps?.toFixed(2) ?? "?"} FPS</p><p className="mt-2 text-[9px] text-muted">{selectedMedia.path === bundle.source.path ? "Fuente activa del proyecto" : "Importado; aún no sustituye la fuente activa"}</p></Card> : null}{timelineSelection?.track==="video"?<Card className="mb-3 p-3"><p className="text-[10px] font-bold text-cyan">Clip VIDEO seleccionado</p><div className="mt-2 grid grid-cols-2 gap-2 text-[9px] text-muted"><span>Archivo</span><strong className="truncate text-ink" title={bundle.source.fileName}>{bundle.source.fileName}</strong><span>Duración</span><strong className="text-ink">{formatShort(durationUs)}</strong><span>Resolución</span><strong className="text-ink">{bundle.source.video.displayWidth??bundle.source.video.width} × {bundle.source.video.displayHeight??bundle.source.video.height}</strong><span>FPS</span><strong className="text-ink">{bundle.source.video.fps.decimal?.toFixed(2)??"—"}</strong><span>Aspect ratio</span><strong className="text-ink">{aspectRatio.toFixed(3)}:1</strong><span>Escala</span><strong className="text-ink">{canvasScale.toFixed(2)}×</strong><span>Posición X / Y</span><strong className="text-ink">{canvasOffsetX.toFixed(2)} / {canvasOffsetY.toFixed(2)}</strong><span>Reproducción</span><strong className="text-ink">{source?.kind === "proxy" ? "Proxy" : "Original"}</strong></div><Button className="mt-3" icon={<Trash2 size={12}/>} onClick={deleteSelected} variant="secondary">Quitar de la timeline</Button><p className="mt-2 text-[8px] text-muted">Video y audio permanecen vinculados. El original queda en Medios.</p></Card>:null}{!selectedCamera && !selectedCut && (activeTool === "project" || timelineSelection?.track === "video") ? <CanvasTransformPanel offsetX={canvasOffsetX} offsetY={canvasOffsetY} onOffsetX={setCanvasOffsetX} onOffsetY={setCanvasOffsetY} onReset={()=>{setCanvasScale(1);setCanvasOffsetX(0);setCanvasOffsetY(0);}} onScale={setCanvasScale} scale={canvasScale}/> : null}{timelineSelection?.track==="video"?null:<TimelineInspector camera={edl.tracks.camera} cut={selectedCut} durationUs={durationUs} item={selectedCamera} key={timelineSelection?timelineSelection.track+"-"+timelineSelection.id:"none"} onApplyCamera={changeCamera} onApplyCut={changeCut} onDelete={deleteSelected} onReplaceCamera={replaceCamera}/>}</>;
  const tools=[{id:"project" as const,label:"Medios",icon:<FileVideo size={18}/>,tone:"tool-project"},{id:"cut" as const,label:"Cortes",icon:<Scissors size={18}/>,tone:"tool-cut"},{id:"camera" as const,label:"Encuadre",icon:<Camera size={18}/>,tone:"tool-camera"},{id:"audio" as const,label:"Audio",icon:<Headphones size={18}/>,tone:"tool-audio"},{id:"assets" as const,label:"Multimedia",icon:<Library size={18}/>,tone:"tool-assets"},{id:"titles" as const,label:"Títulos",icon:<Type size={18}/>,tone:"tool-assets"}];
  return <div className={`editor-shell relative grid h-full min-h-0 overflow-hidden border border-line bg-surface shadow-2xl ${toolsCollapsed?"tools-collapsed":""} ${inspectorCollapsed?"inspector-collapsed":""}`} style={{ "--inspector-width": `${inspectorCollapsed?0:inspectorWidth}px`, "--timeline-height": `${timelineHeight}px`, "--tools-width": `${toolsCollapsed?44:toolsWidth}px` } as CSSProperties}>
    <nav className="editor-tool-panel overflow-hidden border-line bg-canvas/60"><div className="editor-tool-rail"><div className="flex items-center justify-center py-2"><button aria-label="Ocultar panel izquierdo" className="panel-collapse-button" onClick={()=>setToolsCollapsed(value=>!value)} type="button">{toolsCollapsed?<ChevronRight size={14}/>:<PanelLeftClose size={14}/>}</button></div>{tools.map(tool=><button className={"editor-tool-button flex min-w-0 flex-col items-center justify-center gap-1 border border-transparent px-1 py-2 text-[8px] font-semibold transition "+(activeTool===tool.id?"is-active "+tool.tone:"text-muted hover:bg-card hover:text-ink")} key={tool.id} onClick={()=>setActiveTool(tool.id)} title={tool.label} type="button">{tool.icon}<span className="truncate">{tool.label}</span></button>)}</div>{!toolsCollapsed?<div className="editor-tool-content min-h-0 overflow-auto border-l border-white/[0.055] p-2.5">{toolPanel}</div>:null}</nav>
    <button aria-label="Redimensionar panel de herramientas" className="editor-tools-resizer" onDoubleClick={() => setToolsWidth(340)} onPointerDown={beginToolsResize} title="Arrastra para cambiar el ancho. Doble clic para restablecer." type="button" />
    <section className="editor-viewer flex min-h-0 flex-col overflow-hidden bg-black/40 p-2">
      <div className="editor-viewer-toolbar mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center border border-line bg-canvas p-0.5"><button className={`px-2.5 py-1 text-[9px] font-bold ${previewMode==="original"?"bg-primary text-white":"text-muted"}`} onClick={()=>setPreviewMode("original")}>ORIGINAL</button><button className={`px-2.5 py-1 text-[9px] font-bold ${previewMode==="result"?"bg-primary text-white":"text-muted"}`} onClick={()=>setPreviewMode("result")}>RESULTADO</button></div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
          <label className="flex items-center gap-1 text-[9px] font-semibold text-muted"><span>Formato</span><select aria-label="Relación de aspecto" className="border border-line bg-canvas px-2 py-1 text-ink" onChange={(event)=>setAspectMode(event.target.value as AspectMode)} value={aspectMode}><option value="original">Original</option><option value="16:9">16:9</option><option value="4:3">4:3</option><option value="1:1">1:1 / 3:3</option><option value="9:16">9:16</option><option value="21:9">21:9</option><option value="custom">Personalizado</option></select></label>
          <label className="flex items-center gap-1 text-[9px] font-semibold text-muted"><span>Encaje</span><select aria-label="Modo de encaje" className="border border-line bg-canvas px-2 py-1 text-ink" onChange={event=>setFitMode(event.target.value as FitMode)} value={fitMode}><option value="cover">Completar pantalla</option><option value="contain">Ajustar completo</option><option value="center">Centro con fondo</option></select></label>
          {fitMode==="center"?<label className="flex items-center gap-1 text-[9px] font-semibold text-muted"><span>Fondo</span><select aria-label="Fondo del video" className="border border-line bg-canvas px-2 py-1 text-ink" onChange={event=>setBackgroundMode(event.target.value as BackgroundMode)} value={backgroundMode}><option value="black">Negro</option><option value="blur">Difuminado</option><option value="color">Color</option></select></label>:null}
          {fitMode==="center"&&backgroundMode==="color"?<input aria-label="Color de fondo" onChange={event=>setBackgroundColor(event.target.value)} type="color" value={backgroundColor}/>:null}
          {aspectMode==="custom"?<div className="flex items-center gap-1"><input aria-label="Ancho personalizado" className="w-11 border border-line bg-canvas px-1 py-1 text-center text-ink" min="1" onChange={(event)=>setCustomAspectWidth(Number(event.target.value)||1)} type="number" value={customAspectWidth}/><span className="text-muted">:</span><input aria-label="Alto personalizado" className="w-11 border border-line bg-canvas px-1 py-1 text-center text-ink" min="1" onChange={(event)=>setCustomAspectHeight(Number(event.target.value)||1)} type="number" value={customAspectHeight}/></div>:null}
          <div className="viewer-scale-control flex items-center gap-1.5" title="Tamaño del visor"><ZoomOut size={12}/><input aria-label="Tamaño del visor" max="100" min="35" onChange={(event)=>setViewerScale(Number(event.target.value))} step="5" type="range" value={viewerScale}/><span className="w-8 text-right font-mono text-[8px] text-muted">{Math.round(viewerScale)}%</span><ZoomIn size={12}/></div><Button className="editor-export-button" disabled={!sourcePlaced} icon={<Download size={12}/>} onClick={()=>setExportOpen(true)}>Exportar</Button>
        </div>
      </div>
      <div className="editor-viewer-stage flex min-h-0 flex-1 items-center justify-center overflow-hidden"><div className="relative mx-auto flex h-full w-full items-center justify-center">{contextReady && source && (sourcePlaced || previewMode==="original")?(previewMode==="result" && !previewMedia && !cameraPreview && !cameraLivePreview && !titleLivePreview && activeTool!=="titles" && isTauri() ? <ResultPlayer context={activeContext} key={`${projectId}:${bundle.source.sourceId}`} durationUs={durationUs} aspectRatio={aspectRatio} viewerScale={viewerScale} edl={edl} seekToUs={requestedSeekUs} onTimeChange={updatePlayhead} onError={handlePlaybackError} onDiagnostic={onLog} onReady={handleResultReady} liveTitle={titleOverlayVisible ? selectedLiveTitle : null} liveTitleTimeUs={visiblePlayheadUs} volume={audioVolume} muted={audioMuted||!audioPlaced} onMutedChange={setAudioMuted} onVolumeChange={setAudioVolume} playbackRate={audioRate} onPlaybackRateChange={setAudioRate} canvasScale={canvasScale} canvasOffsetX={canvasOffsetX} canvasOffsetY={canvasOffsetY} fitMode={fitMode} backgroundMode={backgroundMode} backgroundColor={backgroundColor} pauseEpoch={audioPreviewEpoch}/> : <VideoPlayer editableTitle={activeTool==="titles"&&!!canvasTitle} selectedTitleLayerId={selectedTitleLayerId} onSelectTitleLayer={id=>{setSelectedTitleLayerId(id);if(canvasTitle)setTimelineSelection({track:"titles",id:canvasTitle.id});}} onCommitTitle={changeTitle} onTitleEditingChange={setTitleTextEditing} liveTitle={activeTool==="titles" ? canvasTitle : titleOverlayVisible ? selectedLiveTitle : null} liveTitleTimeUs={visiblePlayheadUs} pauseEpoch={audioPreviewEpoch} fitMode={fitMode} backgroundMode={backgroundMode} backgroundColor={backgroundColor} aspectRatio={previewMedia && previewMedia.width && previewMedia.height ? previewMedia.width / previewMedia.height : aspectRatio} cameraPreview={previewMedia ? null : cameraPreview} canvasOffsetX={previewMedia ? 0 : canvasOffsetX} canvasOffsetY={previewMedia ? 0 : canvasOffsetY} canvasScale={previewMedia ? 1 : canvasScale} draftRange={previewMedia ? null : draftRange} draftTracks={previewMedia ? null : draftTracks} durationUs={previewMedia?.durationUs ?? source.durationUs} edl={edl} externalMuted={audioMuted||(previewMode==="result"&&(!audioPlaced||edl.tracks.audio.some(item=>item.operation==="mute")))} externalPlaybackRate={audioRate} externalVolume={audioVolume} key={previewMedia?.path ?? source.path} kind={previewMedia ? "original" : source.kind} markers={markers} mode={previewMode} onCanvasOffsetChange={(x,y)=>{setCanvasOffsetX(x);setCanvasOffsetY(y);}} onError={handlePlaybackError} onMutedChange={setAudioMuted} onPlaybackRateChange={setAudioRate} onTimeChange={previewMedia && previewMedia.path !== bundle.source.path ? undefined : updatePlayhead} onVolumeChange={setAudioVolume} path={previewMedia?.path ?? source.path} seekToUs={requestedSeekUs} viewerScale={viewerScale}/>):source && contextReady?<div className="p-6 text-center text-[11px] text-muted">Video fuera de la timeline. Arrástralo desde Medios para continuar.</div>:<div className="grid aspect-video place-items-center bg-black"><LoaderCircle className="animate-spin text-cyan"/></div>}</div></div>
      {error?<p className="mt-2 truncate text-[10px] text-danger" title={error}>{error}</p>:null}
    </section>
    <button
      aria-label="Redimensionar panel lateral"
      className="editor-inspector-resizer hidden xl:block"
      onDoubleClick={() => setInspectorWidth(360)}
      onPointerDown={beginInspectorResize}
      title="Arrastra para cambiar el ancho del panel. Doble clic para restablecer."
      type="button"
    />
    <aside className="editor-inspector-panel min-h-0 overflow-auto border-l border-line bg-canvas/30 p-2"><button aria-label="Ocultar panel derecho" className="panel-collapse-button mb-1" onClick={()=>setInspectorCollapsed(true)} type="button"><PanelRightClose size={14}/></button>{timelineSelection?.track==="video"?<Card className="mb-3 p-3"><strong className="text-[10px] text-cyan">Recorte temporal del clip</strong><div className="mt-2 grid grid-cols-2 gap-2 text-[9px]"><label>Inicio fuente<input aria-label="Inicio fuente en segundos" className="cheto-input mt-1" defaultValue={(clipInUs/1e6).toFixed(3)} key={`in-${clipInUs}`} min="0" onBlur={event=>trimVideo(Number(event.target.value)*1e6,clipOutUs)} step="0.001" type="number"/></label><label>Final fuente<input aria-label="Final fuente en segundos" className="cheto-input mt-1" defaultValue={(clipOutUs/1e6).toFixed(3)} key={`out-${clipOutUs}`} min="0" onBlur={event=>trimVideo(clipInUs,Number(event.target.value)*1e6)} step="0.001" type="number"/></label></div><p className="mt-2 text-[9px] text-muted">Duración usada: {formatShort(clipOutUs-clipInUs)} · {edl.manualSplitPointsUs?.length??0} divisiones</p>{outsideTrimCount>0?<p className="mt-2 text-[9px] text-warning">{outsideTrimCount} decisiones fuera del rango; permanecen en el EDL y no deben aparecer en Resultado.</p>:null}<div className="mt-2 flex flex-wrap gap-1"><Button onClick={()=>splitVideo(visiblePlayheadUs)} variant="secondary">Dividir en playhead</Button><Button disabled={!selectionRange(selectionInUs,selectionOutUs,durationUs)} onClick={trimVideoToSelection} variant="secondary">Recortar a selección</Button></div></Card>:null}{panel}</aside>
    {inspectorCollapsed?<button aria-label="Mostrar panel derecho" className="editor-inspector-open" onClick={()=>setInspectorCollapsed(false)} type="button"><ChevronLeft size={14}/></button>:null}
    <button aria-label="Redimensionar player y timeline" className="editor-horizontal-resizer" onDoubleClick={()=>setTimelineHeight(236)} onPointerDown={beginVerticalResize} title="Arrastra para dar más espacio al player o a la timeline" type="button"/>
    <section className="editor-timeline-panel overflow-hidden border-t border-line bg-canvas/65">
      <div className="editor-timeline-toolbar flex min-w-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        <div className="timeline-mode"><span>Edición</span><strong>{previewMode==="result"?"Resultado":"Original"}</strong></div><button aria-label="Deshacer" disabled={!undoStack.length} onClick={undo} title="Deshacer (Ctrl+Z)" type="button"><Undo2 size={13}/></button><button aria-label="Rehacer" disabled={!redoStack.length} onClick={redo} title="Rehacer (Ctrl+Y)" type="button"><Redo2 size={13}/></button><button aria-label="Eliminar seleccionado" className="timeline-action-delete" disabled={!timelineSelection} onClick={deleteSelected} title="Eliminar seleccionado" type="button"><Trash2 size={13}/></button><button aria-label="Agregar o quitar marcador" className="timeline-action-marker" onClick={toggleMarker} title="Agregar/quitar marcador en el cabezal" type="button"><BookmarkPlus size={13}/></button>
        <Metric label="Cortes" value={String(edl.tracks.cuts.length)}/><Metric label="Eliminado" value={formatShort(removedUs)}/><Metric label="Encuadres" value={String(edl.tracks.camera.length)}/><Metric label="Final" value={formatShort(resultUs)}/>
        <div className="timeline-selection-controls ml-auto flex min-w-0 flex-wrap justify-end gap-1"><Button className="editor-mark-in-button" onClick={()=>setSelectionInUs(playheadUs.current)} variant="secondary">Entrada {selectionInUs===null?"—":formatShort(selectionInUs)}</Button><Button className="editor-mark-out-button" onClick={()=>setSelectionOutUs(playheadUs.current)} variant="secondary">Salida {selectionOutUs===null?"—":formatShort(selectionOutUs)}</Button><Button className="editor-preview-button" onClick={()=>runPreview(10)}>Probar 10 s</Button><Button className="editor-preview-alt-button" onClick={()=>runPreview(30)} variant="secondary">Probar 30 s</Button><Button disabled={!selectionRange(selectionInUs,selectionOutUs,durationUs)} onClick={runSelection} variant="secondary">Probar selección</Button>{draftRange?<Button className="editor-close-preview-button" onClick={()=>setDraftRange(null)} variant="ghost">Cerrar prueba</Button>:null}</div>
      </div>
      <EditorTimeline edl={edl} onTrimVideo={trimVideo} onSplitVideo={splitVideo} onTrimVideoToSelection={trimVideoToSelection} onRemoveVideo={deleteSelected} focusRequest={timelineFocus} projectId={projectId} visualSourceKey={`${source?.path ?? bundle.source.path}:${bundle.source.fileSizeBytes}:${bundle.source.modifiedAt}:${status.metadata?.createdAt ?? ""}`} audio={edl.tracks.audio} assets={edl.tracks.assets??[]} titles={edl.tracks.titles??[]} transitions={edl.tracks.transitions??[]} onChangeTitle={changeTitle} onDropTitle={addTitle} onChangeAsset={changeAssetItem} onDropAsset={(assetId,atUs,kind)=>{const asset=allAssets.find(item=>item.id===assetId&&item.kind===kind);if(asset)addAssetPlacement(asset,atUs);}} audioEvents={audioAnalysis?.events ?? []} selectedAudioEventId={selectedAudioEventId} onAudioEventClick={focusAudioEvent} audioPresent={bundle.source.audio.present} audioPlaced={audioPlaced} sourcePlaced={sourcePlaced} onAddSource={addSource} onAddAudio={addAudio} camera={edl.tracks.camera} cuts={edl.tracks.cuts} draftCamera={draftTracks?.camera} draftCuts={draftTracks?.cuts} durationUs={durationUs} onChangeAudio={changeAudioItem} onChangeCamera={changeCamera} onChangeCut={changeCut} onSeek={(timeUs)=>{setRequestedSeekUs(timeUs);setVisiblePlayheadUs(timeUs);}} onSelect={(selection)=>{setTimelineSelection(selection);setPreviewMediaPath(null);if(selection?.track==="video"){setActiveTool("project");setPreviewMode("result");}else if(selection?.track==="audio"||selection?.track==="audio-source")setActiveTool("audio");else if(selection?.track==="assets")setActiveTool("assets");else if(selection?.track==="titles"||selection?.track==="transitions")setActiveTool("titles");else if(selection?.track==="cuts")setActiveTool("cut");else if(selection?.track==="camera"){setActiveTool("camera");setPreviewMode("result");}}} markers={markers} playheadUs={visiblePlayheadUs} selected={timelineSelection} sourceName={bundle.source.fileName}/>
    </section>
    <ExportModal fitMode={fitMode} backgroundMode={backgroundMode} backgroundColor={backgroundColor} aspectRatio={aspectRatio} bundle={bundle} canvasOffsetX={canvasOffsetX} canvasOffsetY={canvasOffsetY} canvasScale={canvasScale} edl={edl} onClose={()=>setExportOpen(false)} open={exportOpen && contextReady}/>
  </div>;
}

function Metric({label,value}:{label:string;value:string}){return <div className="editor-metric min-w-0 border border-line bg-panel/40 px-2 py-1"><span className="truncate text-[8px] font-bold uppercase text-muted">{label}</span><strong className="ml-1 font-mono text-[9px] text-ink">{value}</strong></div>}
function formatShort(us:number){const total=Math.max(0,Math.floor(us/1_000_000));return `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`}

function proxyStateLabel(state: ProxyStatus["state"]): string {
  return { available: "Disponible", cancelled: "Cancelado", error: "Error", generating: "Generando", not_created: "No creado", preparing: "Preparando", stale: "Desactualizado" }[state];
}

function ProxyDetail({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="min-w-0 rounded-lg border border-line bg-canvas/55 p-2.5"><div className="flex min-w-0 items-center gap-1.5 text-muted">{icon}<p className="min-w-0 text-[9px] font-bold uppercase leading-tight tracking-[0.08em]">{label}</p></div><p className="mt-1.5 break-words text-[11px] font-semibold leading-tight text-ink" title={value}>{value}</p></div>;
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
}





function CanvasTransformPanel({ offsetX, offsetY, onOffsetX, onOffsetY, onReset, onScale, scale }: {
  offsetX: number; offsetY: number; onOffsetX: (value:number)=>void; onOffsetY: (value:number)=>void; onReset: ()=>void; onScale: (value:number)=>void; scale: number;
}) {
  return (
    <div className="canvas-transform-panel border-b border-white/[0.055] p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2"><Move className="text-cyan/75" size={13}/><div><p className="text-[10px] font-semibold text-ink">Transformar lienzo</p><p className="mt-0.5 text-[8px] text-muted/45">Arrastra el video para reposicionarlo.</p></div></div>
        <button aria-label="Restablecer transformación" className="grid h-7 w-7 place-items-center rounded-md text-muted/55 hover:bg-white/[0.04] hover:text-ink" onClick={onReset} title="Restablecer" type="button"><RotateCcw size={13}/></button>
      </div>
      <TransformRange label="Escala" max={2.5} min={0.5} onChange={onScale} step={0.01} value={scale} valueLabel={Math.round(scale*100)+"%"} />
      <TransformRange label="Posición X" max={1} min={-1} onChange={onOffsetX} step={0.01} value={offsetX} valueLabel={Math.round(offsetX*100)+"%"} />
      <TransformRange label="Posición Y" max={1} min={-1} onChange={onOffsetY} step={0.01} value={offsetY} valueLabel={Math.round(offsetY*100)+"%"} />
    </div>
  );
}
function TransformRange({ label, max, min, onChange, step, value, valueLabel }: {
  label:string; max:number; min:number; onChange:(value:number)=>void; step:number; value:number; valueLabel:string;
}) {
  return <label className="mb-3 block"><span className="flex items-center justify-between text-[8px] font-medium text-muted/55">{label}<b className="font-mono font-medium text-ink/70">{valueLabel}</b></span><input className="mt-2 w-full accent-cyan" max={max} min={min} onChange={(event)=>onChange(Number(event.currentTarget.value))} step={step} type="range" value={value}/></label>;
}
