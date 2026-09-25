import {
  Gauge,
  Headphones,
  MinusCircle,
  PlusCircle,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  Waves,
} from "lucide-react";
import { useState } from "react";
import type { AudioDecision } from "../../project/contracts";
import { formatTimecode } from "../../editor/timecode";
import { Button } from "../Button";
import { Card } from "../Card";

interface AudioWorkspaceProps {
  audio: AudioDecision[];
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
  audio,
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
  const noise = globalOperation(audio, "noise_reduction");
  const voice = globalOperation(audio, "voice_focus");
  const hum = globalOperation(audio, "hum_filter");
  const normalize = globalOperation(audio, "normalize");
  const masterGain = globalOperation(audio, "master_gain");
  const sourceStream = globalOperation(audio, "source_stream");
  const sourceStreamIndex = Math.max(
    0,
    Math.min(
      Math.max(0, sourceAudioStreams - 1),
      numberParameter(sourceStream ?? { id: "", startUs: 0, endUs: durationUs, operation: "source_stream", parameters: {} }, "index"),
    ),
  );
  const masterGainDb = Number(masterGain?.parameters.gainDb ?? 0);
  const [rangeGainDb, setRangeGainDb] = useState(-12);
  const [rangeNoiseAmount, setRangeNoiseAmount] = useState(0.45);
  const [notchHz, setNotchHz] = useState(4000);
  const [humHz, setHumHz] = useState(Number(hum?.parameters.hz ?? 60));
  const [noiseAmount, setNoiseAmount] = useState(Number(noise?.parameters.amount ?? 0.55));

  const toggleGlobal = (operation: string, parameters: Record<string, unknown> = {}) => {
    const exists = globalOperation(audio, operation);
    onAudioChange(
      exists
        ? audio.filter((item) => item.id !== exists.id)
        : [...audio, { id: id(), startUs: 0, endUs: durationUs, operation, parameters }],
    );
  };

