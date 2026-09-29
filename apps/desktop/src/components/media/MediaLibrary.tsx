import { Film, GripVertical, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { formatTimecode } from "../../editor/timecode";
import { importThumbnail } from "../../editor/visuals";
import type { ImportedMedia } from "../../media/library";
import { Button } from "../Button";

function MediaTile({ item, onSelect, onPreview, onRemove, selected, sourcePath }: { item: ImportedMedia; onSelect: () => void; onPreview: () => void; onRemove: () => void; selected: boolean; sourcePath: string }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    void importThumbnail(item.path, Math.min(item.durationUs / 10, 10_000_000)).then(value => { if (!disposed) setThumbnail(value); }).catch(() => { if (!disposed) setThumbnail(null); });
    return () => { disposed = true; };
  }, [item.path, item.durationUs]);
  return <div className="media-library-item">
    <button aria-label={`Seleccionar ${item.fileName}`} aria-pressed={selected} className={`media-library-tile ${selected ? "is-selected" : ""}`} draggable onClick={onSelect} onDoubleClick={onPreview} onDragStart={event => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-cheto-media-path", item.path); }} title={`${item.fileName}\n${item.path}`} type="button">
      <span className="media-library-image">{thumbnail ? <img alt="" src={thumbnail} /> : <Film size={24} />}<i>{formatTimecode(item.durationUs)}</i><GripVertical size={15} /></span>
      <strong>{item.fileName}</strong><small>{item.path === sourcePath ? "Fuente activa" : "Importado"}</small>
    </button>
    {item.path !== sourcePath ? <button aria-label={`Quitar ${item.fileName} de Medios`} className="media-library-remove" onClick={onRemove} title="Quitar de Medios (conserva el archivo original)" type="button"><Trash2 size={13} /></button> : null}
  </div>;
}

export function MediaLibrary({ items, selectedPath, sourcePath, onAdd, onImport, onSelect, onPreview, onRemove, busy }: { items: ImportedMedia[]; selectedPath: string; sourcePath: string; onAdd: () => void; onImport: () => void; onSelect: (path: string) => void; onPreview: (path: string) => void; onRemove: (path: string) => void; busy: boolean }) {
  return <section className="media-library rounded-lg border border-line bg-canvas/50 p-3" aria-label="Medios importados">
    <div className="mb-3 flex items-center justify-between"><h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-cyan">Medios importados</h3><span className="text-[9px] text-muted">{items.length} archivo{items.length === 1 ? "" : "s"}</span></div>
    <Button className="mb-3 w-full" disabled={busy} icon={<Upload size={14} />} onClick={onImport}>{busy ? "Analizando…" : "Importar video"}</Button>
    <div className="grid grid-cols-2 gap-2">{items.map(item => <MediaTile item={item} key={item.path} onSelect={() => onSelect(item.path)} onPreview={() => onPreview(item.path)} onRemove={() => onRemove(item.path)} selected={item.path === selectedPath} sourcePath={sourcePath} />)}</div>
    <Button className="mt-3 w-full" disabled={!items.some(item => item.path === selectedPath)} icon={<Plus size={13} />} onClick={onAdd}>Añadir seleccionado a timeline</Button>
    <p className="mt-2 text-[9px] leading-4 text-muted">Click selecciona. Doble click abre la vista previa. Arrastra el medio a la pista Video. Usa el botón de quitar o Supr para retirar un importado. El original no se modifica.</p>
  </section>;
}
