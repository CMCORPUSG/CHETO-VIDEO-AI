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
    <section className="mx-auto w-full max-w-[1500px]">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.055] pb-5">
        <div>
          <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted/40">
            Biblioteca local
          </p>

          <div className="mt-1.5 flex items-baseline gap-3">
            <h2 className="text-[18px] font-semibold tracking-tight text-ink">
              Proyectos
            </h2>

            <span className="text-[10px] text-muted/40">
              {projects.length}
            </span>
          </div>

          <p className="mt-2 max-w-xl text-[11px] leading-5 text-muted/55">
            Tus referencias y espacios de edición permanecen
            almacenados localmente.
          </p>
        </div>

        <Button
          icon={<Plus aria-hidden="true" size={15} />}
          onClick={onNewProject}
        >
          Nuevo proyecto
        </Button>
      </header>

      {projects.length === 0 ? (
        <EmptyState
          action={
            <Button
              icon={<Plus aria-hidden="true" size={14} />}
              onClick={onNewProject}
            >
              Crear primer proyecto
            </Button>
          }
          description="Selecciona un video para preparar tu primer espacio de edición local."
          title="Tu biblioteca está vacía"
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
