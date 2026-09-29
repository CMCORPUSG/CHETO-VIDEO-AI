import type { ProjectBundle } from "./contracts";

export interface ProjectContext {
  status: "loading" | "ready" | "error";
  canonicalProjectId: string;
  routeProjectId: string;
  manifestProjectId: string | null;
  edlProjectId: string | null;
  sourceProjectId: string | null;
  sourceId: string | null;
  sourcePath: string | null;
  proxyPath: string | null;
  edlRevision: string | null;
}

export function resolveProjectContext(routeProjectId: string, bundle: ProjectBundle | null, loading: boolean): ProjectContext {
  const base = {
    canonicalProjectId: bundle?.project.projectId ?? routeProjectId,
    routeProjectId,
    manifestProjectId: bundle?.project.projectId ?? null,
    edlProjectId: bundle?.edl.projectId ?? null,
    sourceProjectId: bundle && bundle.project.source.sourceId === bundle.source.sourceId ? bundle.project.projectId : null,
    sourceId: bundle?.source.sourceId ?? null,
    sourcePath: bundle?.source.path ?? null,
    proxyPath: null,
    edlRevision: bundle?.edl.updatedAt ?? null,
  };
  return { ...base, status: loading || !bundle ? "loading" : bundleMatchesProject(routeProjectId, bundle) ? "ready" : "error" };
}

export function projectContextDiagnostic(context: ProjectContext): string {
  return `routeProjectId=${context.routeProjectId} canonicalProjectId=${context.canonicalProjectId} manifestProjectId=${context.manifestProjectId ?? "missing"} edlProjectId=${context.edlProjectId ?? "missing"} sourceProjectId=${context.sourceProjectId ?? "missing"}`;
}

export function bundleMatchesProject(projectId: string, bundle: ProjectBundle | null): boolean {
  return Boolean(bundle && bundle.project.projectId === projectId && bundle.edl.projectId === projectId
    && bundle.project.source.sourceId === bundle.source.sourceId && bundle.edl.sourceId === bundle.source.sourceId);
}

export function responseMatchesProject(activeProjectId: string, responseProjectId: string, activeSourceId: string, responseSourceId: string): boolean {
  return activeProjectId === responseProjectId && activeSourceId === responseSourceId;
}

export function previewMatchesProject(active: { projectId: string; sourceId: string; sourcePath: string; edlRevision: string }, response: { projectId: string; sourceId: string; sourcePath: string; edlRevision: string }): boolean {
  return responseMatchesProject(active.projectId, response.projectId, active.sourceId, response.sourceId)
    && active.sourcePath === response.sourcePath && active.edlRevision === response.edlRevision;
}
