import { describe, expect, it } from "vitest";
import { createTitle } from "../visual/titles";
import { resolveManifest, resolveTemplateInstance } from "../templates/engine";
import { BUILTIN_MANIFESTS, TemplateRegistry } from "../templates/registry";
import { packageTemplate, validPackId, validPackVersion } from "./service";

describe("local template packs", () => {
  it("preserves a template's version and rendering contract while giving it a pack identity", () => {
    const builtin = BUILTIN_MANIFESTS.find(item => item.legacyPresetId === "editorial-master")!;
    const packed = packageTemplate(builtin, "com.cheto.qa");
    expect(packed.templateId).toBe("cheto.pack.com.cheto.qa.editorial-master");
    expect(packed.templateVersion).toBe(builtin.templateVersion);
    expect(packed.recipe).toEqual(builtin.recipe);
    const registry = new TemplateRegistry(BUILTIN_MANIFESTS);
    expect(registry.replacePackTemplates([packed])).toEqual([]);
    expect(registry.getTemplate(packed.templateId, packed.templateVersion)).toEqual(packed);
    const title = { ...createTitle("editorial-master", 0, 5_000_000), templateId: packed.templateId, templateVersion: packed.templateVersion, templateSnapshot: packed };
    expect(resolveManifest(title).manifest?.templateId).toBe(packed.templateId);
    for (const ratio of [16 / 9, 9 / 16, 1]) expect(resolveTemplateInstance(title, ratio, 1_000_000)?.layout.fontScale).toBeGreaterThan(0);
    expect(registry.replacePackTemplates([])).toEqual([]);
    expect(registry.getTemplate(packed.templateId, packed.templateVersion)).toBeNull();
    expect(resolveManifest(title).fallbackUsed).toBe(true);
  });

  it("rejects invalid identities and does not replace the gallery on a bad refresh", () => {
    expect(validPackId("../evil")).toBe(false);
    expect(validPackVersion("01.2.3")).toBe(false);
    const registry = new TemplateRegistry(BUILTIN_MANIFESTS);
    const packed = packageTemplate(BUILTIN_MANIFESTS[0], "com.cheto.qa");
    expect(registry.replacePackTemplates([packed])).toEqual([]);
    expect(registry.replacePackTemplates([{ ...packed, recipe:["runShell" as never] }])).not.toEqual([]);
    expect(registry.getTemplate(packed.templateId, packed.templateVersion)).toEqual(packed);
    expect(registry.listTemplates()).toHaveLength(BUILTIN_MANIFESTS.length + 1);
  });

  it("rewrites external resource identities when repackaging a template", () => {
    const builtin = BUILTIN_MANIFESTS[0];
    const source = { ...builtin, fontRefs: ["pack:com.old.pack@1.0.0:fonts/Local.ttf"], assetRefs: ["pack:com.old.pack@1.0.0:assets/images/frame.png"], graphicLayer: { assetId: "pack:com.old.pack@1.0.0:assets/images/frame.png", positionX: .5, positionY: .5, width: .4 } };
    const packed = packageTemplate(source, "com.new.pack", "2.0.0");
    expect(packed.fontRefs[0]).toBe("pack:com.new.pack@2.0.0:fonts/Local.ttf");
    expect(packed.graphicLayer?.assetId).toBe("pack:com.new.pack@2.0.0:assets/images/frame.png");
  });
});
