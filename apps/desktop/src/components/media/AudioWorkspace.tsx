import {
  Gauge,
  Headphones,
  MinusCircle,
  PlusCircle,
  SlidersHorizontal,
  Trash2,
  Volume2,
  VolumeX,
  Waves,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listen as listenEvent } from "@tauri-apps/api/event";
import type { AssetDecision, AudioDecision } from "../../project/contracts";
import {
  analyzeAudioEvents, applyAudioEventActions, audioEventPreviewRange, audioIntelligenceEnabled,
  canAnalyzeAudio, cancelAudioEvents, type AudioAnalysis, type AudioAnalysisProgress,
  type AudioEvent, type EventAction,
} from "../../editor/audio-intelligence";
import { formatTimecode } from "../../editor/timecode";
import { canPreviewAudio, previewAudioRange, renderAudioPreview } from "../../editor/audio-preview";
import { audioLevels } from "../../editor/audio-levels";
import { formatCommandError } from "../../playback/service";
import { canLoadTimelineVisuals, timelineWaveform, type WaveformView } from "../../editor/visuals";
import { Button } from "../Button";
import { Card } from "../Card";

interface AudioWorkspaceProps {
  analysis: AudioAnalysis | null;
  analysisBusy: boolean;
  setAnalysisBusy: (busy: boolean) => void;
  analysisProgress: AudioAnalysisProgress | null;
  setAnalysisProgress: (progress: AudioAnalysisProgress | null) => void;
  analysisError: string | null;
  setAnalysisError: (error: string | null) => void;
  onAnalysisChange: (analysis: AudioAnalysis) => void;
  selectedEventId: string | null;
  onEventFocus: (event: AudioEvent) => void;
  onLog: (message: string, level?: "info" | "warning" | "error") => void;
  projectId: string;
  playheadUs: number;
  onPreviewStart: () => void;
  audio: AudioDecision[];
  assets: AssetDecision[];
  durationUs: number;
  hasAudio: boolean;
  muted: boolean;
  onAudioChange: (items: AudioDecision[]) => void;
  onMutedChange: (value: boolean) => void;
  onRateChange: (value: number) => void;
  onVolumeChange: (value: number) => void;
  rate: number;
  sourceAudioStreams: number;
  selectionInUs: number | null;
  selectionOutUs: number | null;
  volume: number;
}

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `audio-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function orderedRange(a: number | null, b: number | null, durationUs: number) {
  if (a === null || b === null || a === b) return null;
  return { startUs: Math.max(0, Math.min(a, b)), endUs: Math.min(durationUs, Math.max(a, b)) };
}

function globalOperation(audio: AudioDecision[], operation: string) {
  return audio.find((item) => item.operation === operation && item.startUs === 0);
}

export function AudioWorkspace({
  analysis,
  analysisBusy,
  setAnalysisBusy,
  analysisProgress,
  setAnalysisProgress,
  analysisError,
  setAnalysisError,
  onAnalysisChange,
  selectedEventId,
  onEventFocus,
  onLog,
  projectId,
  playheadUs,
  onPreviewStart,
  audio,
  assets,
  durationUs,
  hasAudio,
  muted,
  onAudioChange,
  onMutedChange,
  onRateChange,
  onVolumeChange,
  rate,
  sourceAudioStreams,
  selectionInUs,
  selectionOutUs,
  volume,
}: AudioWorkspaceProps) {
  const range = orderedRange(selectionInUs, selectionOutUs, durationUs);
  const voice = globalOperation(audio, "voice_focus");
  const normalize = globalOperation(audio, "normalize");
  const masterGain = globalOperation(audio, "master_gain");
  const fadeIn = globalOperation(audio, "fade_in");
  const fadeOut = globalOperation(audio, "fade_out");
  const sourceStream = globalOperation(audio, "source_stream");
  const sourceStreamIndex = Math.max(
    0,
    Math.min(
      Math.max(0, sourceAudioStreams - 1),
      numberParameter(sourceStream ?? { id: "", startUs: 0, endUs: durationUs, operation: "source_stream", parameters: {} }, "index"),
    ),
  );
  const masterGainDb = Number(masterGain?.parameters.gainDb ?? 0);
  const fadeInSeconds = Number(fadeIn?.parameters.durationUs ?? 0) / 1_000_000;
  const fadeOutSeconds = Number(fadeOut?.parameters.durationUs ?? 0) / 1_000_000;
  const [gainOverride, setGainDraft] = useState<number | null>(null);
  const [fadeInOverride, setFadeInDraft] = useState<number | null>(null);
  const [fadeOutOverride, setFadeOutDraft] = useState<number | null>(null);
  const [voiceOverride, setVoiceDraft] = useState<number | null>(null);
  const gainDraft = gainOverride ?? masterGainDb;
  const fadeInDraft = fadeInOverride ?? fadeInSeconds;
  const fadeOutDraft = fadeOutOverride ?? fadeOutSeconds;
  const voiceDraft = voiceOverride ?? Number(voice?.parameters.amount ?? 0.5);
  const [rangeGainDb, setRangeGainDb] = useState(-12);
  const [rangeNoiseAmount, setRangeNoiseAmount] = useState(0.45);
  const [notchHz, setNotchHz] = useState(4000);
  const [eventFilter, setEventFilter] = useState<"all" | "voice">("all");
  const [eventSort, setEventSort] = useState<"priority" | "time">("priority");
  const [checkedEvents, setCheckedEvents] = useState<string[]>([]);
  const [eventActions, setEventActions] = useState<Record<string, EventAction>>({});
  const [batchAction, setBatchAction] = useState<EventAction>("clean");
  const [intelligenceEnabled] = useState(audioIntelligenceEnabled);
  const previewRef = useRef<HTMLAudioElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"original" | "processed" | null>(null);
  const [previewBusyState, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRequest = useRef(0);
  const pendingPosition = useRef(0);
  const previewWindow = useRef<{ startUs: number; endUs: number; playheadUs: number } | null>(null);
  const pendingAudio = useRef<AudioDecision[] | null>(null);
  const previewAudio = useRef<AudioDecision[] | null>(null);
  const previewBusy = previewBusyState && pendingAudio.current === audio;
  const activePreviewMode = previewAudio.current === audio ? previewMode : null;

  useEffect(() => {
    previewRequest.current += 1;
    previewRef.current?.pause();
  }, [audio, assets, projectId]);

  useEffect(() => () => { previewRequest.current += 1; previewRef.current?.pause(); }, []);

  useEffect(() => {
    if (!canAnalyzeAudio()) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;
    void listenEvent<AudioAnalysisProgress>("audio-ai-progress", event => {
      if (mounted && event.payload.projectId === projectId) setAnalysisProgress(event.payload);
    }).then(stop => { if (mounted) unlisten = stop; else stop(); });
    return () => { mounted = false; unlisten?.(); };
  }, [projectId, setAnalysisProgress]);

  const runAnalysis = async () => {
    if (analysisBusy || !intelligenceEnabled) return;
    setAnalysisBusy(true);
    setAnalysisError(null);
    setAnalysisProgress({ projectId, analyzedUs: 0, durationUs });
    onLog("AUDIO_AI_ANALYSIS_STARTED");
    try {
      const result = await analyzeAudioEvents(projectId);
      onAnalysisChange(result);
      setCheckedEvents([]);
      onLog("AUDIO_AI_ANALYSIS_COMPLETED");
    } catch (error) {
      const message = formatCommandError(error);
      if (/cancelado/i.test(message)) onLog("AUDIO_AI_ANALYSIS_CANCELLED");
      else { setAnalysisError(message); onLog("AUDIO_AI_ANALYSIS_FAILED", "error"); }
    } finally {
      setAnalysisBusy(false);
      setAnalysisProgress(null);
    }
  };

  const visibleEvents = (analysis?.events ?? []).filter(event => eventFilter === "all" || event.eventType === eventFilter)
    .sort((a, b) => eventSort === "time" ? a.startUs - b.startUs
      : b.confidence * Math.min(b.endUs - b.startUs, 10_000_000) - a.confidence * Math.min(a.endUs - a.startUs, 10_000_000));

  const applyEvents = (events: AudioEvent[], action: EventAction) => {
    if (!events.length) return;
    onAudioChange(applyAudioEventActions(audio, events, Object.fromEntries(events.map(event => [event.id, action]))));
    // Persistence logs the applied decision with the canonical project and EDL revision.
    setCheckedEvents([]);
  };

  const listen = async (processed: boolean, event?: AudioEvent) => {
    if (!hasAudio || !canPreviewAudio()) return;
    const active = previewWindow.current;
    const { startUs, endUs } = event ? audioEventPreviewRange(event, durationUs) : active && active.playheadUs === playheadUs && activePreviewMode !== null
      ? active
      : previewAudioRange(durationUs, playheadUs, selectionInUs, selectionOutUs);
    if (endUs <= startUs) return;
    const request = ++previewRequest.current;
    pendingPosition.current = active && active.startUs === startUs && active.endUs === endUs
      ? previewRef.current?.currentTime ?? 0 : 0;
    previewRef.current?.pause();
    previewWindow.current = { startUs, endUs, playheadUs };
    pendingAudio.current = audio;
    onPreviewStart();
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const url = await renderAudioPreview(projectId, startUs, endUs, processed, audio, assets);
      if (request !== previewRequest.current) return;
      previewRef.current?.pause();
      previewAudio.current = audio;
      setPreviewUrl(url);
      setPreviewMode(processed ? "processed" : "original");
    } catch (error) {
      if (request === previewRequest.current) setPreviewError(formatCommandError(error));
    } finally {
      if (request === previewRequest.current) setPreviewBusy(false);
    }
  };

  const toggleGlobal = (operation: string, parameters: Record<string, unknown> = {}) => {
    const exists = globalOperation(audio, operation);
    onAudioChange(
      exists
        ? audio.filter((item) => item.id !== exists.id)
        : [...audio, { id: id(), startUs: 0, endUs: durationUs, operation, parameters }],
    );
  };

  const setMasterGain = (gainDb: number) => {
    gainDb = Math.max(-60, Math.min(12, Number.isFinite(gainDb) ? gainDb : 0));
    setGainDraft(null);
    if (Math.abs(gainDb - masterGainDb) < 0.05) return;
    const without = audio.filter((item) => item.operation !== "master_gain");
    if (Math.abs(gainDb) < 0.05) {
      onAudioChange(without);
      return;
    }
    onAudioChange([...without, { id: masterGain?.id ?? id(), startUs: 0, endUs: durationUs, operation: "master_gain", parameters: { gainDb } }]);
  };

  const setFade = (operation: "fade_in" | "fade_out", seconds: number) => {
    const duration = Math.round(Math.max(0, Math.min(30, durationUs / 1_000_000, Number.isFinite(seconds) ? seconds : 0)) * 1_000_000);
    if (operation === "fade_in") setFadeInDraft(null);
    else setFadeOutDraft(null);
    const existing = globalOperation(audio, operation);
    if (duration === Number(existing?.parameters.durationUs ?? 0)) return;
    const without = audio.filter((item) => item.operation !== operation);
    onAudioChange(duration === 0 ? without : [...without, {
      id: existing?.id ?? id(), startUs: 0, endUs: durationUs, operation, parameters: { durationUs: duration },
    }]);
  };

  const updateGlobalParameter = (operation: string, key: string, value: number) => {
    if (operation === "voice_focus") setVoiceDraft(null);
    if (Number(globalOperation(audio, operation)?.parameters[key] ?? NaN) === value) return;
    onAudioChange(audio.map((item) => item.operation === operation && item.startUs === 0
      ? { ...item, parameters: { ...item.parameters, [key]: value } }
      : item));
  };

  const addRange = (operation: string, parameters: Record<string, unknown>) => {
    if (!range) return;
    onAudioChange([...audio, { id: id(), ...range, operation, parameters }]);
  };

  const remove = (decisionId: string) => onAudioChange(audio.filter((item) => item.id !== decisionId));

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-2 text-ink">
          <Headphones size={15} className="text-cyan" />
          <h3 className="text-[12px] font-semibold">Audio</h3>
        </div>
        <p className="mt-1 text-[8px] leading-4 text-muted/50">
          Procesamiento local y no destructivo. Las decisiones se guardan en el EDL y se aplican al exportar.
        </p>
      </div>

      <Card className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div><p className="text-[10px] font-semibold text-ink">Inteligencia de audio local</p><p className="mt-1 text-[8px] leading-4 text-muted/60">Detecta voz probable para revisión. No identifica personas, TV, perros ni impactos; no elimina audio automáticamente.</p></div>
          <span className="rounded bg-cyan/10 px-1.5 py-1 text-[8px] text-cyan">VAD</span>
        </div>
        {!intelligenceEnabled ? <p className="mt-2 text-[8px] text-muted">Desactivado en Configuración.</p> : <>
          <div className="mt-3 flex gap-2"><Button disabled={!hasAudio || !canAnalyzeAudio() || analysisBusy} onClick={() => void runAnalysis()}>{analysis?.cacheHit ? "Revisar análisis" : "Analizar audio"}</Button>{analysisBusy ? <Button onClick={() => void cancelAudioEvents(projectId)} variant="secondary">Cancelar</Button> : null}</div>
          {analysisBusy && analysisProgress ? <div className="mt-2 text-[8px] text-muted"><p>Analizando audio… {Math.min(100, Math.round(100 * analysisProgress.analyzedUs / Math.max(1, analysisProgress.durationUs)))}% · {formatTimecode(analysisProgress.analyzedUs)} / {formatTimecode(analysisProgress.durationUs)}</p><progress className="mt-1 w-full accent-cyan" max={analysisProgress.durationUs} value={analysisProgress.analyzedUs}/></div> : null}
          {analysisError ? <p className="mt-2 text-[8px] text-danger">{analysisError}</p> : null}
          {analysis ? <>
            <p className="mt-3 text-[9px] text-ink">{analysis.events.length} tramos de voz probable para revisar</p>
            <p className="mt-1 text-[8px] text-muted">Análisis {analysis.cacheHit ? "desde caché" : `en ${(analysis.analysisElapsedMs / 1000).toFixed(1)} s · ${analysis.realtimeFactor.toFixed(1)}× tiempo real`}. El indicador de actividad es la proporción de frames marcados por VAD; no es una probabilidad calibrada.</p>
            <div className="mt-3 flex gap-2"><select aria-label="Filtrar eventos" className="cheto-input min-w-0 flex-1" onChange={event => setEventFilter(event.target.value as "all" | "voice")} value={eventFilter}><option value="all">Todos</option><option value="voice">Voces</option></select><select aria-label="Ordenar eventos" className="cheto-input min-w-0 flex-1" onChange={event => setEventSort(event.target.value as "priority" | "time")} value={eventSort}><option value="priority">Prioridad</option><option value="time">Tiempo</option></select></div>
            {visibleEvents.length ? <div className="mt-3 space-y-2">
              <label className="flex items-center gap-2 text-[8px] text-muted"><input checked={visibleEvents.every(event => checkedEvents.includes(event.id))} onChange={event => setCheckedEvents(event.currentTarget.checked ? visibleEvents.map(item => item.id) : [])} type="checkbox"/>Seleccionar todo visible</label>
              <div className="flex gap-2"><select aria-label="Acción para seleccionados" className="cheto-input min-w-0 flex-1" onChange={event => setBatchAction(event.target.value as EventAction)} value={batchAction}><option value="keep">Conservar · sin procesamiento</option><option value="clean">Limpiar ruido</option><option value="attenuate6">Atenuar −6 dB</option><option value="attenuate12">Atenuar −12 dB</option><option value="attenuate18">Atenuar −18 dB</option><option value="mute">Silenciar</option></select><Button disabled={!checkedEvents.length} onClick={() => applyEvents(visibleEvents.filter(event => checkedEvents.includes(event.id)), batchAction)} variant="secondary">Aplicar seleccionados</Button></div>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">{visibleEvents.map(event => <div className={`rounded-md border p-2 ${selectedEventId === event.id ? "border-cyan/45 bg-cyan/5" : "border-line bg-white/[0.02]"}`} key={event.id}>
                <div className="flex items-center gap-2"><input aria-label={`Seleccionar evento ${formatTimecode(event.startUs)}`} checked={checkedEvents.includes(event.id)} onChange={change => setCheckedEvents(current => change.currentTarget.checked ? [...current, event.id] : current.filter(id => id !== event.id))} type="checkbox"/><strong className="text-[9px] text-ink">VOZ PROBABLE</strong><span className="ml-auto text-[8px] text-muted">Actividad {Math.round(event.confidence * 100)}%</span></div>
                <p className="mt-1 font-mono text-[8px] text-muted">{formatTimecode(event.startUs)} → {formatTimecode(event.endUs)}</p>
                <div className="mt-2 flex flex-wrap gap-1"><Button onClick={() => onEventFocus(event)} variant="secondary">Ir</Button><Button disabled={previewBusy} onClick={() => void listen(false, event)} variant="secondary">▶ Original</Button><Button disabled={previewBusy} onClick={() => void listen(true, event)} variant="secondary">▶ Procesado</Button></div>
                <div className="mt-2 flex gap-1"><select aria-label={`Acción del evento ${formatTimecode(event.startUs)}`} className="cheto-input min-w-0 flex-1" onChange={change => setEventActions(current => ({ ...current, [event.id]: change.target.value as EventAction }))} value={eventActions[event.id] ?? "keep"}><option value="keep">Conservar · sin procesamiento</option><option value="clean">Limpiar ruido</option><option value="attenuate6">Atenuar −6 dB</option><option value="attenuate12">Atenuar −12 dB</option><option value="attenuate18">Atenuar −18 dB</option><option value="mute">Silenciar</option></select><Button onClick={() => applyEvents([event], eventActions[event.id] ?? "keep")} variant="secondary">Aplicar</Button></div>
              </div>)}</div>
            </div> : null}
          </> : null}
        </>}
      </Card>

      <Card className="p-3">
        <p className="text-[10px] font-semibold text-ink">Escuchar comparación</p>
        <p className="mt-1 text-[8px] leading-4 text-muted/60">Escucha la misma ventana en ambas versiones. Procesado aplica los ajustes actuales antes de exportar.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button disabled={!hasAudio || !canPreviewAudio()} onClick={() => void listen(false)} variant={activePreviewMode === "original" ? "primary" : "secondary"}>Original</Button>
          <Button disabled={!hasAudio || !canPreviewAudio()} onClick={() => void listen(true)} variant={activePreviewMode === "processed" ? "primary" : "secondary"}>Procesado</Button>
        </div>
        {previewBusy ? <p className="mt-2 text-[8px] text-muted">Preparando escucha…</p> : null}
        {previewError ? <p className="mt-2 text-[8px] text-danger">{previewError}</p> : null}
        {previewUrl && activePreviewMode ? <audio aria-label={`Escucha ${activePreviewMode === "processed" ? "procesada" : "original"}`} className="mt-3 w-full" controls onLoadedMetadata={(event) => { const element = event.currentTarget; element.currentTime = Math.min(pendingPosition.current, Math.max(0, element.duration - 0.1)); void element.play().catch((error) => setPreviewError(formatCommandError(error))); }} preload="auto" ref={previewRef} src={previewUrl} /> : null}
      </Card>

      <Card className="p-3">
        <p className="mb-3 text-[10px] font-semibold text-ink">Básico</p>
        <Control label="Volumen" value={`${gainDraft >= 0 ? "+" : ""}${gainDraft.toFixed(1)} dB`}>
          <div className="flex items-center gap-2"><input aria-label="Volumen en dB" className="min-w-0 flex-1 accent-cyan" disabled={!hasAudio} max="12" min="-60" onBlur={() => setMasterGain(gainDraft)} onChange={(event) => setGainDraft(Number(event.currentTarget.value))} onKeyUp={() => setMasterGain(gainDraft)} onPointerUp={() => setMasterGain(gainDraft)} step="0.5" type="range" value={gainDraft}/><input aria-label="Escribir volumen en dB" className="w-14 border border-line bg-canvas px-1 py-1 text-right font-mono text-[9px] text-ink" disabled={!hasAudio} max="12" min="-60" onBlur={() => setMasterGain(gainDraft)} onChange={(event) => setGainDraft(Number(event.currentTarget.value))} step="0.5" type="number" value={gainDraft}/><button className="text-[8px] text-cyan" disabled={!hasAudio} onClick={() => { setGainDraft(0); setMasterGain(0); }} type="button">0 dB</button></div>
        </Control>
        <Control label="Fade in" value={`${fadeInDraft.toFixed(1)} s`}>
          <div className="flex items-center gap-2"><input aria-label="Fade in" className="min-w-0 flex-1 accent-cyan" disabled={!hasAudio} max="30" min="0" onBlur={() => setFade("fade_in", fadeInDraft)} onChange={(event) => setFadeInDraft(Number(event.currentTarget.value))} onKeyUp={() => setFade("fade_in", fadeInDraft)} onPointerUp={() => setFade("fade_in", fadeInDraft)} step="0.1" type="range" value={fadeInDraft}/><input aria-label="Escribir fade in en segundos" className="w-14 border border-line bg-canvas px-1 py-1 text-right font-mono text-[9px] text-ink" disabled={!hasAudio} max="30" min="0" onBlur={() => setFade("fade_in", fadeInDraft)} onChange={(event) => setFadeInDraft(Number(event.currentTarget.value))} step="0.1" type="number" value={fadeInDraft}/></div>
        </Control>
        <Control label="Fade out" value={`${fadeOutDraft.toFixed(1)} s`}>
          <div className="flex items-center gap-2"><input aria-label="Fade out" className="min-w-0 flex-1 accent-cyan" disabled={!hasAudio} max="30" min="0" onBlur={() => setFade("fade_out", fadeOutDraft)} onChange={(event) => setFadeOutDraft(Number(event.currentTarget.value))} onKeyUp={() => setFade("fade_out", fadeOutDraft)} onPointerUp={() => setFade("fade_out", fadeOutDraft)} step="0.1" type="range" value={fadeOutDraft}/><input aria-label="Escribir fade out en segundos" className="w-14 border border-line bg-canvas px-1 py-1 text-right font-mono text-[9px] text-ink" disabled={!hasAudio} max="30" min="0" onBlur={() => setFade("fade_out", fadeOutDraft)} onChange={(event) => setFadeOutDraft(Number(event.currentTarget.value))} step="0.1" type="number" value={fadeOutDraft}/></div>
        </Control>
        <AudioToggle checked={Boolean(normalize)} disabled={!hasAudio} label="Normalizar volumen" onClick={() => toggleGlobal("normalize", { targetLufs: -16 })} />
        <AudioToggle checked={Boolean(voice)} disabled={!hasAudio} label="Mejorar voz" onClick={() => toggleGlobal("voice_focus", { amount: 0.5 })} />
        {voice ? <Control label="Intensidad" value={`${Math.round(voiceDraft * 100)}%`}><input aria-label="Intensidad de mejora de voz" className="w-full accent-cyan" disabled={!hasAudio} max="1" min="0" onBlur={() => updateGlobalParameter("voice_focus", "amount", voiceDraft)} onChange={(event) => setVoiceDraft(Number(event.currentTarget.value))} onKeyUp={() => updateGlobalParameter("voice_focus", "amount", voiceDraft)} onPointerUp={() => updateGlobalParameter("voice_focus", "amount", voiceDraft)} step="0.05" type="range" value={voiceDraft} /></Control> : null}
      </Card>

      {sourceAudioStreams > 1 ? (
        <Card className="p-3">
          <div className="flex items-start gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary/[0.08] text-primary"><Headphones size={14} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-ink">Stream de audio fuente</p>
              <p className="mt-1 text-[8px] leading-4 text-muted/50">
                Este archivo contiene {sourceAudioStreams} streams de audio reales. El elegido se conservará al exportar.
              </p>
              <select
                aria-label="Stream de audio para exportar"
                className="mt-3 h-8 w-full rounded-md border border-white/[0.07] bg-[#070c13] px-2 text-[9px] text-ink"
                onChange={(event) => {
                  const index = Number(event.currentTarget.value);
                  const without = audio.filter((item) => item.operation !== "source_stream");
                  onAudioChange([
                    ...without,
                    {
                      id: sourceStream?.id ?? id(),
                      startUs: 0,
                      endUs: durationUs,
                      operation: "source_stream",
                      parameters: { index },
                    },
                  ]);
                }}
                value={sourceStreamIndex}
              >
                {Array.from({ length: sourceAudioStreams }, (_, index) => (
                  <option key={index} value={index}>Pista {index + 1}</option>
                ))}
              </select>
            </div>
          </div>
        </Card>
      ) : null}

      <details className="rounded-md border border-line p-2"><summary className="cursor-pointer text-[9px] font-semibold text-muted">Opciones avanzadas de audio</summary><div className="mt-3 space-y-3">
      <Card className="p-3">
        <div className="mb-3 flex items-center gap-2"><SlidersHorizontal size={13} className="text-muted/55" /><p className="text-[10px] font-semibold text-ink">Selección temporal</p></div>
        <p className="mb-3 text-[8px] leading-4 text-muted/50">
          {range ? `${formatTimecode(range.startUs)} → ${formatTimecode(range.endUs)}` : "Marca Entrada y Salida en la timeline para editar solo ese tramo."}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={!range || !hasAudio} icon={<VolumeX size={12}/>} onClick={() => addRange("mute_range", {}) } variant="secondary">Silenciar tramo</Button>
          <Button disabled={!range || !hasAudio} icon={<Waves size={12}/>} onClick={() => addRange("noise_reduction_range", { amount: rangeNoiseAmount })} variant="secondary">Limpiar tramo</Button>
        </div>
        <div className="mt-3 grid gap-3">
          <Control label="Ganancia del tramo" value={(rangeGainDb > 0 ? "+" : "") + rangeGainDb.toFixed(1) + " dB"}><input aria-label="Ganancia del tramo" className="w-full accent-cyan" max="12" min="-36" onChange={(event) => setRangeGainDb(Number(event.currentTarget.value))} step="0.5" type="range" value={rangeGainDb} /></Control>
          <Button disabled={!range || !hasAudio} icon={rangeGainDb >= 0 ? <PlusCircle size={12}/> : <MinusCircle size={12}/>} onClick={() => addRange("gain_range", { gainDb: rangeGainDb })} variant="secondary">Aplicar ganancia al tramo</Button>
          <Control label="Limpieza del tramo" value={Math.round(rangeNoiseAmount * 100) + "%"}><input aria-label="Intensidad de limpieza del tramo" className="w-full accent-cyan" max="0.85" min="0.2" onChange={(event) => setRangeNoiseAmount(Number(event.currentTarget.value))} step="0.05" type="range" value={rangeNoiseAmount} /></Control>
          <Control label="Pitido tonal" value={Math.round(notchHz) + " Hz"}><input aria-label="Frecuencia del pitido tonal" className="w-full accent-cyan" max="8000" min="500" onChange={(event) => setNotchHz(Number(event.currentTarget.value))} step="100" type="range" value={notchHz} /></Control>
          <Button disabled={!range || !hasAudio} icon={<Waves size={12}/>} onClick={() => addRange("notch_range", { hz: notchHz, width: 90 })} variant="secondary">Atenuar pitido en selección</Button>
        </div>
        <p className="mt-3 text-[8px] leading-4 text-muted/45">Para TV, voces externas o sonidos aislados: marca Entrada/Salida y reduce, silencia o limpia solo ese tramo. CHETO no elimina automáticamente una voz concreta sin un modelo local de separación de hablantes.</p>
      </Card>

      <Card className="p-3">
        <div className="mb-3 flex items-center gap-2"><Gauge size={13} className="text-muted/55" /><p className="text-[10px] font-semibold text-ink">Previsualización</p></div>
        <Control label="Velocidad" value={`${rate.toFixed(2)}x`}>
          <input aria-label="Velocidad de reproducción" className="w-full accent-cyan" max="2" min="0.5" onChange={(event) => onRateChange(Number(event.currentTarget.value))} step="0.05" type="range" value={rate} />
        </Control>
        <Control label="Volumen de escucha" value={muted ? "Silenciado" : `${Math.round(volume * 100)}%`}>
          <input aria-label="Volumen de previsualización" className="w-full accent-cyan" disabled={!hasAudio} max="1" min="0" onChange={(event) => onVolumeChange(Number(event.currentTarget.value))} step="0.01" type="range" value={muted ? 0 : volume} />
        </Control>
        <button className={`mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-md px-3 text-[9px] font-semibold ring-1 transition-colors ${muted ? "bg-danger/[0.07] text-danger ring-danger/15" : "bg-white/[0.025] text-muted/70 ring-white/[0.06] hover:bg-white/[0.045] hover:text-ink"}`} disabled={!hasAudio} onClick={() => onMutedChange(!muted)} type="button">
          {muted ? <Volume2 size={13}/> : <VolumeX size={13}/>}
          {muted ? "Activar audio" : "Silenciar audio"}
        </button>
      </Card>
      </div></details>

      {audio.length ? (
        <Card className="p-3">
          <p className="mb-2 text-[10px] font-semibold text-ink">Ediciones de audio ({audio.length})</p>
          <div className="space-y-1.5">
            {audio.map((item) => (
              <div className="flex items-center gap-2 rounded-md bg-white/[0.02] px-2 py-2 ring-1 ring-white/[0.045]" key={item.id}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[8px] font-semibold text-ink/80">{operationLabel(item)}</p>
                  <p className="mt-0.5 font-mono text-[7px] text-muted/45">{formatTimecode(item.startUs)} → {formatTimecode(item.endUs)}</p>
                </div>
                <button aria-label="Eliminar edición de audio" className="grid h-7 w-7 place-items-center rounded-md text-muted/45 hover:bg-danger/[0.08] hover:text-danger" onClick={() => remove(item.id)} type="button"><Trash2 size={12}/></button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export function AudioInspector({ audio, durationUs, hasAudio, onAudioChange, projectId, selectedAudio, sourceAudioStreams, visualSourceKey }: {
  audio: AudioDecision[];
  durationUs: number;
  hasAudio: boolean;
  onAudioChange: (items: AudioDecision[]) => void;
  projectId: string;
  selectedAudio: AudioDecision | null;
  sourceAudioStreams: number;
  visualSourceKey: string;
}) {
  const sourceStream = globalOperation(audio, "source_stream");
  const streamIndex = Math.max(0, Math.min(sourceAudioStreams - 1, numberParameter(sourceStream ?? { id: "", startUs: 0, endUs: durationUs, operation: "source_stream", parameters: {} }, "index")));
  const mute = globalOperation(audio, "mute");
  const gain = numberParameter(globalOperation(audio, "master_gain") ?? { id: "", startUs: 0, endUs: durationUs, operation: "master_gain", parameters: {} }, "gainDb");
  const fadeIn = Number(globalOperation(audio, "fade_in")?.parameters.durationUs ?? 0) / 1_000_000;
  const fadeOut = Number(globalOperation(audio, "fade_out")?.parameters.durationUs ?? 0) / 1_000_000;
  const normalize = Boolean(globalOperation(audio, "normalize"));
  const improveVoice = Boolean(globalOperation(audio, "voice_focus"));
  const startUs = selectedAudio?.startUs ?? 0;
  const endUs = selectedAudio?.endUs ?? durationUs;
  const [levelsResult, setLevelsResult] = useState<{ key: string; view: WaveformView | null } | null>(null);
  const levelsKey = `${projectId}:${visualSourceKey}:${streamIndex}:${startUs}:${endUs}`;
  const loadingLevels = hasAudio && canLoadTimelineVisuals() && endUs > startUs && levelsResult?.key !== levelsKey;
  useEffect(() => {
    if (!hasAudio || !canLoadTimelineVisuals() || endUs <= startUs) return;
    let cancelled = false;
    void timelineWaveform(projectId, streamIndex, startUs, endUs, 200)
      .then((view) => { if (!cancelled) setLevelsResult({ key: levelsKey, view }); })
      .catch(() => { if (!cancelled) setLevelsResult({ key: levelsKey, view: null }); });
    return () => { cancelled = true; };
  }, [endUs, hasAudio, levelsKey, projectId, startUs, streamIndex]);
  const levelsView = levelsResult?.key === levelsKey ? levelsResult.view : null;
  const levels = levelsView && levelsView.startUs === startUs && levelsView.endUs === endUs ? audioLevels(levelsView) : null;
  const filters = audio.filter((item) => !["source_stream", "master_gain", "fade_in", "fade_out", "mute"].includes(item.operation));
  const toggleMute = () => onAudioChange(mute
    ? audio.filter((item) => item.id !== mute.id)
    : [...audio, { id: id(), startUs: 0, endUs: durationUs, operation: "mute", parameters: {} }]);
  return (
    <div className="audio-inspector p-3">
      <h3 className="text-[11px] font-semibold text-ink">Propiedades del audio</h3>
      <p className="mt-1 text-[8px] text-muted/55">{hasAudio ? `${sourceAudioStreams} ${sourceAudioStreams === 1 ? "stream real" : "streams reales"} · Pista ${streamIndex + 1}` : "Sin audio"}</p>
      {hasAudio ? <>
        <div className="mt-3 rounded-md border border-line bg-canvas/50 p-2.5">
          <div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate text-[9px] font-semibold text-ink">{selectedAudio ? operationLabel(selectedAudio) : `Pista ${streamIndex + 1} · Audio fuente`}</span><button aria-label={mute ? "Activar pista en exportación" : "Silenciar pista en exportación"} className="text-cyan" onClick={toggleMute} type="button">{mute ? <VolumeX size={14}/> : <Volume2 size={14}/>}</button></div>
          <p className="mt-2 font-mono text-[8px] text-muted">{formatTimecode(startUs)} → {formatTimecode(endUs)}</p>
          <p className="mt-1 text-[8px] text-muted/55">Duración {formatTimecode(Math.max(0, endUs - startUs))}</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Level label="Pico · dBFS" value={loadingLevels ? "Midiendo…" : levels?.peakDb ?? "Sin analizar"}/>
          <Level label="RMS · dBFS" value={loadingLevels ? "Midiendo…" : levels?.averageDb ?? "Sin analizar"}/>
          <Level label="Volumen" value={`${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB`}/>
          <Level label="Pista" value={mute ? "Silenciada" : `Pista ${streamIndex + 1}`}/>
          <Level label="Fade in" value={`${fadeIn.toFixed(1)} s`}/>
          <Level label="Fade out" value={`${fadeOut.toFixed(1)} s`}/>
          <Level label="Normalizar" value={normalize ? "Sí" : "No"}/>
          <Level label="Mejorar voz" value={improveVoice ? "Sí" : "No"}/>
        </div>
        <p className="mt-2 text-[8px] text-muted/55">{filters.length ? `Procesamiento activo: ${filters.map(operationLabel).join(", ")}` : "Sin procesamiento adicional"}</p>
      </> : null}
    </div>
  );
}

function Level({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-line bg-canvas/50 p-2"><p className="text-[8px] text-muted/55">{label}</p><strong className="mt-1 block font-mono text-[9px] text-ink">{value}</strong></div>;
}

function AudioToggle({ checked, disabled = false, label, onClick }: { checked: boolean; disabled?: boolean; label: string; onClick: () => void }) {
  return <button aria-pressed={checked} className={`flex min-h-8 items-center justify-between rounded-md px-2.5 text-[8px] font-medium ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${checked ? "bg-cyan/[0.07] text-ink ring-cyan/15" : "bg-white/[0.02] text-muted/60 ring-white/[0.05] hover:bg-white/[0.04]"}`} disabled={disabled} onClick={onClick} type="button"><span>{label}</span><span className={`h-3.5 w-6 rounded-full p-0.5 ${checked ? "bg-cyan/70" : "bg-white/[0.10]"}`}><i className={`block h-2.5 w-2.5 rounded-full bg-white transition-transform ${checked ? "translate-x-2.5" : ""}`}/></span></button>;
}

function Control({ children, label, value }: { children: import("react").ReactNode; label: string; value: string; }) {
  return <label className="mb-3 block"><span className="flex items-center justify-between text-[8px] font-medium text-muted/55">{label}<b className="font-mono font-medium text-ink/70">{value}</b></span><div className="mt-2">{children}</div></label>;
}

function operationLabel(item: AudioDecision) {
  switch (item.operation) {
    case "noise_reduction": return "Reducción de ruido";
    case "voice_focus": return "Enfoque de voz";
    case "hum_filter": return "Filtro de zumbido";
    case "normalize": return "Normalización";
    case "source_stream": return `Pista fuente ${numberParameter(item, "index") + 1}`;
    case "peak_limiter": return "Protección de picos";
    case "master_gain": return `Ganancia maestra ${numberParameter(item, "gainDb")} dB`;
    case "fade_in": return `Fade in ${Number(item.parameters.durationUs ?? 0) / 1_000_000} s`;
    case "fade_out": return `Fade out ${Number(item.parameters.durationUs ?? 0) / 1_000_000} s`;
    case "mute": return "Pista silenciada";
    case "mute_range": return "Silenciar tramo";
    case "gain_range": return `Ganancia ${numberParameter(item, "gainDb")} dB`;
    case "noise_reduction_range": return "Limpieza de tramo";
    case "notch_range": return `Pitido ${parameterNumber(item, "hz", 0)} Hz`;
    default: return item.operation;
  }
}

function numberParameter(item: AudioDecision, key: string) {
  const value = item.parameters[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}


function parameterNumber(item: AudioDecision, key: string, fallback: number) {
  const value = item.parameters[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
