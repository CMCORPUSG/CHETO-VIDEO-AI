import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppShell } from "./components/AppShell";
import { ConfirmDeleteModal } from "./components/ConfirmDeleteModal";
import { NewProjectModal } from "./components/NewProjectModal";
import { RenameProjectModal } from "./components/RenameProjectModal";
import { ToastRegion } from "./components/ToastRegion";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { createId } from "./lib/id";
import { loadProjects, projectStorageKeys } from "./lib/projectStore";
import { checkVideoSource, detectFfprobe, probeVideo, selectVideoPath } from "./media/service";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { HomePage } from "./pages/HomePage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SettingsPage } from "./pages/SettingsPage";
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
  logs: "cheto-video-ai.diagnostics.v1",
};

export function App() {
  const [activePage, setActivePage] = useState<PageId>("home");
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<LocalProject | null>(null);
  const [projectToRename, setProjectToRename] = useState<LocalProject | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isRelocating, setIsRelocating] = useState(false);
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
  const [events, setEvents] = useLocalStorage<DiagnosticEvent[]>(storageKeys.logs, []);
  const hasLoggedStartup = useRef(false);
  const hasCheckedFfprobe = useRef(false);

  const notify = useCallback((message: string, tone: ToastTone = "success") => {
    setToasts((current) => [...current.slice(-3), { id: createId(), message, tone }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const addLog = useCallback((message: string, level: LogLevel = "info") => {
    const event: DiagnosticEvent = {
      id: createId(),
      level,
      message,
      timestamp: new Date().toISOString(),
    };
    setEvents((current) => [...current, event].slice(-500));
  }, [setEvents]);

  useEffect(() => {
    if (hasLoggedStartup.current) return;
    hasLoggedStartup.current = true;
    const timestamp = new Date().toISOString();
    const startupEvents: DiagnosticEvent[] = [
      { id: createId(), level: "info", message: "Aplicación iniciada.", timestamp },
      { id: createId(), level: "info", message: "Workspace local cargado.", timestamp },
    ];
    setEvents((current) => [
      ...current,
      ...startupEvents,
    ].slice(-500));
  }, [setEvents]);

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

  const createProject = (draft: ProjectDraft, probeMs: number) => {
    const project: LocalProject = {
      ...draft,
      id: createId(),
      createdAt: new Date().toISOString(),
      schemaVersion: 2,
      status: "ready",
    };
    setProjects((current) => [project, ...current]);
    setMediaDiagnostics((current) => ({ ...current, lastFileName: project.source.fileName, lastProbeMs: probeMs }));
    addLog(`Proyecto creado: ${project.name}.`);
    notify("Proyecto creado");
  };

  const openProject = (project: LocalProject) => {
    setSelectedProjectId(project.id);
    setActivePage("project");
    addLog(`Proyecto abierto: ${project.name}.`);
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
      setProjects((current) => current.map((entry) => entry.id === project.id ? {
        ...entry,
        metadata: result.metadata,
        source: {
          fileName: result.metadata.fileName,
          lastModifiedMs: result.metadata.lastModifiedMs,
          path: result.metadata.path,
          sizeBytes: result.metadata.sizeBytes,
        },
        status: "ready",
      } : entry));
      setMediaDiagnostics((current) => ({ ...current, lastFileName: result.metadata.fileName, lastProbeMs: result.elapsedMs }));
      addLog(`Metadata completada en ${(result.elapsedMs / 1_000).toFixed(2)} s.`);
      notify("Fuente localizada y validada");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo localizar y validar el archivo.";
      addLog(message, "error");
      notify(message, "error");
    } finally {
      setIsRelocating(false);
    }
  };

  const renameProject = (name: string) => {
    if (!projectToRename) return;
    const previousName = projectToRename.name;
    setProjects((current) => current.map((project) => (
      project.id === projectToRename.id ? { ...project, name } : project
    )));
    setProjectToRename(null);
    addLog(`Proyecto renombrado: ${previousName} → ${name}.`);
    notify("Proyecto renombrado");
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
        onRelocate={(project) => void relocateProject(project)}
        project={selectedProject}
      />
    ) : <ProjectsPage {...sharedProjectProps} />,
    diagnostics: <DiagnosticsPage events={events} media={mediaDiagnostics} onNotify={notify} />,
    settings: (
      <SettingsPage
        onAvatarChange={updateAvatar}
        onAvatarRemove={removeAvatar}
        onError={(message) => notify(message, "error")}
        onNameSave={updateProfileName}
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
        onRename={renameProject}
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
