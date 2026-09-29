import { describe, expect, it } from "vitest";
import { createTitle } from "../visual/titles";
import { editTemplateParameter, hydrateTemplateInstance, migrateLegacyTitle, normalizeParameter, normalizeTemplateInstance, resolveManifest, resolveTemplateInstance, seededGlitch, swapTemplate, variantForAspect } from "./engine";
import { BUILTIN_MANIFESTS, TEMPLATE_REGISTRY, TemplateRegistry, validateTemplate } from "./registry";

describe("template registry", () => {
  it("loads the 18 approved families with stable identities and safe recipes", () => {
    expect(TEMPLATE_REGISTRY.errors).toEqual([]);
    expect(TEMPLATE_REGISTRY.listTemplates()).toHaveLength(18);
    expect(new Set(BUILTIN_MANIFESTS.map(item => item.templateId)).size).toBe(18);
    expect(BUILTIN_MANIFESTS.every(item => validateTemplate(item).length === 0)).toBe(true);
  });

  it("rejects an unknown primitive and duplicate identity", () => {
    const valid = BUILTIN_MANIFESTS[0];
    expect(validateTemplate({ ...valid, recipe: ["arbitraryScript" as never] })).toContain("primitive desconocida");
    expect(validateTemplate({ ...valid, fontRefs: ["missing-font"] })).toContain("font desconocida");
    expect(validateTemplate({ templateId: "cheto.broken", templateVersion: "1.0.0" } as never)).toContain("manifest corrupto");
    expect(validateTemplate({ ...valid, parameters: [...valid.parameters, valid.parameters[0]] }).some(error => error.includes("duplicado"))).toBe(true);
    expect(new TemplateRegistry([valid, valid]).errors[0]).toContain("duplicados");
  });
});

describe("template instances", () => {
  const base = createTitle("lower-third-premium", 1_000_000, 10_000_000);
  it("migrates a legacy title in memory while preserving content and identity", () => {
    const legacy = { ...base };
    delete legacy.templateId;
    delete legacy.templateVersion;
    delete legacy.templateSnapshot;
    delete legacy.parameters;
    delete legacy.instanceId;
    const migrated = migrateLegacyTitle(legacy);
    expect(migrated.id).toBe(base.id);
    expect(migrated.text).toBe(base.text);
    expect(migrated.templateId).toBe("cheto.lower-third-premium");
  });

  it("uses a snapshot only when its exact version is unavailable", () => {
    const future = { ...base, templateVersion: "9.0.0", templateSnapshot: { ...base.templateSnapshot!, templateVersion: "9.0.0" } };
    expect(resolveManifest(future).fallbackUsed).toBe(true);
    expect(resolveManifest({ ...future, templateSnapshot: undefined }).error).toContain("TEMPLATE_VERSION_MISSING");
    expect(resolveManifest({ ...future, templateSnapshot: { templateId: future.templateId, templateVersion: future.templateVersion } as never }).error).toContain("TEMPLATE_VERSION_MISSING");
  });

  it("applies portrait safe area and explicit position overrides", () => {
    const portrait = resolveTemplateInstance(base, 9 / 16, 1_600_000)!;
    expect(portrait.variant).toBe("portrait");
    expect(portrait.layout.x).toBe(0.14);
    expect(portrait.layout.y).toBe(0.79);
    const changed = editTemplateParameter(base, "positionY", 0.65);
    expect(resolveTemplateInstance(changed, 9 / 16, 1_600_000)?.layout.y).toBe(0.65);
  });

  it("swaps family without losing text, accent, timing or instance ID", () => {
    const edited = editTemplateParameter(base, "text", "José en Perú");
    const result = swapTemplate(edited, "cheto.corporate-clean", "1.0.0", createTitle)!;
    expect(result.text).toBe("José en Perú");
    expect(result.id).toBe(base.id);
    expect(result.startUs).toBe(base.startUs);
    expect(result.endUs).toBe(base.endUs);
    expect(result.accentColor).toBe(base.accentColor);
  });

  it("maps all five ratios and keeps seeded animation deterministic", () => {
    expect([16 / 9, 9 / 16, 1, 4 / 3, 21 / 9].map(variantForAspect)).toEqual(["landscape", "portrait", "square", "classic", "ultrawide"]);
    expect(seededGlitch("cheto.gaming-impact", "instance", 14)).toBe(seededGlitch("cheto.gaming-impact", "instance", 14));
  });

  it("resolves representative families across three canvas shapes", () => {
    for (const preset of ["editorial-master","future-glow","lower-third-premium","stat-hero","tutorial-step","corporate-clean"] as const) {
      const title = createTitle(preset, 0, 5_000_000);
      for (const ratio of [16 / 9, 9 / 16, 1]) {
        const state = resolveTemplateInstance(title, ratio, 1_000_000)!;
        expect(state.layout.x).toBeGreaterThanOrEqual(state.layout.safeArea);
        expect(state.layout.y).toBeLessThanOrEqual(1 - state.layout.safeArea);
        expect(state.layout.fontScale).toBeGreaterThan(0);
      }
    }
  });

  it("has deterministic in, hold and out phases and safe values", () => {
    const title = createTitle("future-glow", 1_000_000, 8_000_000);
    const times = [title.startUs, title.startUs + 250_000, title.startUs + 1_000_000, title.endUs - 150_000, title.endUs];
    expect(times.map(time => resolveTemplateInstance(title, 16 / 9, time)?.phase)).toEqual(["in", "in", "hold", "out", "after"]);
    expect(resolveTemplateInstance(title, 16 / 9, title.startUs + 250_000)).toEqual(resolveTemplateInstance(title, 16 / 9, title.startUs + 250_000));
    const size = TEMPLATE_REGISTRY.getLegacy("future-glow")!.parameters.find(item => item.id === "fontSize")!;
    expect(normalizeParameter(size, Number.POSITIVE_INFINITY)).toBe(72);
    expect(normalizeParameter(size, -20)).toBe(18);
  });

  it("bounds corrupt instance timing and parameter values before saving", () => {
    const corrupt = { ...base, endUs: base.startUs, animationInUs: Number.POSITIVE_INFINITY, fontSize: -20, accentColor: "broken", parameters: { fontSize: -20, accentColor: "broken" } };
    const safe = normalizeTemplateInstance(corrupt, 10_000_000);
    expect(safe.endUs).toBeGreaterThan(safe.startUs);
    expect(safe.animationInUs).toBeLessThanOrEqual((safe.endUs - safe.startUs) / 2);
    expect(safe.fontSize).toBe(18);
    expect(safe.accentColor).toBe("#34D5E5");
  });

  it("hydrates persisted parameter overrides before timeline edits", () => {
    const loaded = hydrateTemplateInstance({ ...base, positionY: 0.82, parameters: { positionY: 0.6 } });
    expect(loaded.positionY).toBe(0.6);
    expect(normalizeTemplateInstance({ ...loaded, positionY: 0.7 }, 10_000_000).parameters?.positionY).toBe(0.7);
  });
});
