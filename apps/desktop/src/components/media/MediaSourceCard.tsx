import { Film, GripVertical, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { formatTimecode } from "../../editor/timecode";
import { canLoadTimelineVisuals, timelineThumbnail } from "../../editor/visuals";
import type { ProjectBundle } from "../../project/contracts";
import { Button } from "../Button";

export function MediaSourceCard({ bundle, onAdd, onPreview, placed }: {
  bundle: ProjectBundle;
  onAdd: () => void;
  onPreview: () => void;
  placed: boolean;
}) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const projectId = bundle.project.projectId;
  const durationUs = bundle.source.durationUs ?? 0;
  useEffect(() => {
    if (!canLoadTimelineVisuals()) return;
    let cancelled = false;
    void timelineThumbnail(projectId, Math.min(Math.round(durationUs * 0.1), 10_000_000))
      .then((url) => { if (!cancelled) setThumbnail(url); })
      .catch(() => { if (!cancelled) setThumbnail(null); });
    return () => { cancelled = true; };
  }, [durationUs, projectId]);
  return <div className="media-source-card">
    <div className="mb-2 flex items-center justify-between"><p className="text-[9px] font-bold uppercase tracking-[0.12em] text-cyan">Medios importados</p><span className="text-[8px] text-muted">1 archivo</span></div>
    <button
      aria-label={`Previsualizar ${bundle.source.fileName}`}
      className="media-source-preview"
      draggable
      onClick={onPreview}
      onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-cheto-source", projectId); event.dataTransfer.setData("text/plain", projectId); }}
      title="Arrastra este video a la pista Video"
      type="button"
    >
      {thumbnail ? <img alt="" src={thumbnail} /> : <Film size={25}/>}
      <span>{formatTimecode(durationUs)}</span>
      <GripVertical className="media-source-grip" size={18}/>
    </button>
    <p className="mt-2 truncate text-[10px] font-semibold text-ink" title={bundle.source.fileName}>{bundle.source.fileName}</p>
    <p className="mt-1 text-[8px] text-muted">{placed ? "En la timeline · arrastrable" : "Fuera de la timeline · original conservado"}</p>
    {!placed ? <Button className="mt-3 w-full" icon={<Plus size={13}/>} onClick={onAdd}>Añadir a la timeline</Button> : null}
  </div>;
}
