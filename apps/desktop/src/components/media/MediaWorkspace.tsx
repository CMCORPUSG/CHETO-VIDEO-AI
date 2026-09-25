import { BookmarkPlus, Camera, CheckCircle2, ChevronLeft, ChevronRight, Cpu, Download, FileVideo, Film, Gauge, LoaderCircle, PanelLeftClose, PanelRightClose, Redo2, Scissors, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { formatFileSize } from "../../lib/format";
import type { ProjectBundle } from "../../project/contracts";
import type { LogLevel } from "../../types/diagnostics";
import { preferredPlaybackKind, type PlaybackPreference, type PlaybackSource, type ProxyStatus } from "../../playback/models";
import { cancelProxy, createProxy, getProxyStatus, onProxyDiagnostic, onProxyProgress, playbackErrorMessage, resolvePlaybackSource } from "../../playback/service";
import type { CameraPreview } from "../../smart-camera/models";
import { editedDurationUs, previewRange, removedDurationUs, selectionRange, type DraftTracks, type PreviewRange } from "../../editor/edl";
import { clampPanelWidth, resolveAspectRatio, type AspectMode } from "../../editor/layout";
import { saveProjectEdl } from "../../project/service";
import type { EdlManifest } from "../../project/contracts";
import { Button } from "../Button";
import { Card } from "../Card";
import { SmartCutWorkspace } from "./SmartCutWorkspace";
import { SmartCameraWorkspace } from "./SmartCameraWorkspace";
import { EditorTimeline, type TimelineSelection } from "./EditorTimeline";
import { TimelineInspector } from "./TimelineInspector";
import { ExportModal } from "./ExportModal";
import { VideoPlayer } from "./VideoPlayer";

interface MediaWorkspaceProps {
  bundle: ProjectBundle;
  onLog: (message: string, level?: LogLevel) => void;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
}

const initialStatus: ProxyStatus = { message: null, metadata: null, processedUs: null, progress: null, state: "not_created" };
function storedWidth(key: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function MediaWorkspace({ bundle, onLog, onNotify }: MediaWorkspaceProps) {
  const projectId = bundle.project.projectId;
  const [status, setStatus] = useState<ProxyStatus>(initialStatus);
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestedSeekUs, setRequestedSeekUs] = useState<number | null>(null);
  const [cameraPreview, setCameraPreview] = useState<CameraPreview | null>(null);
  const [edl, setEdl] = useState<EdlManifest>(bundle.edl);
  const [activeTool, setActiveTool] = useState<"project"|"cut"|"camera">("project");
  const [previewMode, setPreviewMode] = useState<"original"|"result">("result");
  const [viewerScale, setViewerScale] = useState(() => storedWidth("cheto.editor.viewerScale", 92));
  const [aspectMode, setAspectMode] = useState<AspectMode>("original");
  const [customAspectWidth, setCustomAspectWidth] = useState(16);
  const [customAspectHeight, setCustomAspectHeight] = useState(9);
  const playheadUs = useRef(0);
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
  const [undoStack, setUndoStack] = useState<EdlManifest[]>([]);
  const [redoStack, setRedoStack] = useState<EdlManifest[]>([]);
  const progressBucket = useRef(-1);
  const [toolsWidth, setToolsWidth] = useState(() => storedWidth("cheto.editor.toolsWidth", 112));
  const [inspectorWidth, setInspectorWidth] = useState(() => storedWidth("cheto.editor.inspectorWidth", 320));
  const [timelineHeight, setTimelineHeight] = useState(() => storedWidth("cheto.editor.timelineHeight", 236));
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const resizeRef = useRef<{ side: "left" | "right" | "vertical"; startX: number; startY: number; startWidth: number } | null>(null);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (!resize) return;
      const available = Math.max(640, window.innerWidth);
      if (resize.side === "vertical") {
        setTimelineHeight(clampPanelWidth(resize.startWidth + resize.startY - event.clientY, 150, Math.max(220, window.innerHeight - 360)));
      } else if (resize.side === "left") {
        setToolsWidth(clampPanelWidth(resize.startWidth + event.clientX - resize.startX, 64, 260));
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

  useEffect(() => { window.localStorage.setItem("cheto.editor.toolsWidth", String(Math.round(toolsWidth))); }, [toolsWidth]);
  useEffect(() => { window.localStorage.setItem("cheto.editor.inspectorWidth", String(Math.round(inspectorWidth))); }, [inspectorWidth]);
  useEffect(() => { window.localStorage.setItem("cheto.editor.timelineHeight", String(Math.round(timelineHeight))); }, [timelineHeight]);
  useEffect(() => { window.localStorage.setItem("cheto.editor.viewerScale", String(Math.round(viewerScale))); }, [viewerScale]);
  useEffect(() => { window.localStorage.setItem(markerStorageKey, JSON.stringify(markers)); }, [markerStorageKey, markers]);

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
      setSource(resolved);
      setError(null);
    } catch (reason) {
      const message = playbackErrorMessage(reason);
      setError(message);
      onLog("PLAYBACK_ERROR", "error");
    }
  }, [onLog, projectId]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void)[] = [];
    void Promise.all([
      onProxyProgress((progress) => {
        if (progress.projectId !== projectId) return;
        setStatus((current) => ({ ...current, state: progress.status, progress: progress.progress, processedUs: progress.processedUs }));
        const bucket = Math.floor(progress.progress / 25);
        if (bucket > progressBucket.current && progress.status === "generating") {
          progressBucket.current = bucket;
          onLog("PROXY_PROGRESS");
        }
      }),
      onProxyDiagnostic((diagnostic) => {
        if (diagnostic.projectId === projectId) onLog(diagnostic.event, diagnostic.event.includes("FAILED") ? "error" : diagnostic.event.includes("FALLBACK") || diagnostic.event.includes("STALE") ? "warning" : "info");
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
      if (!disposed) setError(playbackErrorMessage(reason));
    });
    return () => { disposed = true; cleanup.forEach((unlisten) => unlisten()); };
  }, [onLog, projectId, resolveSource]);

  const startProxy = async () => {
    setError(null);
    setStatus((current) => ({ ...current, state: "preparing", progress: 0 }));
    progressBucket.current = -1;
    try {
      const next = await createProxy(projectId);
      setStatus(next);
      if (next.state === "available") {
        await resolveSource("proxy", next);
        onNotify("Proxy de trabajo disponible");
      }
    } catch (reason) {
      const message = playbackErrorMessage(reason);
      setStatus((current) => ({ ...current, message, state: "error" }));
      setError(message);
      onNotify(message, "error");
    }
  };

  const stopProxy = async () => {
    try { setStatus(await cancelProxy(projectId)); onNotify("Cancelación solicitada", "info"); }
    catch (reason) { onNotify(playbackErrorMessage(reason), "error"); }
  };

  const durationUs = bundle.source.durationUs ?? 0;
  const recommend = durationUs >= 30 * 60 * 1_000_000 || bundle.source.fileSizeBytes >= 1_000_000_000;
  const isGenerating = status.state === "preparing" || status.state === "generating";
  const proxyAvailable = status.state === "available";
  const proxy = status.metadata?.proxy;
  const removedUs=removedDurationUs(edl.tracks.cuts,durationUs);
  const resultUs=editedDurationUs(durationUs,edl.tracks.cuts);
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
  const handlePlaybackError=useCallback((message:string)=>{setError(message);onLog("PLAYBACK_ERROR","error");},[onLog]);
  const sourceAspect = (bundle.source.video.displayWidth ?? bundle.source.video.width ?? 16) / Math.max(1, bundle.source.video.displayHeight ?? bundle.source.video.height ?? 9);
  const aspectRatio = resolveAspectRatio(aspectMode, sourceAspect, customAspectWidth, customAspectHeight);
  const persistEdl = useCallback(async (next: EdlManifest) => {
    const stamped = { ...next, updatedAt: new Date().toISOString() };
    setEdl(stamped);
    try { setEdl(await saveProjectEdl(stamped)); }
    catch (reason) { const message=reason instanceof Error?reason.message:String(reason);onNotify(`No se pudo guardar el EDL: ${message}`,"error"); }
  },[onNotify]);
  const commitEdl = useCallback((next: EdlManifest) => { setUndoStack(stack=>[...stack.slice(-49),edl]);setRedoStack([]);void persistEdl(next); },[edl,persistEdl]);
  const undo = useCallback(()=>{const previous=undoStack.at(-1);if(!previous)return;setUndoStack(stack=>stack.slice(0,-1));setRedoStack(stack=>[...stack,edl]);void persistEdl(previous);},[edl,persistEdl,undoStack]);
  const redo = useCallback(()=>{const next=redoStack.at(-1);if(!next)return;setRedoStack(stack=>stack.slice(0,-1));setUndoStack(stack=>[...stack,edl]);void persistEdl(next);},[edl,persistEdl,redoStack]);
  const changeCut=useCallback((item:EdlManifest["tracks"]["cuts"][number])=>commitEdl({...edl,tracks:{...edl.tracks,cuts:edl.tracks.cuts.map(value=>value.id===item.id?item:value)}}),[commitEdl,edl]);
  const changeCamera=useCallback((item:EdlManifest["tracks"]["camera"][number])=>commitEdl({...edl,tracks:{...edl.tracks,camera:edl.tracks.camera.map(value=>value.id===item.id?item:value)}}),[commitEdl,edl]);
  const replaceCamera=useCallback((item:EdlManifest["tracks"]["camera"][number],conflictId:string)=>commitEdl({...edl,tracks:{...edl.tracks,camera:edl.tracks.camera.filter(value=>value.id!==conflictId).map(value=>value.id===item.id?item:value)}}),[commitEdl,edl]);
  const deleteSelected=useCallback(()=>{if(!timelineSelection)return;commitEdl({...edl,tracks:{...edl.tracks,[timelineSelection.track]:edl.tracks[timelineSelection.track].filter(item=>item.id!==timelineSelection.id)}});setTimelineSelection(null);},[commitEdl,edl,timelineSelection]);
  useEffect(()=>{const handler=(event:KeyboardEvent)=>{if(isTypingTarget(event.target))return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="z"){event.preventDefault();if(event.shiftKey)redo();else undo();}else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="y"){event.preventDefault();redo();}else if(event.key==="Delete"&&timelineSelection){event.preventDefault();deleteSelected();}};window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler);},[deleteSelected,redo,timelineSelection,undo]);
  const selectedCut=timelineSelection?.track==="cuts"?edl.tracks.cuts.find(item=>item.id===timelineSelection.id)??null:null;
  const selectedCamera=timelineSelection?.track==="camera"?edl.tracks.camera.find(item=>item.id===timelineSelection.id)??null:null;

  const proxyPanel=<Card className="p-5">
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
      </Card>;
  const toolPanel=activeTool==="project"?proxyPanel:activeTool==="cut"?<SmartCutWorkspace bundle={bundle} edl={edl} onDraftChange={(cuts)=>setDraftTracks(current=>({camera:current?.camera??[],cuts}))} onEdlChange={commitEdl} onLog={onLog} onNotify={onNotify} onSeek={setRequestedSeekUs} onSelect={(id)=>setTimelineSelection({id,track:"cuts"})}/>:<SmartCameraWorkspace bundle={bundle} edl={edl} onDraftChange={(camera)=>setDraftTracks(current=>({camera,cuts:current?.cuts??[]}))} onEdlChange={commitEdl} onLog={onLog} onNotify={onNotify} onPreview={setCameraPreview} onSeek={setRequestedSeekUs} onSelect={(id)=>setTimelineSelection({id,track:"camera"})}/>;
  const panel=<><TimelineInspector camera={edl.tracks.camera} cut={selectedCut} durationUs={durationUs} item={selectedCamera} key={timelineSelection?`${timelineSelection.track}-${timelineSelection.id}`:"none"} onApplyCamera={changeCamera} onApplyCut={changeCut} onDelete={deleteSelected} onReplaceCamera={replaceCamera}/>{toolPanel}</>;
  const tools=[{id:"project" as const,label:"Proyecto",icon:<FileVideo size={18}/>,tone:"tool-project"},{id:"cut" as const,label:"Cortes",icon:<Scissors size={18}/>,tone:"tool-cut"},{id:"camera" as const,label:"Encuadre",icon:<Camera size={18}/>,tone:"tool-camera"}];
  return <div className={`editor-shell relative grid h-[calc(100vh-9rem)] min-h-[620px] overflow-hidden border border-line bg-surface shadow-2xl ${toolsCollapsed?"tools-collapsed":""} ${inspectorCollapsed?"inspector-collapsed":""}`} style={{ "--inspector-width": `${inspectorCollapsed?0:inspectorWidth}px`, "--timeline-height": `${timelineHeight}px`, "--tools-width": `${toolsCollapsed?44:toolsWidth}px` } as CSSProperties}>
    <nav className="editor-tool-panel flex gap-1 overflow-auto border-line bg-canvas/60 p-1.5">
      <div className="flex items-center justify-between"><p className="editor-panel-heading truncate px-2 py-2 text-[9px] font-bold uppercase text-muted">Herramientas</p><button aria-label="Ocultar panel izquierdo" className="panel-collapse-button" onClick={()=>setToolsCollapsed(value=>!value)} type="button">{toolsCollapsed?<ChevronRight size={14}/>:<PanelLeftClose size={14}/>}</button></div>
      {tools.map(tool=><button className={`editor-tool-button flex min-w-0 items-center gap-2 border border-transparent px-2 py-2 text-[10px] font-semibold transition ${activeTool===tool.id?`is-active ${tool.tone}`:"text-muted hover:bg-card hover:text-ink"}`} key={tool.id} onClick={()=>setActiveTool(tool.id)} title={tool.label} type="button">{tool.icon}<span className="truncate">{tool.label}</span></button>)}
    </nav>
    <button aria-label="Redimensionar panel de herramientas" className="editor-tools-resizer" onDoubleClick={() => setToolsWidth(112)} onPointerDown={beginToolsResize} title="Arrastra para cambiar el ancho. Doble clic para restablecer." type="button" />
    <section className="editor-viewer min-h-0 overflow-auto bg-black/40 p-2">
      <div className="editor-viewer-toolbar mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center border border-line bg-canvas p-0.5"><button className={`px-2.5 py-1 text-[9px] font-bold ${previewMode==="original"?"bg-primary text-white":"text-muted"}`} onClick={()=>setPreviewMode("original")}>ORIGINAL</button><button className={`px-2.5 py-1 text-[9px] font-bold ${previewMode==="result"?"bg-primary text-white":"text-muted"}`} onClick={()=>setPreviewMode("result")}>RESULTADO</button></div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
          <label className="flex items-center gap-1 text-[9px] font-semibold text-muted"><span>Formato</span><select aria-label="Relación de aspecto" className="border border-line bg-canvas px-2 py-1 text-ink" onChange={(event)=>setAspectMode(event.target.value as AspectMode)} value={aspectMode}><option value="original">Original</option><option value="16:9">16:9</option><option value="4:3">4:3</option><option value="1:1">1:1</option><option value="9:16">9:16</option><option value="21:9">21:9</option><option value="custom">Personalizado</option></select></label>
          {aspectMode==="custom"?<div className="flex items-center gap-1"><input aria-label="Ancho personalizado" className="w-11 border border-line bg-canvas px-1 py-1 text-center text-ink" min="1" onChange={(event)=>setCustomAspectWidth(Number(event.target.value)||1)} type="number" value={customAspectWidth}/><span className="text-muted">:</span><input aria-label="Alto personalizado" className="w-11 border border-line bg-canvas px-1 py-1 text-center text-ink" min="1" onChange={(event)=>setCustomAspectHeight(Number(event.target.value)||1)} type="number" value={customAspectHeight}/></div>:null}
          <div className="viewer-scale-control flex items-center gap-1.5" title="Tamaño del visor"><ZoomOut size={12}/><input aria-label="Tamaño del visor" max="100" min="65" onChange={(event)=>setViewerScale(Number(event.target.value))} step="5" type="range" value={viewerScale}/><span className="w-8 text-right font-mono text-[8px] text-muted">{Math.round(viewerScale)}%</span><ZoomIn size={12}/></div><Button icon={<Download size={13}/>} onClick={()=>setExportOpen(true)}>Exportar</Button>
        </div>
      </div>
      <div className="mx-auto w-full transition-[max-width] duration-150" style={{ maxWidth: `${viewerScale}%` }}>{source?<VideoPlayer aspectRatio={aspectRatio} cameraPreview={cameraPreview} draftRange={draftRange} draftTracks={draftTracks} durationUs={source.durationUs} edl={edl} key={source.path} kind={source.kind} markers={markers} mode={previewMode} onError={handlePlaybackError} onTimeChange={updatePlayhead} path={source.path} seekToUs={requestedSeekUs}/>:<div className="grid aspect-video place-items-center bg-black"><LoaderCircle className="animate-spin text-cyan"/></div>}</div>
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
    <aside className="editor-inspector-panel min-h-0 overflow-auto border-l border-line bg-canvas/30 p-2"><button aria-label="Ocultar panel derecho" className="panel-collapse-button mb-1" onClick={()=>setInspectorCollapsed(true)} type="button"><PanelRightClose size={14}/></button>{panel}</aside>
    {inspectorCollapsed?<button aria-label="Mostrar panel derecho" className="editor-inspector-open" onClick={()=>setInspectorCollapsed(false)} type="button"><ChevronLeft size={14}/></button>:null}
    <button aria-label="Redimensionar player y timeline" className="editor-horizontal-resizer" onDoubleClick={()=>setTimelineHeight(236)} onPointerDown={beginVerticalResize} title="Arrastra para dar más espacio al player o a la timeline" type="button"/>
    <section className="editor-timeline-panel overflow-hidden border-t border-line bg-canvas/65">
      <div className="editor-timeline-toolbar flex min-w-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        <div className="timeline-mode"><span>Edición</span><strong>{previewMode==="result"?"Resultado":"Original"}</strong></div><button aria-label="Deshacer" disabled={!undoStack.length} onClick={undo} title="Deshacer (Ctrl+Z)" type="button"><Undo2 size={13}/></button><button aria-label="Rehacer" disabled={!redoStack.length} onClick={redo} title="Rehacer (Ctrl+Y)" type="button"><Redo2 size={13}/></button><button aria-label="Eliminar seleccionado" className="timeline-action-delete" disabled={!timelineSelection} onClick={deleteSelected} title="Eliminar seleccionado" type="button"><Trash2 size={13}/></button><button aria-label="Agregar o quitar marcador" className="timeline-action-marker" onClick={toggleMarker} title="Agregar/quitar marcador en el cabezal" type="button"><BookmarkPlus size={13}/></button>
        <Metric label="Cortes" value={String(edl.tracks.cuts.length)}/><Metric label="Eliminado" value={formatShort(removedUs)}/><Metric label="Encuadres" value={String(edl.tracks.camera.length)}/><Metric label="Final" value={formatShort(resultUs)}/>
        <div className="timeline-selection-controls ml-auto flex min-w-0 flex-wrap justify-end gap-1"><Button className="editor-mark-in-button" onClick={()=>setSelectionInUs(playheadUs.current)} variant="secondary">Entrada {selectionInUs===null?"—":formatShort(selectionInUs)}</Button><Button className="editor-mark-out-button" onClick={()=>setSelectionOutUs(playheadUs.current)} variant="secondary">Salida {selectionOutUs===null?"—":formatShort(selectionOutUs)}</Button><Button className="editor-preview-button" onClick={()=>runPreview(10)}>Probar 10 s</Button><Button className="editor-preview-alt-button" onClick={()=>runPreview(30)} variant="secondary">Probar 30 s</Button><Button disabled={!selectionRange(selectionInUs,selectionOutUs,durationUs)} onClick={runSelection} variant="secondary">Probar selección</Button>{draftRange?<Button className="editor-close-preview-button" onClick={()=>setDraftRange(null)} variant="ghost">Cerrar prueba</Button>:null}</div>
      </div>
      <EditorTimeline camera={edl.tracks.camera} cuts={edl.tracks.cuts} draftCamera={draftTracks?.camera} draftCuts={draftTracks?.cuts} durationUs={durationUs} onChangeCamera={changeCamera} onChangeCut={changeCut} onSeek={(timeUs)=>{setRequestedSeekUs(timeUs);setVisiblePlayheadUs(timeUs);}} onSelect={setTimelineSelection} markers={markers} playheadUs={visiblePlayheadUs} selected={timelineSelection} sourceName={bundle.source.fileName}/>
    </section>
    <ExportModal aspectRatio={aspectRatio} bundle={bundle} edl={edl} onClose={()=>setExportOpen(false)} open={exportOpen}/>
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



