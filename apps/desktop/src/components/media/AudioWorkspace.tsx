import {
  Gauge,
  Headphones,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  VolumeX,
  Waves,
} from "lucide-react";
import { Card } from "../Card";

interface AudioWorkspaceProps {
  hasAudio: boolean;
  muted: boolean;
  onMutedChange: (value: boolean) => void;
  onRateChange: (value: number) => void;
  onVolumeChange: (value: number) => void;
  rate: number;
  volume: number;
}

export function AudioWorkspace({
  hasAudio,
  muted,
  onMutedChange,
  onRateChange,
  onVolumeChange,
  rate,
  volume,
}: AudioWorkspaceProps) {
  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-2 text-ink">
          <Headphones size={15} className="text-cyan" />
          <h3 className="text-[12px] font-semibold">Audio</h3>
        </div>
        <div className="mt-3 grid grid-cols-2 rounded-md bg-white/[0.025] p-0.5 ring-1 ring-white/[0.05]">
          <button className="rounded-[5px] bg-primary/[0.13] px-3 py-2 text-[9px] font-semibold text-ink" type="button">Mejora IA</button>
          <button className="rounded-[5px] px-3 py-2 text-[9px] font-semibold text-muted/55" type="button">Pistas</button>
        </div>
      </div>

      <Card className="p-3">
        <div className="flex items-start gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-cyan/[0.08] text-cyan"><Sparkles size={14} /></span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-ink">Limpieza inteligente</p>
            <p className="mt-1 text-[8px] leading-4 text-muted/50">La interfaz queda preparada para reducción de TV, pitidos y voces externas. El motor de separación se conectará en el siguiente bloque funcional.</p>
          </div>
        </div>
        <button className="mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-md bg-white/[0.025] text-[9px] font-semibold text-muted/35 ring-1 ring-white/[0.05]" disabled title="Motor local de limpieza de audio todavía no conectado" type="button"><Waves size={13} />Analizar audio</button>
      </Card>

      <Card className="p-3">
        <div className="mb-3 flex items-center gap-2"><SlidersHorizontal size={13} className="text-muted/55" /><p className="text-[10px] font-semibold text-ink">Ajuste de previsualización</p></div>
        <Control label="Velocidad" value={`${rate.toFixed(2)}x`}>
          <input aria-label="Velocidad de reproducción" className="w-full accent-cyan" max="2" min="0.5" onChange={(event) => onRateChange(Number(event.currentTarget.value))} step="0.05" type="range" value={rate} />
        </Control>
        <Control label="Volumen" value={muted ? "Silenciado" : `${Math.round(volume * 100)}%`}>
          <input aria-label="Volumen de previsualización" className="w-full accent-cyan" disabled={!hasAudio} max="1" min="0" onChange={(event) => onVolumeChange(Number(event.currentTarget.value))} step="0.01" type="range" value={muted ? 0 : volume} />
        </Control>
        <button className={`mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-md px-3 text-[9px] font-semibold ring-1 transition-colors ${muted ? "bg-danger/[0.07] text-danger ring-danger/15" : "bg-white/[0.025] text-muted/70 ring-white/[0.06] hover:bg-white/[0.045] hover:text-ink"}`} disabled={!hasAudio} onClick={() => onMutedChange(!muted)} type="button">
          {muted ? <Volume2 size={13} /> : <VolumeX size={13} />}{muted ? "Activar audio" : "Silenciar audio"}
        </button>
      </Card>

      <div className="rounded-lg bg-white/[0.018] p-3 ring-1 ring-white/[0.04]">
        <div className="flex items-center gap-2 text-muted/55"><Gauge size={12} /><span className="text-[8px] font-semibold uppercase tracking-[0.08em]">Estado</span></div>
        <p className="mt-2 text-[9px] leading-4 text-muted/55">{hasAudio ? "Pista de audio original disponible. Los controles de velocidad, volumen y mute ya afectan la previsualización." : "La fuente no contiene audio."}</p>
      </div>
    </div>
  );
}

export function AudioInspector({ hasAudio, muted, onMutedChange, onVolumeChange, volume }: { hasAudio: boolean; muted: boolean; onMutedChange: (value: boolean) => void; onVolumeChange: (value: number) => void; volume: number; }) {
  return (
    <div className="audio-inspector">
      <div className="editor-inspector-tabs"><button type="button">Video</button><button className="is-active" type="button">Audio</button><button type="button">Ajustes</button></div>
      <div className="p-3">
        <div className="mb-3"><p className="text-[10px] font-semibold text-ink">Pistas de audio</p><p className="mt-1 text-[8px] text-muted/45">{hasAudio ? "1 pista fuente detectada" : "Sin audio"}</p></div>
        {hasAudio ? <div className="audio-track-card"><div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-md bg-success/[0.08] text-success"><Waves size={13} /></span><div className="min-w-0 flex-1"><p className="truncate text-[9px] font-semibold text-ink">Pista 1 · Audio original</p><div className="audio-wave-preview mt-2" /></div><button aria-label={muted ? "Activar pista" : "Silenciar pista"} className={`grid h-7 w-7 place-items-center rounded-md ${muted ? "bg-danger/[0.08] text-danger" : "bg-white/[0.03] text-muted/60"}`} onClick={() => onMutedChange(!muted)} type="button">{muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button></div></div> : null}
        <div className="mt-4 border-t border-white/[0.055] pt-4"><p className="text-[10px] font-semibold text-ink">Mezcla final</p><label className="mt-3 block text-[8px] font-medium text-muted/55">Volumen<div className="mt-2 flex items-center gap-2"><input aria-label="Volumen final de previsualización" className="min-w-0 flex-1 accent-cyan" disabled={!hasAudio} max="1" min="0" onChange={(event) => onVolumeChange(Number(event.currentTarget.value))} step="0.01" type="range" value={muted ? 0 : volume} /><span className="w-10 text-right font-mono text-[8px] text-muted/55">{muted ? "0%" : `${Math.round(volume * 100)}%`}</span></div></label></div>
        <div className="mt-4 rounded-lg bg-warning/[0.035] p-3 ring-1 ring-warning/10"><p className="text-[8px] leading-4 text-muted/55">Separación de voces, TV, pitidos y limpieza por hablante todavía no se presentan como funcionales. Se conectarán al motor local antes de habilitar esos controles.</p></div>
      </div>
    </div>
  );
}

function Control({ children, label, value }: { children: import("react").ReactNode; label: string; value: string; }) {
  return <label className="mb-3 block"><span className="flex items-center justify-between text-[8px] font-medium text-muted/55">{label}<b className="font-mono font-medium text-ink/70">{value}</b></span><div className="mt-2">{children}</div></label>;
}
