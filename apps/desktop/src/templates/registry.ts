import catalogJson from "./builtin-manifests.json";

export type TemplateKind = "title" | "lower-third" | "stat" | "callout" | "tutorial-step" | "quote";
export type TemplateVariant = "landscape" | "portrait" | "square" | "classic" | "ultrawide";
export type TemplateIntensity = "subtle" | "normal" | "strong";
export type ParameterType = "text" | "multilineText" | "number" | "percentage" | "color" | "boolean" | "enum" | "font" | "fontWeight" | "position" | "scale";
export type MotionPrimitive = "opacity" | "translateX" | "translateY" | "scale" | "clipReveal" | "underline" | "highlight" | "glow" | "stroke" | "staggerWords" | "staggerCharacters" | "wordPop" | "counter" | "backgroundPanel" | "accentBar";
export type EasingId = "linear" | "easeIn" | "easeOut" | "easeInOut" | "easeInOutCubic" | "springSoft" | "springMedium" | "springPunch";

export interface ParameterDefinition { id: string; label: string; type: ParameterType; default: string | number | boolean; min?: number; max?: number; step?: number; options?: string[]; required?: boolean; group?: string }
export interface TemplateLayer { layerId: string; type: "text" | "shape"; role: string; parameterId?: string; editable: boolean; locked: boolean }
export interface ResponsiveLayout { positionX?: number; positionY?: number; fontScale?: number; maxWidth?: number; panelWidth?: number; alignment?: "left" | "center" | "right"; lineBreak?: "auto" | "preserve" }
export interface TemplateManifest {
  schemaVersion: 1;
  rendererVersion: string;
  templateId: string;
  templateVersion: string;
  legacyPresetId: string;
  kind: TemplateKind;
  name: string;
  description: string;
  category: string;
  tags: string[];
  author: string;
  license: string;
  provenance: string;
  supportedAspectRatios: string[];
  durationMs: { default: number; minimum: number; maximum: number };
  parameters: ParameterDefinition[];
  layers: TemplateLayer[];
  recipe: MotionPrimitive[];
  animationIn: { durationMs: number; easing: EasingId };
  animationOut: { durationMs: number; easing: EasingId };
  responsiveVariants: Partial<Record<TemplateVariant, ResponsiveLayout>>;
  safeArea: Record<TemplateVariant, number>;
  fontRefs: string[];
  assetRefs: string[];
  graphicLayer?: { assetId: string; positionX: number; positionY: number; width: number };
  recommendedProfiles: string[];
  intensity: TemplateIntensity;
  preview: { text: string; secondaryText: string };
}

export const FONT_REGISTRY = {
  inter: { cssFamily: "Inter", legacyName: "Inter", resourceId: "visual-13d/fonts/Inter.ttf" },
  "instrument-serif": { cssFamily: "Instrument Serif", legacyName: "Instrument Serif", resourceId: "visual-13d/fonts/InstrumentSerif-Italic.ttf" },
} as const;

const PRIMITIVES = new Set<MotionPrimitive>(["opacity","translateX","translateY","scale","clipReveal","underline","highlight","glow","stroke","staggerWords","staggerCharacters","wordPop","counter","backgroundPanel","accentBar"]);
const PARAMETER_TYPES = new Set<ParameterType>(["text","multilineText","number","percentage","color","boolean","enum","font","fontWeight","position","scale"]);
const VARIANTS = new Set<TemplateVariant>(["landscape","portrait","square","classic","ultrawide"]);
const RATIOS = new Set(["16:9","9:16","1:1","4:3","21:9"]);
const KINDS = new Set<TemplateKind>(["title","lower-third","stat","callout","tutorial-step","quote"]);
const INTENSITIES = new Set<TemplateIntensity>(["subtle","normal","strong"]);
const EASINGS = new Set<EasingId>(["linear","easeIn","easeOut","easeInOut","easeInOutCubic","springSoft","springMedium","springPunch"]);
const SAFE_ID = /^[a-z0-9][a-z0-9.-]*$/;
const PARAMETER_ID = /^[a-z][a-zA-Z0-9]*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const PACK_RESOURCE_ID = /^pack:[a-z][a-z0-9.-]{5,119}@(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*):(fonts\/[a-zA-Z0-9._-]+\.(?:ttf|otf)|assets\/(?:images|overlays|other)\/[a-zA-Z0-9._-]+\.(?:png|jpg|jpeg|webp|gif)|previews\/[a-zA-Z0-9._-]+\.(?:png|jpg|jpeg|webp|gif))$/;
export const isPackResourceId = (id: string, prefix?: "fonts/" | "assets/" | "previews/") => PACK_RESOURCE_ID.test(id) && (!prefix || id.split(":").at(-1)?.startsWith(prefix) === true);
const DEFAULT_ANIMATION_IN = { durationMs: 500, easing: "easeOut" as const };
const DEFAULT_ANIMATION_OUT = { durationMs: 350, easing: "linear" as const };

