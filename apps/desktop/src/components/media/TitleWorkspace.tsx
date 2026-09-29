import { useCallback, useEffect, useRef, useState } from "react";
import type { TitleDecision, TitlePresetId, TransitionDecision, TransitionKind } from "../../project/contracts";
import { createTitle } from "../../visual/titles";
import { editTemplateParameter, resetTemplateDesign, resetTemplateParameter, resolveManifest, resolveTemplateInstance, swapTemplate } from "../../templates/engine";
import { TEMPLATE_REGISTRY, TEMPLATE_RENDERER_VERSION, type ParameterDefinition, type TemplateManifest } from "../../templates/registry";
import { TitlePreview } from "./TitlePreview";
import { TitleLayerInspector } from "./TitleLayerInspector";
import { PackWorkspace } from "./PackWorkspace";

const field = "w-full rounded border border-line bg-canvas px-2 py-1.5 text-xs text-ink";
const TRANSITIONS: { id: TransitionKind; label: string }[] = [
  { id: "fade-black", label: "Fade Black" }, { id: "cross-dissolve", label: "Cross Dissolve" },
  { id: "push", label: "Push" }, { id: "slide-wipe", label: "Slide Wipe" },
  { id: "whip-pan", label: "Whip Pan" }, { id: "zoom", label: "Zoom" },
];

const thumbnailSamples = new Map<string, TitleDecision>();
function sampleFor(manifest: TemplateManifest) {
  const key = `${manifest.templateId}@${manifest.templateVersion}:16:9:${manifest.preview.text}:${manifest.preview.secondaryText}:${TEMPLATE_RENDERER_VERSION}`;
  const cached = thumbnailSamples.get(key);
  if (cached) return cached;
  const sample = createTitle(manifest.legacyPresetId as TitlePresetId, 0, 5_000_000);
  sample.id = `sample-${manifest.templateId}`;
  sample.instanceId = sample.id;
  sample.text = manifest.preview.text;
  sample.secondaryText = manifest.preview.secondaryText;
  sample.templateId = manifest.templateId;
  sample.templateVersion = manifest.templateVersion;
  sample.templateSnapshot = manifest;
  sample.fontSize = Math.max(sample.fontSize, 148);
  sample.endUs = 5_000_000;
  thumbnailSamples.set(key, sample);
  return sample;
}

