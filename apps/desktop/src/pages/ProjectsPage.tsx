import { Plus } from "lucide-react";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { ProjectCard } from "../components/ProjectCard";
import type { LocalProject } from "../types/project";

interface ProjectsPageProps {
  onDeleteProject: (project: LocalProject) => void;
  onNewProject: () => void;
  onOpenProject: (project: LocalProject) => void;
  onRenameProject: (project: LocalProject) => void;
  projects: LocalProject[];
}

export function ProjectsPage({
  onDeleteProject,
  onNewProject,
  onOpenProject,
  onRenameProject,
  projects,
}: ProjectsPageProps) {
  return (
    <section>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan">Biblioteca local</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
            Referencias ligeras a tus videos originales. Ningún archivo se copia o modifica.
          </p>
        </div>
        <Button icon={<Plus aria-hidden="true" size={17} />} onClick={onNewProject}>Nuevo proyecto</Button>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          action={<Button onClick={onNewProject}>Crear primer proyecto</Button>}
          description="Selecciona un video local para crear una referencia segura y preparar tu espacio de edición."
          title="Aún no tienes proyectos"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              onDelete={onDeleteProject}
              onOpen={onOpenProject}
              onRename={onRenameProject}
              project={project}
            />
          ))}
        </div>
      )}
    </section>
  );
}