type Catalog = typeof catalogJson;
type RawManifest = Catalog["templates"][number] & { parameters?: ParameterDefinition[]; animationIn?: TemplateManifest["animationIn"]; animationOut?: TemplateManifest["animationOut"]; assetRefs?: string[]; graphicLayer?: TemplateManifest["graphicLayer"] };

function expandManifest(raw: RawManifest, catalog: Catalog): TemplateManifest {
  const mergedParameters = [...catalog.parameters as ParameterDefinition[]];
  for (const override of raw.parameters ?? []) {
    const index = mergedParameters.findIndex(item => item.id === override.id);
    if (index >= 0) mergedParameters[index] = { ...mergedParameters[index], ...override };
    else mergedParameters.push(override);
  }
  return {
    schemaVersion: 1,
    rendererVersion: catalog.rendererVersion,
    templateId: raw.templateId,
    templateVersion: raw.templateVersion,
    legacyPresetId: raw.legacyPresetId,
    kind: raw.kind as TemplateKind,
    name: raw.name,
    description: raw.description,
    category: raw.category,
    tags: raw.tags,
    author: catalog.author,
    license: catalog.license,
    provenance: catalog.provenance,
    supportedAspectRatios: catalog.supportedAspectRatios,
    durationMs: catalog.durationMs,
    parameters: mergedParameters,
    layers: raw.layers as TemplateLayer[],
    recipe: raw.recipe as MotionPrimitive[],
    animationIn: raw.animationIn ?? DEFAULT_ANIMATION_IN,
    animationOut: raw.animationOut ?? DEFAULT_ANIMATION_OUT,
    responsiveVariants: raw.responsiveVariants as TemplateManifest["responsiveVariants"],
    safeArea: catalog.safeArea,
    fontRefs: raw.fontRefs ?? catalog.fontRefs,
    assetRefs: raw.assetRefs ?? catalog.assetRefs,
    graphicLayer: raw.graphicLayer,
    recommendedProfiles: raw.recommendedProfiles,
    intensity: raw.intensity as TemplateIntensity,
    preview: raw.preview,
  };
}

export function validateTemplate(manifest: TemplateManifest): string[] {
  try { return validateTemplateShape(manifest); }
  catch { return ["manifest corrupto"]; }
}

function validateTemplateShape(manifest: TemplateManifest): string[] {
  const errors: string[] = [];
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion inválido");
  if (!SAFE_ID.test(manifest.templateId) || !manifest.templateId.startsWith("cheto.")) errors.push("templateId inválido");
  if (!VERSION.test(manifest.templateVersion)) errors.push("templateVersion inválida");
  if (!KINDS.has(manifest.kind)) errors.push("kind desconocido");
  if (!INTENSITIES.has(manifest.intensity)) errors.push("intensity desconocida");
  if (!manifest.name.trim() || !manifest.category.trim()) errors.push("metadata incompleta");
  if (manifest.durationMs.minimum < 100 || manifest.durationMs.maximum < manifest.durationMs.minimum || manifest.durationMs.default < manifest.durationMs.minimum || manifest.durationMs.default > manifest.durationMs.maximum) errors.push("duración inválida");
  if (!EASINGS.has(manifest.animationIn.easing) || !EASINGS.has(manifest.animationOut.easing)) errors.push("easing desconocido");
  if (manifest.animationIn.durationMs < 0 || manifest.animationOut.durationMs < 0) errors.push("fase inválida");
  if (manifest.supportedAspectRatios.some(ratio => !RATIOS.has(ratio))) errors.push("aspect ratio inválido");
  if (Object.keys(manifest.responsiveVariants).some(variant => !VARIANTS.has(variant as TemplateVariant))) errors.push("variante inválida");
  if (manifest.recipe.some(primitive => !PRIMITIVES.has(primitive))) errors.push("primitive desconocida");
  if (manifest.fontRefs.some(font => !(font in FONT_REGISTRY) && !isPackResourceId(font, "fonts/"))) errors.push("font desconocida");
  if (manifest.assetRefs.some(asset => !isPackResourceId(asset, "assets/"))) errors.push("asset inseguro o inexistente");
  if (manifest.graphicLayer && (!manifest.assetRefs.includes(manifest.graphicLayer.assetId) || [manifest.graphicLayer.positionX, manifest.graphicLayer.positionY, manifest.graphicLayer.width].some(value => !Number.isFinite(value) || value < 0 || value > 1) || manifest.graphicLayer.width < 0.02)) errors.push("capa gráfica inválida");
  const ids = new Set<string>();
  for (const parameter of manifest.parameters) {
    if (!PARAMETER_ID.test(parameter.id) || ids.has(parameter.id)) errors.push(`parámetro duplicado/inválido: ${parameter.id}`);
    ids.add(parameter.id);
    if (!PARAMETER_TYPES.has(parameter.type)) errors.push(`tipo de parámetro inválido: ${parameter.id}`);
    if (typeof parameter.default === "number" && !Number.isFinite(parameter.default)) errors.push(`default no finito: ${parameter.id}`);
    if (parameter.min !== undefined && parameter.max !== undefined && parameter.min > parameter.max) errors.push(`rango inválido: ${parameter.id}`);
    if (parameter.type === "enum" && (!parameter.options?.length || !parameter.options.includes(String(parameter.default)))) errors.push(`enum inválido: ${parameter.id}`);
  }
  const layerIds = new Set<string>();
  for (const layer of manifest.layers) {
    if (!PARAMETER_ID.test(layer.layerId) || layerIds.has(layer.layerId)) errors.push(`layer ID duplicado/inválido: ${layer.layerId}`);
    layerIds.add(layer.layerId);
    if (layer.type !== "text" && layer.type !== "shape") errors.push(`layer tipo inválido: ${layer.layerId}`);
    if (layer.type === "text" && (!layer.parameterId || !ids.has(layer.parameterId))) errors.push(`layer parámetro inválido: ${layer.layerId}`);
    if (layer.type === "shape" && layer.editable) errors.push(`layer decorativo editable: ${layer.layerId}`);
  }
  for (const variant of Object.values(manifest.responsiveVariants)) {
    if (!variant) continue;
    for (const value of [variant.positionX, variant.positionY, variant.fontScale, variant.maxWidth, variant.panelWidth]) if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 3)) errors.push("layout inválido");
  }
  return errors;
}

