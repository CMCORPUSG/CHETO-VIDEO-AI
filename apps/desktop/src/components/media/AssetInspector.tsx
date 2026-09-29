import type { AssetDecision } from "../../project/contracts";
import { formatTimecode } from "../../editor/timecode";
import { Button } from "../Button";
import { Card } from "../Card";

export function AssetInspector({ item, onChange, onDelete, onDuplicate }: {
  item: AssetDecision | null;
  onChange: (item: AssetDecision) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  if (!item) return <Card className="p-3 text-[9px] text-muted">Selecciona un recurso en la timeline.</Card>;
  const change = (values: Partial<AssetDecision>) => onChange({ ...item, ...values });
  return <Card className="space-y-3 p-3">
    <div><p className="text-[10px] font-semibold text-ink">{item.kind === "overlay" ? "GIF / overlay" : item.kind === "music" ? "Música" : "SFX"}</p><p className="mt-1 break-all text-[8px] text-muted">{item.assetPath}</p><p className="mt-1 font-mono text-[8px] text-muted">{formatTimecode(item.startUs)} → {formatTimecode(item.endUs)}</p></div>
    {item.kind !== "overlay" ? <>
      <label className="block text-[8px] text-muted">Volumen {item.gainDb.toFixed(1)} dB<input aria-label="Volumen del recurso" className="mt-1 w-full accent-cyan" max="12" min="-60" onChange={event => change({ gainDb: Number(event.target.value) })} step="1" type="range" value={item.gainDb}/></label>
      {item.kind === "music" ? <div className="flex gap-1">{[["Muy suave",-30],["Suave",-24],["Normal",-18]].map(([label,db]) => <Button key={label} onClick={() => change({gainDb:Number(db)})} variant="secondary">{label}</Button>)}</div> : null}
      <NumberField label="Fade in (ms)" min={0} max={30000} value={Math.round(item.fadeInUs / 1000)} onCommit={value=>change({fadeInUs:value*1000})}/>
      <NumberField label="Fade out (ms)" min={0} max={30000} value={Math.round(item.fadeOutUs / 1000)} onCommit={value=>change({fadeOutUs:value*1000})}/>
    </> : <>
      <label className="block text-[8px] text-muted">Escala {Math.round(item.scale*100)}%<input aria-label="Escala del GIF" className="mt-1 w-full accent-cyan" max="1" min="0.05" onChange={event => change({scale:Number(event.target.value)})} step="0.05" type="range" value={item.scale}/></label>
      <label className="block text-[8px] text-muted">Opacidad {Math.round(item.opacity*100)}%<input aria-label="Opacidad del GIF" className="mt-1 w-full accent-cyan" max="1" min="0.1" onChange={event => change({opacity:Number(event.target.value)})} step="0.05" type="range" value={item.opacity}/></label>
      <label className="block text-[8px] text-muted">Posición X {Math.round(item.positionX*100)}%<input aria-label="Posición X del GIF" className="mt-1 w-full accent-cyan" max="1" min="0" onChange={event => change({positionX:Number(event.target.value)})} step="0.01" type="range" value={item.positionX}/></label>
      <label className="block text-[8px] text-muted">Posición Y {Math.round(item.positionY*100)}%<input aria-label="Posición Y del GIF" className="mt-1 w-full accent-cyan" max="1" min="0" onChange={event => change({positionY:Number(event.target.value)})} step="0.01" type="range" value={item.positionY}/></label>
    </>}
    {item.kind !== "sfx" ? <label className="flex items-center gap-2 text-[9px] text-ink"><input checked={item.loop} onChange={event => change({loop:event.target.checked})} type="checkbox"/>Repetir recurso</label> : null}
    {item.kind === "music" ? <>
      <label className="flex items-center gap-2 text-[9px] text-ink"><input checked={item.ducking} onChange={event => change({ducking:event.target.checked})} type="checkbox"/>Reducir música cuando hay audio fuente</label>
      {item.ducking ? <><label className="block text-[8px] text-muted">Intensidad<select className="cheto-input mt-1 w-full" onChange={event => change({duckDb:Number(event.target.value)})} value={item.duckDb}><option value="-6">Suave</option><option value="-12">Media</option><option value="-18">Fuerte</option></select></label><NumberField label="Ataque (ms)" min={10} max={2000} value={item.attackMs} onCommit={value=>change({attackMs:value})}/><NumberField label="Recuperación (ms)" min={50} max={5000} value={item.releaseMs} onCommit={value=>change({releaseMs:value})}/></> : null}
      <p className="text-[8px] text-muted">El ducking usa la señal de audio fuente como sidechain. Puede reaccionar también a sonidos fuertes que no sean voz.</p>
    </> : null}
    <label className="flex items-center gap-2 text-[9px] text-ink"><input checked={item.muted} onChange={event => change({muted:event.target.checked})} type="checkbox"/>Silenciar colocación</label>
    <div className="flex gap-2"><Button onClick={onDuplicate} variant="secondary">Duplicar</Button><Button onClick={onDelete} variant="secondary">Quitar de timeline</Button></div>
  </Card>;
}

function NumberField({label,min,max,value,onCommit}:{label:string;min:number;max:number;value:number;onCommit:(value:number)=>void}) {
  return <label className="block text-[8px] text-muted">{label}<input className="cheto-input mt-1 w-full" defaultValue={value} key={value} max={max} min={min} onBlur={event=>{const parsed=Number(event.target.value);if(Number.isFinite(parsed))onCommit(Math.max(min,Math.min(max,Math.round(parsed))));}} type="number"/></label>;
}
