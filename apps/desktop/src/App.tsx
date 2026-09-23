import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppShell } from "./components/AppShell";
import { ConfirmDeleteModal } from "./components/ConfirmDeleteModal";
import { NewProjectModal } from "./components/NewProjectModal";
import { RenameProjectModal } from "./components/RenameProjectModal";
import { ToastRegion } from "./components/ToastRegion";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { createId } from "./lib/id";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { HomePage } from "./pages/HomePage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { DiagnosticEvent, LogLevel } from "./types/diagnostics";
import type { PageId } from "./types/navigation";
import type { LocalProfile } from "./types/profile";
import type { LocalProject, ProjectDraft } from "./types/project";
import type { ToastMessage, ToastTone } from "./types/toast";

const pageTitles: Record<PageId, string> = {
  home: "Inicio",
  projects: "Proyectos",
  diagnostics: "Diagnóstico",
  settings: "Configuración",
};

const storageKeys = {
  projects: "cheto-video-ai.projects.v1",
  profile: "cheto-video-ai.profile.v1",
  logs: "cheto-video-ai.diagnostics.v1",
};

export function App() {
  const [activePage, setActivePage] = useState<PageId>("home");
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<LocalProject | null>(null);
  const [projectToRename, setProjectToRename] = useState<LocalProject | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [projects, setProjects] = useLocalStorage<LocalProject[]>(storageKeys.projects, []);
  const [profile, setProfile] = useLocalStorage<LocalProfile>(storageKeys.profile, () => ({
    name: "Usuario",
    avatar: localStorage.getItem("cheto-video-ai.profile-avatar"),
  }));
  const [events, setEvents] = useLocalStorage<DiagnosticEvent[]>(storageKeys.logs, []);
  const hasLoggedStartup = useRef(false);

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

  const createProject = (draft: ProjectDraft) => {
    const project: LocalProject = {
      ...draft,
      id: createId(),
      createdAt: new Date().toISOString(),
      status: "created",
    };
    setProjects((current) => [project, ...current]);
    addLog(`Proyecto creado: ${project.name}.`);
    notify("Proyecto creado");
  };

  const openProject = (project: LocalProject) => {
    addLog(`Proyecto abierto: ${project.name}.`);
    notify("Proyecto preparado para próximas fases", "info");
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

  const pageContent: Record<PageId, ReactNode> = {
    home: <HomePage {...sharedProjectProps} />,
    projects: <ProjectsPage {...sharedProjectProps} />,
    diagnostics: <DiagnosticsPage events={events} onNotify={notify} />,
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
        onClose={() => setIsNewProjectOpen(false)}
        onCreate={createProject}
        onError={(message) => notify(message, "error")}
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