  const setMasterGain = (gainDb: number) => {
    const without = audio.filter((item) => item.operation !== "master_gain");
    if (Math.abs(gainDb) < 0.05) {
      onAudioChange(without);
      return;
    }
    onAudioChange([...without, { id: masterGain?.id ?? id(), startUs: 0, endUs: durationUs, operation: "master_gain", parameters: { gainDb } }]);
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

      <Card className="p-3">
        <div className="flex items-start gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-cyan/[0.08] text-cyan"><Sparkles size={14} /></span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-ink">Limpieza de voz</p>
            <p className="mt-1 text-[8px] leading-4 text-muted/50">Filtros conservadores para videos largos. No reemplazan separación de hablantes.</p>
          </div>
        </div>

        <div className="mt-3 grid gap-2">
          <AudioToggle checked={Boolean(noise)} label="Reducir ruido continuo" onClick={() => toggleGlobal("noise_reduction", { amount: noiseAmount })} />
          {noise ? <Control label="Intensidad de reducción" value={Math.round(noiseAmount * 100) + "%"}><input aria-label="Intensidad de reducción de ruido" className="w-full accent-cyan" max="0.9" min="0.2" onChange={(event) => setNoiseAmount(Number(event.currentTarget.value))} step="0.05" type="range" value={noiseAmount} /></Control> : null}
          <AudioToggle checked={Boolean(voice)} label="Enfocar voz / recortar extremos" onClick={() => toggleGlobal("voice_focus", { preset: "speech" })} />
          <div className="grid grid-cols-[1fr_auto] items-center gap-2"><AudioToggle checked={Boolean(hum)} label={"Eliminar zumbido " + humHz + " Hz"} onClick={() => toggleGlobal("hum_filter", { hz: humHz })} /><select aria-label="Frecuencia de zumbido" className="h-8 rounded-md border border-white/[0.06] bg-white/[0.025] px-2 text-[8px] text-ink" onChange={(event) => setHumHz(Number(event.currentTarget.value))} value={humHz}><option value="50">50 Hz</option><option value="60">60 Hz</option></select></div>
          <AudioToggle checked={Boolean(globalOperation(audio, "peak_limiter"))} label="Proteger voz de picos" onClick={() => toggleGlobal("peak_limiter", { limit: 0.95 })} />
          <AudioToggle checked={Boolean(normalize)} label="Normalizar volumen final" onClick={() => toggleGlobal("normalize", { targetLufs: -16 })} />
        </div>
      </Card>

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
        <Control label="Ganancia exportación" value={`${masterGainDb > 0 ? "+" : ""}${masterGainDb.toFixed(1)} dB`}>
          <input aria-label="Ganancia final de exportación" className="w-full accent-cyan" disabled={!hasAudio} max="12" min="-12" onChange={(event) => setMasterGain(Number(event.currentTarget.value))} step="0.5" type="range" value={masterGainDb} />
        </Control>
        <Control label="Volumen de escucha" value={muted ? "Silenciado" : `${Math.round(volume * 100)}%`}>
          <input aria-label="Volumen de previsualización" className="w-full accent-cyan" disabled={!hasAudio} max="1" min="0" onChange={(event) => onVolumeChange(Number(event.currentTarget.value))} step="0.01" type="range" value={muted ? 0 : volume} />
        </Control>
        <button className={`mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-md px-3 text-[9px] font-semibold ring-1 transition-colors ${muted ? "bg-danger/[0.07] text-danger ring-danger/15" : "bg-white/[0.025] text-muted/70 ring-white/[0.06] hover:bg-white/[0.045] hover:text-ink"}`} disabled={!hasAudio} onClick={() => onMutedChange(!muted)} type="button">
          {muted ? <Volume2 size={13}/> : <VolumeX size={13}/>}
          {muted ? "Activar audio" : "Silenciar audio"}
        </button>
      </Card>

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

export function AudioInspector({ audio, hasAudio, muted, onMutedChange, onVolumeChange, volume }: { audio: AudioDecision[]; hasAudio: boolean; muted: boolean; onMutedChange: (value: boolean) => void; onVolumeChange: (value: number) => void; volume: number; }) {
  return (
    <div className="audio-inspector">
      <div className="editor-inspector-tabs"><button type="button">Video</button><button className="is-active" type="button">Audio</button><button type="button">Ajustes</button></div>
      <div className="p-3">
        <div className="mb-3"><p className="text-[10px] font-semibold text-ink">Pistas de audio</p><p className="mt-1 text-[8px] text-muted/45">{hasAudio ? "1 pista fuente detectada" : "Sin audio"}</p></div>
        {hasAudio ? <div className="audio-track-card"><div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-md bg-success/[0.08] text-success"><Waves size={13}/></span><div className="min-w-0 flex-1"><p className="truncate text-[9px] font-semibold text-ink">Pista 1 · Audio original</p><div className="audio-wave-preview mt-2"/></div><button aria-label={muted ? "Activar pista" : "Silenciar pista"} className={`grid h-7 w-7 place-items-center rounded-md ${muted ? "bg-danger/[0.08] text-danger" : "bg-white/[0.03] text-muted/60"}`} onClick={() => onMutedChange(!muted)} type="button">{muted ? <VolumeX size={13}/> : <Volume2 size={13}/>}</button></div></div> : null}
        <div className="mt-4 border-t border-white/[0.055] pt-4"><p className="text-[10px] font-semibold text-ink">Mezcla final</p><label className="mt-3 block text-[8px] font-medium text-muted/55">Volumen<div className="mt-2 flex items-center gap-2"><input aria-label="Volumen final de previsualización" className="min-w-0 flex-1 accent-cyan" disabled={!hasAudio} max="1" min="0" onChange={(event) => onVolumeChange(Number(event.currentTarget.value))} step="0.01" type="range" value={muted ? 0 : volume}/><span className="w-10 text-right font-mono text-[8px] text-muted/55">{muted ? "0%" : `${Math.round(volume * 100)}%`}</span></div></label></div>
        <div className="mt-4 rounded-lg bg-cyan/[0.025] p-3 ring-1 ring-cyan/10"><p className="text-[8px] leading-4 text-muted/55">{audio.length ? `${audio.length} edición(es) de audio se aplicarán en el render.` : "Sin filtros destructivos. El audio fuente permanece intacto."}</p></div>
      </div>
    </div>
  );
}

function AudioToggle({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return <button aria-pressed={checked} className={`flex min-h-8 items-center justify-between rounded-md px-2.5 text-[8px] font-medium ring-1 transition-colors ${checked ? "bg-cyan/[0.07] text-ink ring-cyan/15" : "bg-white/[0.02] text-muted/60 ring-white/[0.05] hover:bg-white/[0.04]"}`} onClick={onClick} type="button"><span>{label}</span><span className={`h-3.5 w-6 rounded-full p-0.5 ${checked ? "bg-cyan/70" : "bg-white/[0.10]"}`}><i className={`block h-2.5 w-2.5 rounded-full bg-white transition-transform ${checked ? "translate-x-2.5" : ""}`}/></span></button>;
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
