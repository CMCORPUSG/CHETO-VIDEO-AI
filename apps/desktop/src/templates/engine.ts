import type { TitleDecision, TitlePresetId } from "../project/contracts";
import { TEMPLATE_REGISTRY, validateTemplate, type EasingId, type ParameterDefinition, type ResponsiveLayout, type TemplateManifest, type TemplateVariant } from "./registry";

export interface MotionState { opacity: number; secondaryOpacity: number; translateX: number; translateY: number; scale: number; lineProgress: number; maskProgress: number; revealedCharacters: number }
export interface ResolvedTemplateState {
  manifest: TemplateManifest;
  instanceId: string;
  variant: TemplateVariant;
  phase: "before" | "in" | "hold" | "out" | "after";
  parameters: Record<string, string | number | boolean>;
  layout: { x: number; y: number; fontScale: number; maxWidth: number; panelWidth: number; alignment: "left" | "center" | "right"; safeArea: number };
  motion: MotionState;
  localTimeUs: number;
  durationUs: number;
  fallbackUsed: boolean;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const BASE_MOTION: MotionState = { opacity: 1, secondaryOpacity: 1, translateX: 0, translateY: 0, scale: 1, lineProgress: 1, maskProgress: 1, revealedCharacters: 0 };
const SPRINGS: Record<"springSoft" | "springMedium" | "springPunch", { mass: number; damping: number; stiffness: number }> = {
  springSoft: { mass: 1, damping: 16, stiffness: 90 },
  springMedium: { mass: 1, damping: 13, stiffness: 145 },
  springPunch: { mass: 0.9, damping: 11, stiffness: 210 },
};

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function normalized(value: number) { return clamp(Number.isFinite(value) ? value : 0, 0, 1); }

export function ease(id: EasingId, progress: number): number {
  const t = normalized(progress);
  switch (id) {
    case "linear": return t;
    case "easeIn": return t * t * t;
    case "easeOut": return 1 - (1 - t) ** 3;
    case "easeInOut": return t * t * (3 - 2 * t);
    case "easeInOutCubic": return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    default: {
      const spring = SPRINGS[id];
      const omega = Math.sqrt(spring.stiffness / spring.mass);
      const decay = spring.damping / (2 * spring.mass);
      return clamp(1 - Math.exp(-decay * t * 0.8) * Math.cos(omega * t * 0.8), 0, 1.25);
    }
  }
}

export function seededGlitch(templateId: string, instanceId: string, frame: number, seed = 0): number {
  let hash = 2166136261;
  for (const char of `${templateId}:${instanceId}:${frame}:${seed}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) / 0xffffffff;
}

export function variantForAspect(aspectRatio: number): TemplateVariant {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return "landscape";
  if (aspectRatio < 0.8) return "portrait";
  if (aspectRatio < 1.15) return "square";
  if (aspectRatio < 1.55) return "classic";
  if (aspectRatio >= 2.15) return "ultrawide";
  return "landscape";
}

export function normalizeParameter(definition: ParameterDefinition, value: unknown): string | number | boolean {
  if (definition.type === "boolean") return typeof value === "boolean" ? value : Boolean(definition.default);
  if (["number","percentage","fontWeight","position","scale"].includes(definition.type)) {
    const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    const fallback = Number(definition.default);
    return clamp(Number.isFinite(numeric) ? numeric : fallback, definition.min ?? -1e9, definition.max ?? 1e9);
  }
  if (definition.type === "color") return typeof value === "string" && COLOR.test(value) ? value.toUpperCase() : String(definition.default);
  if (definition.type === "enum" || definition.type === "font") return typeof value === "string" && definition.options?.includes(value) ? value : String(definition.default);
  const text = typeof value === "string" ? value : String(definition.default);
  return text.slice(0, definition.type === "multilineText" ? 1000 : 140);
}

export function resolveManifest(title: TitleDecision): { manifest: TemplateManifest | null; fallbackUsed: boolean; error?: string } {
  const templateId = title.templateId ?? TEMPLATE_REGISTRY.getLegacy(title.presetId)?.templateId;
  const version = title.templateVersion ?? TEMPLATE_REGISTRY.getLegacy(title.presetId)?.templateVersion;
  if (!templateId || !version) return { manifest: null, fallbackUsed: false, error: `Template no disponible: ${title.presetId}` };
  const exact = TEMPLATE_REGISTRY.getTemplate(templateId, version);
  if (exact) return { manifest: exact, fallbackUsed: false };
  const snapshot = title.templateSnapshot;
  if (snapshot?.templateId === templateId && snapshot.templateVersion === version && validateTemplate(snapshot).length === 0) return { manifest: snapshot, fallbackUsed: true };
  return { manifest: null, fallbackUsed: false, error: `TEMPLATE_VERSION_MISSING ${templateId}@${version}` };
}

export function migrateLegacyTitle(title: TitleDecision): TitleDecision {
  if (title.templateId && title.templateVersion) return title;
  const manifest = TEMPLATE_REGISTRY.getLegacy(title.presetId);
  if (!manifest) return title;
  const parameters: Record<string, string | number | boolean> = {};
  for (const definition of manifest.parameters) {
    const legacyValue = title[definition.id as keyof TitleDecision];
    if (typeof legacyValue === "string" || typeof legacyValue === "number" || typeof legacyValue === "boolean") parameters[definition.id] = normalizeParameter(definition, legacyValue);
  }
  return { ...title, instanceId: title.id, templateId: manifest.templateId, templateVersion: manifest.templateVersion, parameters, templateSnapshot: manifest };
}

export function attachTemplateIdentity(title: TitleDecision): TitleDecision {
  const manifest = TEMPLATE_REGISTRY.getLegacy(title.presetId);
  if (!manifest) return title;
  return { ...title, instanceId: title.id, templateId: manifest.templateId, templateVersion: manifest.templateVersion, parameters: {}, templateSnapshot: manifest };
}

export function editTemplateParameter(title: TitleDecision, id: string, value: unknown): TitleDecision {
  const migrated = migrateLegacyTitle(title);
  const manifest = resolveManifest(migrated).manifest;
  const definition = manifest?.parameters.find(parameter => parameter.id === id);
  if (!definition) return migrated;
  const normalizedValue = normalizeParameter(definition, value);
  const parameters = { ...migrated.parameters, [id]: normalizedValue };
  return { ...migrated, parameters, [id]: normalizedValue };
}

export function normalizeTemplateInstance(title: TitleDecision, sourceDurationUs: number): TitleDecision {
  const migrated = migrateLegacyTitle(title);
  const manifest = resolveManifest(migrated).manifest;
  const sourceEnd = Math.max(1, Number.isFinite(sourceDurationUs) ? Math.round(sourceDurationUs) : 1);
  const startUs = clamp(Number.isFinite(migrated.startUs) ? Math.round(migrated.startUs) : 0, 0, sourceEnd - 1);
  const minimum = Math.min(sourceEnd - startUs, (manifest?.durationMs.minimum ?? 100) * 1000);
  const maximum = Math.min(sourceEnd - startUs, (manifest?.durationMs.maximum ?? 3_600_000) * 1000);
  const requestedLength = Number.isFinite(migrated.endUs - migrated.startUs) ? Math.round(migrated.endUs - migrated.startUs) : minimum;
  const length = clamp(requestedLength, Math.max(1, minimum), Math.max(1, maximum));
  const endUs = startUs + length;
  const parameters = { ...migrated.parameters };
  let result: TitleDecision = { ...migrated, startUs, endUs, animationInUs: clamp(Number.isFinite(migrated.animationInUs) ? migrated.animationInUs : 0, 0, length / 2), animationOutUs: clamp(Number.isFinite(migrated.animationOutUs) ? migrated.animationOutUs : 0, 0, length / 2), opacity: clamp(Number.isFinite(migrated.opacity) ? migrated.opacity : 1, 0, 1) };
  for (const definition of manifest?.parameters ?? []) {
    if (parameters[definition.id] === undefined) continue;
    const legacyValue = result[definition.id as keyof TitleDecision];
    const value = normalizeParameter(definition, typeof legacyValue === "string" || typeof legacyValue === "number" || typeof legacyValue === "boolean" ? legacyValue : parameters[definition.id]);
    parameters[definition.id] = value;
    if (definition.id in result) result = { ...result, [definition.id]: value };
  }
  return { ...result, parameters };
}

export function hydrateTemplateInstance(title: TitleDecision): TitleDecision {
  let result = migrateLegacyTitle(title);
  const manifest = resolveManifest(result).manifest;
  for (const definition of manifest?.parameters ?? []) {
    const override = result.parameters?.[definition.id];
    if (override === undefined || !(definition.id in result)) continue;
    result = { ...result, [definition.id]: normalizeParameter(definition, override) };
  }
  return result;
}

export function resetTemplateParameter(title: TitleDecision, id: string): TitleDecision {
  const migrated = migrateLegacyTitle(title);
  const manifest = resolveManifest(migrated).manifest;
  const definition = manifest?.parameters.find(parameter => parameter.id === id);
  if (!definition) return migrated;
  const parameters = { ...migrated.parameters };
  delete parameters[id];
  return { ...migrated, parameters, [id]: normalizeParameter(definition, definition.default) };
}

export function resetTemplateDesign(title: TitleDecision): TitleDecision {
  let result = migrateLegacyTitle(title);
  const manifest = resolveManifest(result).manifest;
  if (!manifest) return result;
  for (const definition of manifest.parameters) if (definition.id !== "text" && definition.id !== "secondaryText") result = resetTemplateParameter(result, definition.id);
  const layerOverrides = Object.fromEntries(Object.entries(result.layerOverrides ?? {}).map(([id, value]) => [id, value.text === undefined ? {} : { text: value.text }]));
  return { ...result, layerOverrides, layoutOverrides: {} };
}

export function swapTemplate(title: TitleDecision, targetTemplateId: string, targetVersion: string, createLegacy: (presetId: TitlePresetId, atUs: number, durationUs: number) => TitleDecision): TitleDecision | null {
  const manifest = TEMPLATE_REGISTRY.getTemplate(targetTemplateId, targetVersion);
  if (!manifest) return null;
  const fresh = attachTemplateIdentity(createLegacy(manifest.legacyPresetId as TitlePresetId, title.startUs, title.endUs + 1));
  let swapped: TitleDecision = { ...fresh, id: title.id, instanceId: title.instanceId ?? title.id, startUs: title.startUs, endUs: title.endUs };
  swapped = { ...swapped, templateId: manifest.templateId, templateVersion: manifest.templateVersion, templateSnapshot: manifest, parameters: {} };
  for (const id of ["text","secondaryText","accentColor"]) {
    const value = title[id as keyof TitleDecision];
    swapped = editTemplateParameter(swapped, id, value);
  }
  return swapped;
}

export function resolveTemplateInstance(title: TitleDecision, aspectRatio: number, timelineUs: number): ResolvedTemplateState | null {
  const { manifest, fallbackUsed } = resolveManifest(title);
  if (!manifest) return null;
  const variant = variantForAspect(aspectRatio);
  const variantLayout: ResponsiveLayout = manifest.responsiveVariants[variant] ?? manifest.responsiveVariants.landscape ?? {};
  const safeArea = manifest.safeArea[variant] ?? manifest.safeArea.landscape;
  const parameters: Record<string, string | number | boolean> = {};
  for (const definition of manifest.parameters) parameters[definition.id] = normalizeParameter(definition, title.parameters?.[definition.id] ?? title[definition.id as keyof TitleDecision] ?? definition.default);
  const positionX = Number(parameters.positionX ?? title.positionX);
  const positionY = Number(parameters.positionY ?? title.positionY);
  const userX = title.parameters && Object.hasOwn(title.parameters, "positionX");
  const userY = title.parameters && Object.hasOwn(title.parameters, "positionY");
  const primaryId = manifest.layers?.find(layer => layer.parameterId === "text")?.layerId;
  const layerLayout = primaryId ? title.layerOverrides?.[primaryId]?.layoutOverrides?.[variant] : undefined;
  const globalLayout = title.layoutOverrides?.[variant];
  const x = clamp(layerLayout?.x ?? globalLayout?.x ?? (userX ? positionX : variantLayout.positionX ?? positionX), safeArea, 1 - safeArea);
  const y = clamp(layerLayout?.y ?? globalLayout?.y ?? (userY ? positionY : variantLayout.positionY ?? positionY), safeArea, 1 - safeArea);
  const durationUs = Math.max(1, title.endUs - title.startUs);
  const localTimeUs = timelineUs - title.startUs;
  const inUs = Math.min(durationUs / 2, Math.max(0, title.animationInUs));
  const outUs = Math.min(durationUs / 2, Math.max(0, title.animationOutUs));
  const inProgress = inUs ? normalized(localTimeUs / inUs) : 1;
  const outProgress = outUs ? normalized((durationUs - localTimeUs) / outUs) : 1;
  const eased = ease(manifest.animationIn.easing, inProgress);
  const phase = localTimeUs < 0 ? "before" : localTimeUs >= durationUs ? "after" : localTimeUs < inUs ? "in" : localTimeUs >= durationUs - outUs ? "out" : "hold";
  const text = String(parameters.text ?? title.text);
  const motion: MotionState = { ...BASE_MOTION, opacity: normalized(Math.min(inProgress, outProgress) * title.opacity), secondaryOpacity: normalized(Math.min(1, Math.max(0, (localTimeUs - 180_000) / Math.max(1, inUs))) * outProgress * title.opacity), revealedCharacters: [...text].length };
  const recipe = new Set(manifest.recipe);
  if (recipe.has("translateY")) motion.translateY = (1 - eased) * 30;
  if (recipe.has("translateX")) motion.translateX = (1 - eased) * (title.anchor === "right" ? 52 : -52);
  if (recipe.has("scale")) motion.scale = 1 + (1 - eased) * (manifest.templateId === "cheto.gaming-impact" ? 0.42 : 0.24);
  if (recipe.has("underline") || recipe.has("accentBar")) motion.lineProgress = eased;
  if (recipe.has("clipReveal") || recipe.has("highlight")) motion.maskProgress = eased;
  if (recipe.has("staggerCharacters") || recipe.has("staggerWords")) motion.revealedCharacters = Math.min([...text].length, Math.max(0, Math.ceil([...text].length * eased)));
  if (phase === "before" || phase === "after") motion.opacity = 0;
  return { manifest, instanceId: title.instanceId ?? title.id, variant, phase, parameters, layout: { x, y, fontScale: variantLayout.fontScale ?? 1, maxWidth: layerLayout?.maxWidth ?? globalLayout?.maxWidth ?? variantLayout.maxWidth ?? 0.82, panelWidth: variantLayout.panelWidth ?? 0.63, alignment: variantLayout.alignment ?? title.alignment, safeArea }, motion, localTimeUs, durationUs, fallbackUsed };
}
