import type { TitleDecision, TitlePresetId } from "../project/contracts";
import { attachTemplateIdentity, resolveTemplateInstance } from "../templates/engine";
import { TEMPLATE_REGISTRY } from "../templates/registry";

export type TitleCategory = "Editorial" | "Kinetic" | "Tech" | "Gaming" | "Corporate" | "Tutorial" | "Stats" | "Lower Third" | "Callout / Quote";
export interface TitlePreset { id: TitlePresetId; name: string; category: TitleCategory; mechanism: string; recommendedProfiles: string[]; recommendedAspectRatios: string[]; recommendedTransitions: string[]; intensity: "subtle" | "balanced" | "strong"; }
export const TITLE_PRESETS: TitlePreset[] = [
  { id:"editorial-master", name:"Editorial Master", category:"Editorial", mechanism:"serif italic + sans, rise and stagger", recommendedProfiles:["presentation","conversation"], recommendedAspectRatios:["16:9","9:16","1:1"], recommendedTransitions:["none","cross-dissolve"], intensity:"balanced" },
  { id:"future-glow", name:"Future Glow", category:"Tech", mechanism:"glow, scale and halo", recommendedProfiles:["technology","tutorial"], recommendedAspectRatios:["16:9","9:16"], recommendedTransitions:["none","zoom"], intensity:"balanced" },
  { id:"content-create", name:"Content Create", category:"Editorial", mechanism:"two-level stacked slide", recommendedProfiles:["tutorial","presentation"], recommendedAspectRatios:["16:9","9:16","1:1"], recommendedTransitions:["none"], intensity:"balanced" },
  { id:"neon-statement", name:"Neon Statement", category:"Tech", mechanism:"outline and controlled glow", recommendedProfiles:["technology","gameplay"], recommendedAspectRatios:["16:9","9:16"], recommendedTransitions:["none","fade-black"], intensity:"strong" },
  { id:"kinetic-pop", name:"Kinetic Pop", category:"Kinetic", mechanism:"word pop and scale spring", recommendedProfiles:["gameplay","tutorial"], recommendedAspectRatios:["16:9","9:16","1:1"], recommendedTransitions:["none"], intensity:"strong" },
  { id:"letter-cascade-pro", name:"Letter Cascade Pro", category:"Kinetic", mechanism:"character stagger and slide", recommendedProfiles:["presentation","tutorial"], recommendedAspectRatios:["16:9","9:16"], recommendedTransitions:["none"], intensity:"balanced" },
  { id:"dynamic-slide", name:"Dynamic Slide", category:"Kinetic", mechanism:"directional slide with trail", recommendedProfiles:["tutorial","gameplay"], recommendedAspectRatios:["16:9","9:16"], recommendedTransitions:["none","push"], intensity:"balanced" },
  { id:"typewriter-tech", name:"Typewriter Tech", category:"Tech", mechanism:"deterministic character reveal and cursor", recommendedProfiles:["tutorial","technology"], recommendedAspectRatios:["16:9","9:16","1:1"], recommendedTransitions:["none"], intensity:"subtle" },
  { id:"word-highlight", name:"Word Highlight", category:"Tutorial", mechanism:"sequential accent blocks", recommendedProfiles:["tutorial","presentation"], recommendedAspectRatios:["16:9","9:16","1:1"], recommendedTransitions:["none"], intensity:"balanced" },
  { id:"split-impact", name:"Split Impact", category:"Kinetic", mechanism:"opposing text blocks", recommendedProfiles:["gameplay","technology"], recommendedAspectRatios:["16:9","9:16"], recommendedTransitions:["none","fade-black"], intensity:"strong" },
  { id:"stacked-reveal-pro", name:"Stacked Reveal Pro", category:"Editorial", mechanism:"staggered eyebrow, headline and support", recommendedProfiles:["presentation","tutorial"], recommendedAspectRatios:["16:9","9:16","1:1"], recommendedTransitions:["none"], intensity:"balanced" },
  { id:"underline-editorial", name:"Underline Editorial", category:"Editorial", mechanism:"animated underline sweep", recommendedProfiles:["presentation","conversation"], recommendedAspectRatios:["16:9","9:16","1:1"], recommendedTransitions:["none","cross-dissolve"], intensity:"subtle" },
  { id:"lower-third-premium", name:"Lower Third Premium", category:"Lower Third", mechanism:"accent bar and translucent name panel", recommendedProfiles:["conversation","presentation"], recommendedAspectRatios:["16:9","9:16","1:1"], recommendedTransitions:["none"], intensity:"subtle" },
  { id:"stat-hero", name:"Stat Hero", category:"Stats", mechanism:"hero number and label reveal", recommendedProfiles:["tutorial","presentation"], recommendedAspectRatios:["16:9","9:16","1:1"], recommendedTransitions:["none"], intensity:"balanced" },
  { id:"tutorial-step", name:"Tutorial Step", category:"Tutorial", mechanism:"step badge, rail and instruction", recommendedProfiles:["tutorial"], recommendedAspectRatios:["16:9","9:16","1:1"], recommendedTransitions:["none"], intensity:"subtle" },
  { id:"quote-editorial", name:"Quote Editorial", category:"Callout / Quote", mechanism:"serif quotation and attribution", recommendedProfiles:["conversation","presentation"], recommendedAspectRatios:["16:9","9:16","1:1"], recommendedTransitions:["none","cross-dissolve"], intensity:"subtle" },
  { id:"gaming-impact", name:"Gaming Impact", category:"Gaming", mechanism:"scale impact and restrained glow", recommendedProfiles:["gameplay"], recommendedAspectRatios:["16:9","9:16"], recommendedTransitions:["none","zoom"], intensity:"strong" },
  { id:"corporate-clean", name:"Corporate Clean", category:"Corporate", mechanism:"clean typography and thin rail", recommendedProfiles:["presentation","software"], recommendedAspectRatios:["16:9","9:16","1:1"], recommendedTransitions:["none","cross-dissolve"], intensity:"subtle" },
];

