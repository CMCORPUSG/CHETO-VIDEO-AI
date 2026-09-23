import { Plus } from "lucide-react";
import type { ProjectDraft } from "../components/NewProjectModal";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";

interface ProjectsPageProps {
  onNewProject: () => void;
  projects: ProjectDraft[];
}

export function ProjectsPage({ onNewProject, projects }: ProjectsPageProps) {
  return (
    <section>
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm leading-6 text-muted">Gestiona los proyectos disponibles en la sesión actual.</p>
        </div>
        <Button icon={<Plus aria-hidden="true" size={17} />} onClick={onNewProject}>
          Nuevo proyecto
        </Button>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          action={<Button onClick={onNewProject}>Nuevo proyecto</Button>}
          description="La persistencia local se incorporará en una fase posterior."
          title="No hay proyectos guardados"
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.map((project) => (
            <Card className="flex items-center justify-between gap-5 p-5" key={`${project.name}-${project.fileName}`}>
              <div className="min-w-0">
                <h2 className="truncate font-semibold text-ink">{project.name}</h2>
                <p className="mt-1 truncate text-sm text-muted">{project.fileName}</p>
              </div>
              <StatusBadge label="Sin procesar" />
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
