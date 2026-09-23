import { useState } from "react";
import { AppShell } from "./components/AppShell";
import { NewProjectModal, type ProjectDraft } from "./components/NewProjectModal";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { HomePage } from "./pages/HomePage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { PageId } from "./types/navigation";

const pageTitles: Record<PageId, string> = {
  home: "Inicio",
  projects: "Proyectos",
  diagnostics: "Diagnóstico",
  settings: "Configuración",
};

export function App() {
  const [activePage, setActivePage] = useState<PageId>("home");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectDraft[]>([]);

  const openNewProject = () => setIsModalOpen(true);
  const createProject = (project: ProjectDraft) => {
    setProjects((currentProjects) => [project, ...currentProjects]);
  };

  const pageContent: Record<PageId, React.ReactNode> = {
    home: <HomePage onNewProject={openNewProject} projects={projects} />,
    projects: <ProjectsPage onNewProject={openNewProject} projects={projects} />,
    diagnostics: <DiagnosticsPage />,
    settings: <SettingsPage />,
  };

  return (
    <>
      <AppShell
        activePage={activePage}
        onNavigate={setActivePage}
        title={pageTitles[activePage]}
      >
        {pageContent[activePage]}
      </AppShell>
      <NewProjectModal
        onClose={() => setIsModalOpen(false)}
        onCreate={createProject}
        open={isModalOpen}
      />
    </>
  );
}