let fallbackInstanceSequence = 0;
export function createTitle(presetId: TitlePresetId, atUs: number, durationUs: number): TitleDecision {
  const startUs = Math.max(0, Math.min(Math.round(atUs), Math.max(0, durationUs - 1)));
  const lower = presetId === "lower-third" || presetId === "lower-third-premium";
  const stat = presetId === "zoom-out-stat" || presetId === "stat-hero";
  const tutorial = presetId === "tutorial-step";
  const quote = presetId === "quote-editorial";
  const manifest = TEMPLATE_REGISTRY.getLegacy(presetId);
  return attachTemplateIdentity({
    id: globalThis.crypto?.randomUUID?.() ?? `title-${startUs}-${++fallbackInstanceSequence}`,
    presetId,
    text: stat ? "85%" : lower ? "NOMBRE" : tutorial ? "CONFIGURAR JWT" : quote ? "Una idea cambia todo" : presetId === "editorial-master" ? "CONTENT CREATE" : "Escribe tu título",
    secondaryText: stat ? "COMPLETADO" : lower ? "Rol / descripción" : tutorial ? "PASO 01" : quote ? "— Autor" : presetId === "editorial-master" ? "those who master" : presetId === "future-glow" ? "THE NEXT" : presetId === "content-create" ? "CONTENT" : presetId === "stacked-reveal-pro" ? "CHETO · EDITORIAL" : presetId === "corporate-clean" ? "INSIGHT" : presetId === "split-impact" ? "CREATIVE" : "",
    startUs,
    endUs: Math.min(durationUs, startUs + (manifest?.durationMs.default ?? 4000) * 1000),
    positionX: lower ? 0.08 : 0.5,
    positionY: lower ? 0.82 : tutorial ? 0.24 : 0.5,
    anchor: lower ? "left" : "center",
    scale: 1,
    font: quote ? "Instrument Serif" : "Inter",
    fontWeight: quote ? 400 : 700,
    fontSize: stat ? 112 : lower ? 54 : tutorial ? 56 : 72,
    color: "#FFFFFF",
    accentColor: presetId === "gaming-impact" ? "#FF6B35" : presetId === "neon-statement" ? "#8D6BFF" : "#34D5E5",
    alignment: lower ? "left" : "center",
    tracking: 0,
    lineHeight: 1.15,
    opacity: 1,
    safeArea: 0.06,
    animationInUs: 500_000,
    animationOutUs: 350_000,
    easing: "ease-out",
    background: presetId === "callout",
  });
}

