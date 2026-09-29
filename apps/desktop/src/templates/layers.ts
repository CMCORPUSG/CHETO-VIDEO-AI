import type { TitleDecision, TitleLayerOverride, TitleLayoutOverride } from "../project/contracts";
import { resolveTemplateInstance, variantForAspect } from "./engine";
import { TEMPLATE_REGISTRY, type TemplateLayer, type TemplateVariant } from "./registry";

export interface CanvasBounds { left: number; top: number; width: number; height: number }
export interface CanvasPoint { x: number; y: number }
export const screenToCanvas = (clientX: number, clientY: number, bounds: CanvasBounds): CanvasPoint => ({ x: (clientX - bounds.left) / Math.max(1, bounds.width), y: (clientY - bounds.top) / Math.max(1, bounds.height) });
export const canvasToScreen = (point: CanvasPoint, bounds: CanvasBounds) => ({ x: bounds.left + point.x * bounds.width, y: bounds.top + point.y * bounds.height });
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

export function titleLayers(title: TitleDecision): TemplateLayer[] {
  const manifest = title.templateId && title.templateVersion ? TEMPLATE_REGISTRY.getTemplate(title.templateId, title.templateVersion) ?? title.templateSnapshot : TEMPLATE_REGISTRY.getLegacy(title.presetId);
  return manifest?.layers ?? [{ layerId: "headline", type: "text", role: "Título", parameterId: "text", editable: true, locked: false }];
}

export function layerForParameter(title: TitleDecision, parameterId: string): TemplateLayer | undefined {
  return titleLayers(title).find(layer => layer.type === "text" && layer.parameterId === parameterId);
}

export function layerText(title: TitleDecision, layerId: string): string {
  const layer = titleLayers(title).find(item => item.layerId === layerId);
  const fallback = layer?.parameterId === "secondaryText" ? title.secondaryText : layer?.parameterId === "descriptionText" ? title.descriptionText ?? "" : title.text;
  return title.layerOverrides?.[layerId]?.text ?? fallback;
}

export function applyTextCase(text: string, mode: TitleLayerOverride["case"]): string {
  if (mode === "upper") return text.toLocaleUpperCase();
  if (mode === "lower") return text.toLocaleLowerCase();
  if (mode === "title") return text.toLocaleLowerCase().replace(/(^|\s)\p{L}/gu, match => match.toLocaleUpperCase());
  return text;
}

export function editLayerOverride(title: TitleDecision, layerId: string, patch: Partial<TitleLayerOverride>): TitleDecision {
  const layer = titleLayers(title).find(item => item.layerId === layerId && item.editable);
  if (!layer) return title;
  const current = title.layerOverrides?.[layerId] ?? {};
  const updated = { ...current, ...patch };
  const next: TitleDecision = { ...title, layerOverrides: { ...title.layerOverrides, [layerId]: updated } };
  if (patch.text !== undefined && layer.parameterId) return { ...next, [layer.parameterId]: patch.text, parameters: { ...next.parameters, [layer.parameterId]: patch.text } };
  return next;
}

export function editLayerLayout(title: TitleDecision, layerId: string, aspectRatio: number, patch: TitleLayoutOverride): TitleDecision {
  const variant = variantForAspect(aspectRatio);
  const current = title.layerOverrides?.[layerId]?.layoutOverrides?.[variant] ?? {};
  const safe = title.templateSnapshot?.safeArea[variant] ?? 0.06;
  const normalized: TitleLayoutOverride = {
    ...patch,
    x: patch.x === undefined ? undefined : clamp(patch.x, safe, 1 - safe),
    y: patch.y === undefined ? undefined : clamp(patch.y, safe, 1 - safe),
    scale: patch.scale === undefined ? undefined : clamp(patch.scale, 0.25, 4),
    rotation: patch.rotation === undefined ? undefined : clamp(patch.rotation, -180, 180),
    maxWidth: patch.maxWidth === undefined ? undefined : clamp(patch.maxWidth, 0.1, 0.95),
  };
  const merged = Object.fromEntries(Object.entries(normalized).filter(([,value]) => value !== undefined)) as TitleLayoutOverride;
  const override = title.layerOverrides?.[layerId] ?? {};
  return editLayerOverride(title, layerId, { layoutOverrides: { ...override.layoutOverrides, [variant]: { ...current, ...merged } } });
}

export function resolveLayerLayout(title: TitleDecision, layerId: string, aspectRatio: number) {
  const variant: TemplateVariant = variantForAspect(aspectRatio);
  const state = resolveTemplateInstance(title, aspectRatio, title.startUs + 1);
  const base = state?.layout ?? { x: title.positionX, y: title.positionY, maxWidth: 0.82, safeArea: title.safeArea };
  const override = title.layerOverrides?.[layerId]?.layoutOverrides?.[variant] ?? {};
  const isPrimary = layerForParameter(title, "text")?.layerId === layerId;
  const group = isPrimary ? title.layoutOverrides?.[variant] ?? {} : {};
  return {
    x: clamp(override.x ?? group.x ?? base.x, base.safeArea, 1 - base.safeArea),
    y: clamp(override.y ?? group.y ?? base.y, base.safeArea, 1 - base.safeArea),
    scale: clamp(override.scale ?? group.scale ?? 1, 0.25, 4),
    rotation: clamp(override.rotation ?? group.rotation ?? 0, -180, 180),
    maxWidth: clamp(override.maxWidth ?? group.maxWidth ?? base.maxWidth, 0.1, 0.95),
    baseX: base.x,
    baseY: base.y,
  };
}

export function resetLayerStyle(title: TitleDecision, layerId: string): TitleDecision {
  const current = title.layerOverrides?.[layerId];
  if (!current) return title;
  const { text, layoutOverrides } = current;
  return { ...title, layerOverrides: { ...title.layerOverrides, [layerId]: { text, layoutOverrides } } };
}

export function resetLayerPosition(title: TitleDecision, layerId: string, aspectRatio: number): TitleDecision {
  const variant = variantForAspect(aspectRatio);
  const current = title.layerOverrides?.[layerId];
  if (!current?.layoutOverrides?.[variant]) return title;
  const layouts = { ...current.layoutOverrides };
  delete layouts[variant];
  return { ...title, layerOverrides: { ...title.layerOverrides, [layerId]: { ...current, layoutOverrides: layouts } } };
}
