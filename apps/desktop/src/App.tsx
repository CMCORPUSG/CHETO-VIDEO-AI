import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppShell } from "./components/AppShell";
import { ConfirmDeleteModal } from "./components/ConfirmDeleteModal";
import { NewProjectModal } from "./components/NewProjectModal";
import { RenameProjectModal } from "./components/RenameProjectModal";
import { ToastRegion } from "./components/ToastRegion";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { createId } from "./lib/id";
import { appendDiagnostic, DIAGNOSTIC_SESSION_ID, pruneDiagnostics } from "./lib/diagnosticLog";
import { loadProjects, projectStorageKeys } from "./lib/projectStore";
import { checkVideoSource, detectFfprobe, probeVideo, selectVideoPath } from "./media/service";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { HomePage } from "./pages/HomePage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { replaceBundleSource } from "./project/conversion";
import type { ProjectBundle } from "./project/contracts";
import {
  createProjectBundle,
  ensureProjectBundle,
  initializeProjectStorage,
  isNativeProjectStorage,
  loadProjectBundle,
  projectManifestExists,
  projectStorageErrorMessage,
  saveProjectManifest,
  updateProjectSource,
} from "./project/service";
import type { DiagnosticEvent, LogLevel, MediaDiagnosticState } from "./types/diagnostics";
import type { PageId } from "./types/navigation";
import type { LocalProfile } from "./types/profile";
import type { LocalProject, ProjectDraft } from "./types/project";
import type { ToastMessage, ToastTone } from "./types/toast";

const pageTitles: Record<PageId, string> = {
  home: "Inicio",
  projects: "Proyectos",
  project: "Detalle del proyecto",
  diagnostics: "Diagnóstico",
  settings: "Configuración",
};

const storageKeys = {
  projects: projectStorageKeys.current,
  profile: "cheto-video-ai.profile.v1",
  logs: "cheto-video-ai.diagnostics.v2",
};

function manifestIndex(bundle: ProjectBundle) {
  return {
    edlSchemaVersion: bundle.edl.schemaVersion,
    projectSchemaVersion: bundle.project.schemaVersion,
    sourceId: bundle.source.sourceId,
  };
}