export function titleFrame(title: TitleDecision, sourceUs: number) {
  if (sourceUs < title.startUs || sourceUs >= title.endUs) return null;
  if (title.templateId) {
    const resolved = resolveTemplateInstance(title, 16 / 9, sourceUs);
    if (!resolved) return null;
    return {
      opacity: resolved.motion.opacity,
      secondaryOpacity: resolved.motion.secondaryOpacity,
      translateY: resolved.motion.translateY,
      translateX: resolved.motion.translateX,
      scale: resolved.motion.scale,
      lineProgress: resolved.motion.lineProgress,
      maskProgress: resolved.motion.maskProgress,
      revealedCharacters: resolved.motion.revealedCharacters,
    };
  }
  const localUs = sourceUs - title.startUs;
  const remainingUs = title.endUs - sourceUs;
  const enter = title.animationInUs ? Math.min(1, localUs / title.animationInUs) : 1;
  const leave = title.animationOutUs ? Math.min(1, remainingUs / title.animationOutUs) : 1;
  const ease = (value: number) => title.easing === "ease-out" ? 1 - (1 - value) ** 3 : value;
  const progress = ease(enter);
  const visible = Math.min(enter, leave) * title.opacity;
  const rise = ["rise-settle","mask-wipe-up","stack-reveal","editorial-master","content-create","stacked-reveal-pro","corporate-clean"].includes(title.presetId);
  const slide = ["lower-third","lower-third-premium","dynamic-slide","split-impact","tutorial-step"].includes(title.presetId);
  const pop = ["zoom-out-stat","stat-hero","kinetic-pop","gaming-impact","future-glow"].includes(title.presetId);
  const underline = ["underline-sweep","underline-editorial","split-line","callout","lower-third","lower-third-premium","corporate-clean"].includes(title.presetId);
  return {
    opacity: visible,
    secondaryOpacity: Math.min(1, Math.max(0, (localUs - 180_000) / Math.max(1, title.animationInUs))) * leave * title.opacity,
    translateY: rise ? (1 - progress) * 30 : 0,
    translateX: slide ? (1 - progress) * (title.anchor === "right" ? 52 : -52) : 0,
    scale: pop ? 1 + (1 - progress) * (title.presetId === "gaming-impact" ? 0.42 : 0.24) : 1,
    lineProgress: underline ? progress : 0,
    maskProgress: ["mask-wipe-up","word-highlight","stacked-reveal-pro"].includes(title.presetId) ? progress : 1,
    revealedCharacters: Math.min([...title.text].length, Math.max(0, Math.ceil([...title.text].length * progress))),
  };
}

export function clampTitleToSafeArea(title: TitleDecision) {
  const margin = Math.max(0.02, Math.min(0.2, title.safeArea));
  return { ...title, positionX: Math.max(margin, Math.min(1 - margin, title.positionX)), positionY: Math.max(margin, Math.min(1 - margin, title.positionY)) };
}

export function titlePositionForAspect(title: TitleDecision, aspectRatio: number) {
  if (title.templateId) {
    const resolved = resolveTemplateInstance(title, aspectRatio, title.startUs);
    if (resolved) return { x: resolved.layout.x, y: resolved.layout.y };
  }
  const vertical = aspectRatio < 0.8;
  const xMargin = vertical ? Math.max(0.1, title.safeArea) : Math.max(0.06, title.safeArea);
  const yMargin = vertical ? Math.max(0.14, title.safeArea) : Math.max(0.06, title.safeArea);
  return {
    x: Math.max(xMargin, Math.min(1 - xMargin, title.positionX)),
    y: Math.max(yMargin, Math.min(1 - yMargin, title.positionY)),
  };
}
