import { describe, expect, it } from "vitest";
import type { ProjectBundle } from "./contracts";
import { previewMatchesProject, resolveProjectContext, responseMatchesProject } from "./isolation";

const a = { projectId: "A", sourceId: "source-A", sourcePath: "A.mp4", edlRevision: "r1" };
const b = { projectId: "B", sourceId: "source-B", sourcePath: "B.mp4", edlRevision: "r1" };

describe("project isolation", () => {
  it("distinguishes a UUID-shaped project name from its canonical manifest ID", () => {
    const bundle = {
      project: { projectId: "8528d0fa-df35-4df0-b386-2201d36d808b", name: "01a07e9e-3d89-7733-921b-68477fa4fb39", source: { sourceId: "source-1" } },
      source: { sourceId: "source-1", path: "01a07e9e-3d89-7733-921b-68477fa4fb39.mp4" },
      edl: { projectId: "8528d0fa-df35-4df0-b386-2201d36d808b", sourceId: "source-1", updatedAt: "r1" },
    } as ProjectBundle;
    const context = resolveProjectContext("8528d0fa-df35-4df0-b386-2201d36d808b", bundle, false);
    expect(context.status).toBe("ready");
    expect(context.canonicalProjectId).toBe(bundle.project.projectId);
    expect(context.sourceProjectId).toBe(bundle.project.projectId);
    expect(resolveProjectContext("01a07e9e-3d89-7733-921b-68477fa4fb39", bundle, false).status).toBe("error");
  });
  it("keeps previews scoped through A → B → A → B", () => {
    for (const active of [a, b, a, b]) {
      expect(previewMatchesProject(active, active)).toBe(true);
      expect(previewMatchesProject(active, active.projectId === "A" ? b : a)).toBe(false);
    }
  });

  it("discards A's late render after B becomes active", () => {
    const lateA = { ...a };
    expect(previewMatchesProject(b, lateA)).toBe(false);
    expect(previewMatchesProject(b, b)).toBe(true);
    expect(previewMatchesProject({ ...b, edlRevision: "r2" }, b)).toBe(false);
  });

  it("invalidates a camera chunk as soon as the EDL revision changes", () => {
    const oldChunk = { ...a, edlRevision: "before-camera" };
    const active = { ...a, edlRevision: "after-camera" };
    expect(previewMatchesProject(active, oldChunk)).toBe(false);
    expect(previewMatchesProject(active, { ...oldChunk, edlRevision: "after-camera" })).toBe(true);
  });

  it("never compares Smart Cut or Camera documents from another project", () => {
    expect(responseMatchesProject("B", "A", "source-B", "source-A")).toBe(false);
    expect(responseMatchesProject("B", "B", "source-B", "source-A")).toBe(false);
    expect(responseMatchesProject("B", "B", "source-B", "source-B")).toBe(true);
  });
});