export function App() {
  const [activePage, setActivePage] = useState<PageId>("home");
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<LocalProject | null>(null);
  const [projectToRename, setProjectToRename] = useState<LocalProject | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isRelocating, setIsRelocating] = useState(false);
  const [projectBundles, setProjectBundles] = useState<Record<string, ProjectBundle>>({});
  const [projectStorageErrors, setProjectStorageErrors] = useState<Record<string, string>>({});
  const [projectStorageLoading, setProjectStorageLoading] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [projects, setProjects] = useLocalStorage<LocalProject[]>(storageKeys.projects, loadProjects);
  const [mediaDiagnostics, setMediaDiagnostics] = useState<MediaDiagnosticState>({
    ffprobeAvailable: false,
    ffprobeDetail: "Comprobación pendiente",
    ffprobeVersion: null,
    lastFileName: null,
    lastProbeMs: null,
  });
  const [profile, setProfile] = useLocalStorage<LocalProfile>(storageKeys.profile, () => ({
    name: "Usuario",
    avatar: localStorage.getItem("cheto-video-ai.profile-avatar"),
  }));
  useEffect(() => {
    const theme = profile.theme ?? "dark";
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => { document.documentElement.dataset.theme = theme === "system" ? (query.matches ? "light" : "dark") : theme; };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [profile.theme]);
  const [events, setEvents] = useLocalStorage<DiagnosticEvent[]>(storageKeys.logs, []);
  const hasLoggedStartup = useRef(false);
  const hasCheckedFfprobe = useRef(false);
  const hasInitializedProjectStorage = useRef(false);

  const addLog = useCallback((message: string, level: LogLevel = "info") => {
    const event: DiagnosticEvent = {
      id: createId(),
      level,
      message,
      sessionId: DIAGNOSTIC_SESSION_ID,
      timestamp: new Date().toISOString(),
    };
    setEvents((current) => appendDiagnostic(current, event));
  }, [setEvents]);

  const notify = useCallback((message: string, tone: ToastTone = "success") => {
    setToasts((current) => [...current.slice(-3), { id: createId(), message, tone }]);
    if (tone === "error") addLog(message, "error");
  }, [addLog]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    if (hasLoggedStartup.current) return;
    hasLoggedStartup.current = true;
    localStorage.removeItem("cheto-video-ai.diagnostics.v1");
    const timestamp = new Date().toISOString();
    const startupEvents: DiagnosticEvent[] = [
      { id: createId(), level: "info", message: "Aplicación iniciada.", sessionId: DIAGNOSTIC_SESSION_ID, timestamp },
      { id: createId(), level: "info", message: "Workspace local cargado.", sessionId: DIAGNOSTIC_SESSION_ID, timestamp },
    ];
    setEvents((current) => startupEvents.reduce((acc, event) => appendDiagnostic(acc, event), pruneDiagnostics(current)));
  }, [setEvents]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => addLog(`UI_ERROR: ${event.message}`, "error");
    const onRejection = (event: PromiseRejectionEvent) => addLog(`PROMISE_REJECTION: ${event.reason instanceof Error ? event.reason.message : String(event.reason)}`, "error");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, [addLog]);

  useEffect(() => {
    if (hasCheckedFfprobe.current) return;
    hasCheckedFfprobe.current = true;
    void detectFfprobe().then((status) => {
      setMediaDiagnostics((current) => ({
        ...current,
        ffprobeAvailable: status.available,
        ffprobeDetail: status.detail,
        ffprobeVersion: status.version,
      }));
      addLog(status.available ? `FFprobe detectado: ${status.version ?? "versión no informada"}.` : "FFprobe no disponible.", status.available ? "info" : "warning");
    }).catch(() => {
      setMediaDiagnostics((current) => ({ ...current, ffprobeDetail: "No se pudo completar la detección." }));
      addLog("No se pudo comprobar FFprobe.", "error");
    });
  }, [addLog]);

  useEffect(() => {
    if (hasInitializedProjectStorage.current || !isNativeProjectStorage()) return;
    hasInitializedProjectStorage.current = true;
    void initializeProjectStorage().then(() => {
      addLog("PROJECT_STORAGE_INITIALIZED");
    }).catch((error) => {
      addLog(`PROJECT_STORAGE_ERROR: ${projectStorageErrorMessage(error)}`, "error");
    });
  }, [addLog]);

  const createProject = async (draft: ProjectDraft, probeMs: number) => {
    const project: LocalProject = {
      ...draft,
      id: createId(),
      createdAt: new Date().toISOString(),
      manifest: null,
      schemaVersion: 2,
      status: "ready",
    };
    try {
      const bundle = await createProjectBundle(project);
      const persistedProject = { ...project, manifest: manifestIndex(bundle) };
      setProjects((current) => [persistedProject, ...current]);
      setProjectBundles((current) => ({ ...current, [project.id]: bundle }));
      setSelectedProjectId(project.id);
      setActivePage("project");
      setMediaDiagnostics((current) => ({ ...current, lastFileName: project.source.fileName, lastProbeMs: probeMs }));
      addLog("PROJECT_MANIFEST_CREATED");
      addLog("PROJECT_EDL_CREATED");
      addLog(`Proyecto creado: ${project.name}.`);
      notify("Proyecto creado y guardado");
    } catch (error) {
      const message = projectStorageErrorMessage(error);
      addLog(`PROJECT_STORAGE_ERROR: ${message}`, "error");
      notify(message, "error");
      throw new Error(message, { cause: error });
    }
  };

  const prepareProjectBundle = async (project: LocalProject) => {
    if (!isNativeProjectStorage() || !project.metadata || !project.source.path) return;
    setProjectStorageLoading((current) => ({ ...current, [project.id]: true }));
    setProjectStorageErrors((current) => ({ ...current, [project.id]: "" }));
    try {
      const { bundle, created } = await ensureProjectBundle(project);
      setProjectBundles((current) => ({ ...current, [project.id]: bundle }));
      setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, manifest: manifestIndex(bundle) } : entry));
      addLog(created ? "PROJECT_MANIFEST_CREATED" : "PROJECT_MANIFEST_LOADED");
      addLog(created ? "PROJECT_EDL_CREATED" : "PROJECT_EDL_LOADED");
    } catch (error) {
      const message = projectStorageErrorMessage(error);
      setProjectStorageErrors((current) => ({ ...current, [project.id]: message }));
      addLog(`PROJECT_STORAGE_ERROR: ${message}`, "error");
      notify(message, "error");
    } finally {
      setProjectStorageLoading((current) => ({ ...current, [project.id]: false }));
    }
  };

  const openProject = (project: LocalProject) => {
    setSelectedProjectId(project.id);
    setActivePage("project");
    addLog(`Proyecto abierto: ${project.name} · projectId=${project.id}.`);
    void prepareProjectBundle(project);
    if (!project.source.path) return;
    void checkVideoSource(project.source.path, project.source.sizeBytes, project.source.lastModifiedMs).then((check) => {
      const status = !check.exists ? "source-missing" : check.changed ? "source-changed" : "ready";
      setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, status } : entry));
      if (!check.exists) addLog(`Archivo fuente no encontrado: ${project.source.fileName}.`, "warning");
      else if (check.changed) addLog(`El archivo fuente podría haber cambiado: ${project.source.fileName}.`, "warning");
    }).catch(() => addLog(`No se pudo verificar la fuente: ${project.source.fileName}.`, "warning"));
  };

  const relocateProject = async (project: LocalProject) => {
    setIsRelocating(true);
    try {
      const path = await selectVideoPath();
      if (!path) return;
      addLog(`Reubicando fuente de ${project.name}.`);
      const result = await probeVideo(path);
      const updatedProject: LocalProject = {
        ...project,
        metadata: result.metadata,
        source: {
          fileName: result.metadata.fileName,
          lastModifiedMs: result.metadata.lastModifiedMs,
          path: result.metadata.path,
          sizeBytes: result.metadata.sizeBytes,
        },
        status: "ready",
      };
      let bundle: ProjectBundle;
      if (await projectManifestExists(project.id)) {
        const existing = projectBundles[project.id] ?? await loadProjectBundle(project.id);
        bundle = await updateProjectSource(replaceBundleSource(existing, updatedProject));
        addLog("PROJECT_EDL_SAVED");
      } else {
        bundle = await createProjectBundle(updatedProject);
        addLog("PROJECT_MANIFEST_CREATED");
        addLog("PROJECT_EDL_CREATED");
      }
      const persistedProject = { ...updatedProject, manifest: manifestIndex(bundle) };
      setProjects((current) => current.map((entry) => entry.id === project.id ? persistedProject : entry));
      setProjectBundles((current) => ({ ...current, [project.id]: bundle }));
      setMediaDiagnostics((current) => ({ ...current, lastFileName: result.metadata.fileName, lastProbeMs: result.elapsedMs }));
      addLog(`Metadata completada en ${(result.elapsedMs / 1_000).toFixed(2)} s.`);
      notify("Fuente localizada y validada");
    } catch (error) {
      const message = projectStorageErrorMessage(error);
      addLog(`PROJECT_STORAGE_ERROR: ${message}`, "error");
      notify(message, "error");
    } finally {
      setIsRelocating(false);
    }
  };

  const replaceProjectSource = async (projectId: string, path: string) => {
    const project = projects.find(item => item.id === projectId);
    if (!project) throw new Error("El proyecto ya no está disponible.");
    const result = await probeVideo(path);
    const updated: LocalProject = { ...project, metadata: result.metadata, source: { fileName: result.metadata.fileName, lastModifiedMs: result.metadata.lastModifiedMs, path: result.metadata.path, sizeBytes: result.metadata.sizeBytes }, status: "ready" };
    const previous = projectBundles[projectId] ?? await loadProjectBundle(projectId);
    const replacement = replaceBundleSource(previous, updated);
    replacement.edl = { ...replacement.edl, sourceOnTimeline: false, audioOnTimeline: false, tracks: { cuts: [], camera: [], broll: [], audio: [] } };
    const saved = await updateProjectSource(replacement);
    setProjects(current => current.map(item => item.id === projectId ? { ...updated, manifest: manifestIndex(saved) } : item));
    setProjectBundles(current => ({ ...current, [projectId]: saved }));
    // La fuente cambia, pero la transformación editorial del lienzo pertenece al proyecto.
    // Conservarla evita que un reemplazo convierta una escala válida en el default roto 0.
    window.localStorage.removeItem(`cheto.editor.markers.${projectId}`);
    addLog(`PROJECT_SOURCE_REPLACED ${result.metadata.fileName}`);
  };

  const renameProject = async (name: string) => {
    if (!projectToRename) return;
    const previousName = projectToRename.name;
    try {
      let persistedManifest = projectToRename.manifest;
      if (isNativeProjectStorage() && projectToRename.metadata && projectToRename.source.path) {
        const { bundle, created } = await ensureProjectBundle(projectToRename);
        const manifest = await saveProjectManifest({ ...bundle.project, name, updatedAt: new Date().toISOString() });
        setProjectBundles((current) => ({ ...current, [projectToRename.id]: { ...bundle, project: manifest } }));
        persistedManifest = manifestIndex({ ...bundle, project: manifest });
        addLog(created ? "PROJECT_MANIFEST_CREATED" : "PROJECT_MANIFEST_LOADED");
        addLog(created ? "PROJECT_EDL_CREATED" : "PROJECT_EDL_LOADED");
      }
      setProjects((current) => current.map((project) => project.id === projectToRename.id ? { ...project, name, manifest: persistedManifest } : project));
      setProjectToRename(null);
      addLog(`Proyecto renombrado: ${previousName} → ${name}.`);
      notify("Proyecto renombrado");
    } catch (error) {
      const message = projectStorageErrorMessage(error);
      addLog(`PROJECT_STORAGE_ERROR: ${message}`, "error");
      notify(message, "error");
    }
  };

  const deleteProject = () => {
    if (!projectToDelete) return;
    setProjects((current) => current.filter((project) => project.id !== projectToDelete.id));
    addLog(`Referencia de proyecto eliminada: ${projectToDelete.name}.`);
    setProjectToDelete(null);
    if (selectedProjectId === projectToDelete.id) {
      setSelectedProjectId(null);
      setActivePage("projects");
    }
    notify("Referencia eliminada");
  };

  const updateAvatar = (avatar: string) => {
    setProfile((current) => ({ ...current, avatar }));
    addLog("Avatar local actualizado.");
    notify("Foto actualizada");
  };

  const removeAvatar = () => {
    setProfile((current) => ({ ...current, avatar: null }));
    addLog("Avatar local eliminado.");
    notify("Foto eliminada");
  };

  const updateProfileName = (name: string) => {
    setProfile((current) => ({ ...current, name }));
    addLog("Nombre visible del perfil actualizado.");
    notify("Configuración guardada");
  };

  const sharedProjectProps = {
    onDeleteProject: setProjectToDelete,
    onNewProject: () => setIsNewProjectOpen(true),
    onOpenProject: openProject,
    onRenameProject: setProjectToRename,
    projects,
  };

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  const pageContent: Record<PageId, ReactNode> = {
    home: <HomePage {...sharedProjectProps} mediaDiagnostics={mediaDiagnostics} />,
    projects: <ProjectsPage {...sharedProjectProps} />,
    project: selectedProject ? (
      <ProjectDetailPage
        isRelocating={isRelocating}
        onBack={() => setActivePage("projects")}
        onDelete={setProjectToDelete}
        onLog={addLog}
        onNotify={notify}
        onRelocate={(project) => void relocateProject(project)}
        onReplaceSource={replaceProjectSource}
        project={selectedProject}
        projectBundle={projectBundles[selectedProject.id] ?? null}
        storageError={projectStorageErrors[selectedProject.id] || null}
        storageLoading={projectStorageLoading[selectedProject.id] ?? false}
      />
    ) : <ProjectsPage {...sharedProjectProps} />,
    diagnostics: <DiagnosticsPage events={events} media={mediaDiagnostics} onClear={() => setEvents([])} onNotify={notify} sessionId={DIAGNOSTIC_SESSION_ID} />,
    settings: (
      <SettingsPage
        onAvatarChange={updateAvatar}
        onAvatarRemove={removeAvatar}
        onError={(message) => notify(message, "error")}
        onNameSave={updateProfileName}
        onProfileChange={(changes) => {
          setProfile(current => ({ ...current, ...changes }));
          if (changes.defaultExportFolder !== undefined) localStorage.setItem("cheto-video-ai.default-export-folder", changes.defaultExportFolder);
        }}
        profile={profile}
      />
    ),
  };

  return (
    <>
      <AppShell
        activePage={activePage}
        onNavigate={setActivePage}
        onProfileAvatarChange={updateAvatar}
        onProfileAvatarRemove={removeAvatar}
        onProfileEdit={() => setActivePage("settings")}
        onProfileError={(message) => notify(message, "error")}
        profile={profile}
        title={pageTitles[activePage]}
      >
        {pageContent[activePage]}
      </AppShell>

      <NewProjectModal
        ffprobeAvailable={mediaDiagnostics.ffprobeAvailable}
        onClose={() => setIsNewProjectOpen(false)}
        onCreate={createProject}
        onError={(message) => notify(message, "error")}
        onLog={addLog}
        open={isNewProjectOpen}
      />
      <RenameProjectModal
        key={projectToRename?.id ?? "closed"}
        onClose={() => setProjectToRename(null)}
        onRename={(name) => void renameProject(name)}
        project={projectToRename}
      />
      <ConfirmDeleteModal
        onClose={() => setProjectToDelete(null)}
        onConfirm={deleteProject}
        project={projectToDelete}
      />
      <ToastRegion onDismiss={dismissToast} toasts={toasts} />
    </>
  );
}