function TemplateCard({ manifest, onAdd }: { manifest: TemplateManifest; onAdd: (item: TemplateManifest) => void }) {
  const thumbnailRef = useRef<HTMLSpanElement>(null);
  const [thumbnailWidth, setThumbnailWidth] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!hovered) return;
    const start = performance.now();
    const timer = window.setInterval(() => setElapsed((performance.now() - start) * 1000), 50);
    return () => window.clearInterval(timer);
  }, [hovered]);
  useEffect(() => {
    const node = thumbnailRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setThumbnailWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const sample = sampleFor(manifest);
  return <button className="title-preset-card overflow-hidden rounded-lg border border-line bg-panel text-left text-[10px] hover:border-cyan" draggable key={manifest.templateId} onClick={() => onAdd(manifest)} onDragStart={event => event.dataTransfer.setData("application/x-cheto-title-preset", manifest.templateId.startsWith("cheto.pack.") ? `${manifest.templateId}@${manifest.templateVersion}` : manifest.legacyPresetId)} onMouseEnter={() => setHovered(true)} onMouseLeave={() => { setHovered(false); setElapsed(0); }} title={`${manifest.description} · ${manifest.category}`} type="button">
    <span className="template-thumbnail" ref={thumbnailRef}><span className="template-thumbnail-stage" style={{transform:`scale(${Math.max(0.01,thumbnailWidth / 1920)})`}}><TitlePreview title={sample} timeUs={hovered ? elapsed % 5_000_000 : 1_600_000} aspectRatio={16 / 9}/></span></span>
    <span className="block border-t border-line px-2 py-1"><strong className="block">{manifest.name}</strong><small className="text-[8px] text-muted">{manifest.category} · {manifest.kind} · {manifest.templateId.startsWith("cheto.pack.") ? "Pack local" : "Built-in"}</small></span>
  </button>;
}

function ParameterControl({ definition, value, onChange, onReset }: { definition: ParameterDefinition; value: string | number | boolean; onChange: (value: string | number | boolean) => void; onReset: () => void }) {
  const label = <span className="flex items-center justify-between gap-2"><span>{definition.label}</span><button aria-label={`Restablecer ${definition.label}`} className="text-[10px] text-muted hover:text-cyan" onClick={onReset} type="button">↺</button></span>;
  if (definition.type === "boolean") return <label className="block">{label}<input checked={Boolean(value)} className="ml-2" onChange={event => onChange(event.target.checked)} type="checkbox"/></label>;
  if (definition.type === "enum" || definition.type === "font") return <label className="block">{label}<select className={field} onChange={event => onChange(event.target.value)} value={String(value)}>{definition.options?.map(option => <option key={option} value={option}>{option}</option>)}</select></label>;
  if (definition.type === "color") return <label className="block">{label}<input className={`${field} h-9 p-1`} onChange={event => onChange(event.target.value)} type="color" value={String(value)}/></label>;
  if (definition.type === "multilineText") return <label className="block">{label}<textarea className={field} onChange={event => onChange(event.target.value)} rows={2} value={String(value)}/></label>;
  if (definition.type === "text") return <label className="block">{label}<input className={field} maxLength={140} onChange={event => onChange(event.target.value)} value={String(value)}/></label>;
  return <label className="block">{label}<input className={field} max={definition.max} min={definition.min} onChange={event => onChange(Number(event.target.value))} step={definition.step ?? 0.01} type="number" value={Number(value)}/></label>;
}

export function TitleWorkspace({ onAddTitle, onAddTransition, selectedTitle, selectedTransition, selectedLayerId, onSelectLayer, onChangeTitle, onChangeTransition, onDuplicateTitle, onPackEvent, durationUs, aspectRatio = 16 / 9 }: {
  onAddTitle: (preset: TitlePresetId | TemplateManifest) => void;
  onAddTransition: (kind: TransitionKind) => void;
  selectedTitle: TitleDecision | null;
  selectedTransition: TransitionDecision | null;
  selectedLayerId?: string | null;
  onSelectLayer?: (id: string) => void;
  onChangeTitle: (title: TitleDecision) => void;
  onChangeTransition: (transition: TransitionDecision) => void;
  onDuplicateTitle?: (title: TitleDecision) => void;
  onPackEvent?: (event: string, level?: "warning" | "error") => void;
  durationUs: number;
  aspectRatio?: number;
}) {
  const [category, setCategory] = useState("Todas");
  const [tab, setTab] = useState<"basico" | "plantillas" | "animacion">(selectedTitle ? "basico" : "plantillas");
  const [query, setQuery] = useState("");
  const [, setRegistryRevision] = useState(0);
  const onRegistryChange = useCallback(() => setRegistryRevision(value => value + 1), []);
  const templates = TEMPLATE_REGISTRY.listTemplates();
  const categories = [...new Set(templates.map(item => item.category))];
  const visible = templates.filter(item => (category === "Todas" || item.category === category) && `${item.name} ${item.description} ${item.tags.join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const resolved = selectedTitle ? resolveTemplateInstance(selectedTitle, aspectRatio, selectedTitle.startUs + 600_000) : null;
  const unavailable = selectedTitle && !resolved ? resolveManifest(selectedTitle).error : null;
  const patchTitle = (patch: Partial<TitleDecision>) => selectedTitle && onChangeTitle({ ...selectedTitle, ...patch });
  return <div className="space-y-4 text-xs text-ink">
    <nav aria-label="Panel de títulos" className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-canvas p-1">{([ ["basico","Básico"], ["plantillas","Plantillas"], ["animacion","Animación"] ] as const).map(([id,name]) => <button aria-selected={tab===id} className={`rounded px-1 py-2 text-[10px] font-semibold ${tab===id?"bg-cyan/15 text-cyan":"text-muted hover:text-ink"}`} key={id} onClick={()=>setTab(id)} role="tab" type="button">{name}</button>)}</nav>
    {tab==="plantillas" && <PackWorkspace templates={templates} onRegistryChange={onRegistryChange} onEvent={onPackEvent}/>}
    {tab==="plantillas" && <section className="template-gallery-container"><h3 className="mb-2 font-bold text-cyan">Plantillas de títulos</h3><p className="mb-2 text-[10px] text-muted">Plantillas built-in y paquetes locales. Arrastra a la pista o pulsa una tarjeta.</p>
      <input aria-label="Buscar plantillas" className={`${field} mb-2`} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nombre o estilo" value={query}/>
      <select aria-label="Categoría de títulos" className={`${field} mb-2`} onChange={event => setCategory(event.target.value)} value={category}><option>Todas</option>{categories.map(value => <option key={value}>{value}</option>)}</select>
      <div className="template-gallery-grid">{visible.map(manifest => <TemplateCard key={manifest.templateId} manifest={manifest} onAdd={onAddTitle}/>)}</div>
      {!visible.length && <p className="py-3 text-muted">Sin plantillas para esta búsqueda.</p>}
    </section>}
    {tab==="plantillas" && <section><h3 className="mb-2 font-bold text-cyan">Transiciones</h3><div className="grid grid-cols-2 gap-1">{TRANSITIONS.map(item => <button className="rounded border border-line bg-panel px-2 py-2 text-left text-[10px] hover:border-cyan" key={item.id} onClick={() => onAddTransition(item.id)} type="button">{item.label}</button>)}</div></section>}
    {selectedTitle && tab!=="plantillas" && <section className="space-y-2 border-t border-line pt-3"><h3 className="font-bold text-cyan">Editar título</h3>
      {unavailable && <p className="template-unavailable" role="alert">{unavailable}. La instancia conserva sus datos; selecciona una plantilla disponible para recuperarla.</p>}
      {tab==="basico" && <><label className="block">Plantilla<select className={field} onChange={event => { const [id, version] = event.target.value.split("@"); const swapped = swapTemplate(selectedTitle, id, version, createTitle); if (swapped) onChangeTitle(swapped); }} value={resolved ? `${resolved.manifest.templateId}@${resolved.manifest.templateVersion}` : ""}><option disabled value="">Seleccionar plantilla</option>{templates.map(item => <option key={item.templateId} value={`${item.templateId}@${item.templateVersion}`}>{item.name}</option>)}</select></label>
      <div className="flex gap-2"><button className="rounded border border-line px-2 py-1 hover:border-cyan" onClick={() => onChangeTitle(resetTemplateDesign(selectedTitle))} type="button">Restablecer diseño</button>{onDuplicateTitle && <button className="rounded border border-line px-2 py-1 hover:border-cyan" onClick={() => onDuplicateTitle(selectedTitle)} type="button">Duplicar</button>}</div>
      <TitleLayerInspector title={selectedTitle} selectedLayerId={selectedLayerId ?? null} onSelectLayer={onSelectLayer ?? (()=>{})} onChange={onChangeTitle} aspectRatio={aspectRatio}/></>}
      {tab==="basico" && <label className="block text-[10px] text-muted">Color de acento<input aria-label="Color de acento" className={`${field} h-9 p-1`} onChange={event=>onChangeTitle(editTemplateParameter(selectedTitle,"accentColor",event.target.value))} type="color" value={selectedTitle.accentColor}/></label>}
      {tab==="basico" && resolved && <details className="space-y-2 border-t border-line pt-2"><summary className="cursor-pointer text-muted">Ajustes de plantilla</summary>{["Contenido", "Diseño", "Posición", "Avanzado"].map(group => {
        const controls = resolved.manifest.parameters.filter(definition => (definition.group ?? "Avanzado") === group).map(definition => <ParameterControl definition={definition} key={definition.id} onChange={value => onChangeTitle(editTemplateParameter(selectedTitle, definition.id, value))} onReset={() => onChangeTitle(resetTemplateParameter(selectedTitle, definition.id))} value={resolved.parameters[definition.id]}/>);
        if (!controls.length) return null;
        return group === "Posición" || group === "Avanzado" ? <details className="space-y-2" key={group}><summary className="cursor-pointer text-muted">{group}</summary><div className="space-y-2 pt-2">{controls}</div></details> : <div className="space-y-2" key={group}><h4 className="font-semibold text-muted">{group}</h4>{controls}</div>;
      })}</details>}
      {tab==="animacion" && <div className="grid grid-cols-2 gap-2"><label>Inicio (s)<input className={field} max={durationUs / 1e6} min={0} onChange={event => { const startUs = Math.max(0, Math.min(durationUs - 1, Math.round(Number(event.target.value) * 1e6))); patchTitle({ startUs, endUs: Math.max(startUs + 1, selectedTitle.endUs) }); }} step="0.01" type="number" value={(selectedTitle.startUs / 1e6).toFixed(2)}/></label><label>Duración (s)<input className={field} max={durationUs / 1e6} min={0.1} onChange={event => patchTitle({ endUs: Math.min(durationUs, selectedTitle.startUs + Math.max(100_000, Math.round(Number(event.target.value) * 1e6))) })} step="0.1" type="number" value={((selectedTitle.endUs - selectedTitle.startUs) / 1e6).toFixed(2)}/></label><label>Entrada (s)<input className={field} max={2} min={0} onChange={event => patchTitle({ animationInUs: Math.round(Number(event.target.value) * 1e6) })} step={0.05} type="number" value={(selectedTitle.animationInUs / 1e6).toFixed(2)}/></label><label>Salida (s)<input className={field} max={2} min={0} onChange={event => patchTitle({ animationOutUs: Math.round(Number(event.target.value) * 1e6) })} step={0.05} type="number" value={(selectedTitle.animationOutUs / 1e6).toFixed(2)}/></label></div>}
      {import.meta.env.DEV && resolved && <details className="text-[10px] text-muted"><summary>Diagnóstico de plantilla</summary><pre>{JSON.stringify({ id: resolved.manifest.templateId, version: resolved.manifest.templateVersion, instance: resolved.instanceId, variant: resolved.variant, layout: resolved.layout, phase: resolved.phase, fallback: resolved.fallbackUsed }, null, 2)}</pre></details>}
    </section>}
    {selectedTransition && <section className="space-y-2 border-t border-line pt-3"><h3 className="font-bold text-cyan">Editar transición</h3><label>Momento (s)<input className={field} max={durationUs / 1e6} min={0} onChange={event => onChangeTransition({ ...selectedTransition, atUs: Math.round(Number(event.target.value) * 1e6) })} step={0.01} type="number" value={(selectedTransition.atUs / 1e6).toFixed(2)}/></label><label>Duración (s)<input className={field} max={2} min={0.1} onChange={event => onChangeTransition({ ...selectedTransition, durationUs: Math.round(Number(event.target.value) * 1e6) })} step={0.05} type="number" value={(selectedTransition.durationUs / 1e6).toFixed(2)}/></label></section>}
  </div>;
}