export class TemplateRegistry {
  private readonly byIdentity = new Map<string, TemplateManifest>();
  private readonly byLegacy = new Map<string, TemplateManifest>();
  private readonly packIdentities = new Set<string>();
  private readonly packFonts = new Set<string>();
  readonly errors: string[] = [];

  constructor(manifests: TemplateManifest[]) {
    for (const manifest of manifests) {
      const identity = `${manifest?.templateId ?? "unknown"}@${manifest?.templateVersion ?? "unknown"}`;
      const problems = validateTemplate(manifest);
      if (this.byIdentity.has(identity)) problems.push("ID/versión duplicados");
      if (this.byLegacy.has(manifest.legacyPresetId)) problems.push("preset legacy duplicado");
      if (problems.length) { this.errors.push(`${identity}: ${problems.join(", ")}`); continue; }
      this.byIdentity.set(identity, manifest);
      this.byLegacy.set(manifest.legacyPresetId, manifest);
    }
  }

  getTemplate(templateId: string, version: string): TemplateManifest | null { return this.byIdentity.get(`${templateId}@${version}`) ?? null; }
  getLegacy(presetId: string): TemplateManifest | null { return this.byLegacy.get(presetId) ?? null; }
  listPackFonts(): string[] { return [...this.packFonts]; }
  replacePackTemplates(manifests: TemplateManifest[]): string[] {
    const problems: string[] = [];
    const next = new Map<string, TemplateManifest>();
    for (const manifest of manifests) {
      const key = `${manifest.templateId}@${manifest.templateVersion}`;
      const errors = validateTemplate(manifest);
      if (!manifest.templateId.startsWith("cheto.pack.")) errors.push("identidad de paquete inválida");
      if (this.byIdentity.has(key) && !this.packIdentities.has(key)) errors.push("colisión con plantilla built-in");
      if (next.has(key)) errors.push("template duplicado entre paquetes");
      if (errors.length) { problems.push(`${key}: ${errors.join(", ")}`); continue; }
      next.set(key, manifest);
    }
    if (problems.length) return problems;
    for (const key of this.packIdentities) this.byIdentity.delete(key);
    this.packIdentities.clear();
    this.packFonts.clear();
    for (const [key, manifest] of next) { this.byIdentity.set(key, manifest); this.packIdentities.add(key); }
    for (const manifest of next.values()) for (const font of manifest.fontRefs) if (isPackResourceId(font, "fonts/")) this.packFonts.add(font);
    return [];
  }
  listTemplates(filter: { kind?: TemplateKind; category?: string; tags?: string[]; recommendedProfile?: string; intensity?: TemplateIntensity; aspectRatio?: string; search?: string } = {}): TemplateManifest[] {
    const query = filter.search?.trim().toLocaleLowerCase() ?? "";
    return [...this.byIdentity.values()].filter(item =>
      (!filter.kind || item.kind === filter.kind) && (!filter.category || item.category === filter.category) &&
      (!filter.tags?.length || filter.tags.every(tag => item.tags.includes(tag))) &&
      (!filter.recommendedProfile || item.recommendedProfiles.includes(filter.recommendedProfile)) &&
      (!filter.intensity || item.intensity === filter.intensity) &&
      (!filter.aspectRatio || item.supportedAspectRatios.includes(filter.aspectRatio)) &&
      (!query || [item.name,item.category,item.description,...item.tags].some(value => value.toLocaleLowerCase().includes(query)))
    );
  }
}

export const BUILTIN_MANIFESTS: TemplateManifest[] = catalogJson.templates.map(raw => expandManifest(raw as RawManifest, catalogJson));
export const TEMPLATE_REGISTRY = new TemplateRegistry(BUILTIN_MANIFESTS);
export const TEMPLATE_RENDERER_VERSION = catalogJson.rendererVersion;
