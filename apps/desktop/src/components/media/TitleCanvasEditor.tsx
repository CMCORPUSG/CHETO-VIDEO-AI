import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { TitleDecision } from "../../project/contracts";
import { editLayerLayout, editLayerOverride, layerForParameter, layerText, resolveLayerLayout, titleLayers } from "../../templates/layers";
import { TitlePreview } from "./TitlePreview";

type Box = { left: number; top: number; width: number; height: number };

export function TitleCanvasEditor({ title, timeUs, aspectRatio, selectedLayerId, onSelectLayer, onCommit, onEditingChange }: {
  title: TitleDecision;
  timeUs: number;
  aspectRatio: number;
  selectedLayerId: string | null;
  onSelectLayer: (id: string) => void;
  onCommit: (title: TitleDecision) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<TitleDecision | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => { if (!selectedLayerId || !titleLayers(title).some(layer => layer.layerId === selectedLayerId)) onSelectLayer(layerForParameter(title, "text")?.layerId ?? "headline"); }, [title, selectedLayerId, onSelectLayer]);
  useEffect(() => () => cleanupRef.current?.(), []);
  const active = draft?.id === title.id ? draft : title;
  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !selectedLayerId) { setBox(null); return; }
    const node = [...stage.querySelectorAll<HTMLElement>("[data-title-layer-id]")].find(item => item.dataset.titleLayerId === selectedLayerId);
    if (!node) { setBox(null); return; }
    const bounds = node.getBoundingClientRect();
    const parent = stage.getBoundingClientRect();
    setBox({ left: bounds.left - parent.left, top: bounds.top - parent.top, width: bounds.width, height: bounds.height });
  }, [selectedLayerId]);
  useLayoutEffect(() => { measure(); }, [measure, active, aspectRatio, timeUs]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [measure]);

  const begin = (layerId: string, event: ReactPointerEvent<HTMLElement>, mode: "move" | "scale" | "width") => {
    const layer = titleLayers(active).find(item => item.layerId === layerId);
    if (!layer?.editable || editing) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectLayer(layerId);
    cleanupRef.current?.();
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const original = active;
    const layout = resolveLayerLayout(original, layerId, aspectRatio);
    let changed = false;
    let next = original;
    const onMove = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      const dx = (pointer.clientX - start.x) / Math.max(1, bounds.width);
      const dy = (pointer.clientY - start.y) / Math.max(1, bounds.height);
      if (Math.abs(dx) + Math.abs(dy) < 0.001) return;
      changed = true;
      if (mode === "move") {
        const snap = (value: number) => Math.abs(value - 0.5) < 0.012 ? 0.5 : value;
        next = editLayerLayout(original, layerId, aspectRatio, { x: snap(layout.x + dx), y: snap(layout.y + dy) });
      } else if (mode === "scale") {
        next = editLayerLayout(original, layerId, aspectRatio, { scale: layout.scale * Math.max(0.25, 1 + (dx + dy) * 1.6) });
      } else {
        next = editLayerLayout(original, layerId, aspectRatio, { maxWidth: layout.maxWidth + dx });
      }
      setDraft(next);
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      cleanupRef.current = null;
      if (changed) { setDraft(null); onCommit(next); }
    };
    cleanupRef.current = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };
  const finishEdit = () => {
    if (!editing) return;
    const current = editLayerOverride(active, editing, { text: editText });
    setDraft(null);
    setEditing(null);
    onEditingChange?.(false);
    if (layerText(active, editing) !== editText) onCommit(current);
  };
  const mainId = layerForParameter(active, "text")?.layerId ?? "headline";
  const activeLayer = selectedLayerId ?? mainId;
  return <div className="title-canvas-editor" ref={stageRef}>
    <TitlePreview title={active} timeUs={timeUs} aspectRatio={aspectRatio} interactive onLayerPointerDown={(id, event) => begin(id, event, "move")} onLayerDoubleClick={(id, event) => { event.stopPropagation(); onSelectLayer(id); setEditing(id); setEditText(layerText(active, id)); onEditingChange?.(true); }}/>
    {box && <div className="title-selection-box" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} aria-label={`Capa seleccionada: ${activeLayer}`}>
      {(["nw", "ne", "sw", "se"] as const).map(handle => <button aria-label={`Cambiar tamaño ${handle}`} className={`title-resize-handle title-resize-${handle}`} key={handle} onPointerDown={event => begin(activeLayer, event, "scale")} type="button"/>)}
      {(["w", "e"] as const).map(handle => <button aria-label={`Cambiar ancho ${handle}`} className={`title-resize-handle title-resize-${handle}`} key={handle} onPointerDown={event => begin(activeLayer, event, "width")} type="button"/>)}
    </div>}
    {editing && box && <textarea autoFocus aria-label="Editar texto sobre el video" className="title-inline-editor" onBlur={finishEdit} onChange={event => setEditText(event.target.value)} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { setEditing(null); onEditingChange?.(false); } if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); finishEdit(); } }} style={{ left: box.left, top: box.top, width: Math.max(160, box.width), minHeight: Math.max(48, box.height) }} value={editText}/>}
  </div>;
}
