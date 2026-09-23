import { ArrowRight, Clapperboard, Cpu, FileVideo, Plus, Sparkles } from "lucide-react";
import type { ProjectDraft } from "../components/NewProjectModal";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";

interface HomePageProps {
  onNewProject: () => void;
  projects: ProjectDraft[];
}

const systemStatus = [
  { label: "Motor", value: "No iniciado", tone: "neutral" as const },
  { label: "GPU", value: "Pendiente de detección", tone: "warning" as const },
  { label: "Modelos", value: "No instalados", tone: "neutral" as const },
  { label: "API externa", value: "Desactivada", tone: "success" as const },
];

export function HomePage({ onNewProject, projects }: HomePageProps) {
  return (
    <div className="space-y-8">
      <section className="hero-grid relative overflow-hidden rounded-lg border border-line bg-surface p-7 shadow-card lg:p-10">
        <div className="relative z-10 max-w-2xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-sm border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-cyan">
            <Sparkles aria-hidden="true" size={14} />
            Base Desktop · v0.1.0
          </div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan">CHETO VIDEO AI</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Editor inteligente de video
          </h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted">
            Un espacio local preparado para convertir videos largos en ediciones claras, revisables y profesionales.
          </p>
          <Button className="mt-7 px-5" icon={<Plus aria-hidden="true" size={18} />} onClick={onNewProject}>
            Nuevo proyecto
          </Button>
        </div>

        <div className="absolute -bottom-16 -right-12 hidden h-64 w-64 rotate-12 items-center justify-center rounded-lg border border-primary/20 bg-primary/5 lg:flex">
          <Clapperboard aria-hidden="true" className="text-primary/20" size={112} strokeWidth={1.2} />
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Workspace</p>
            <h2 className="mt-1 text-xl font-semibold text-ink">Proyectos recientes</h2>
          </div>
          <span className="text-xs text-muted">Sólo esta sesión</span>
        </div>

        {projects.length === 0 ? (
          <EmptyState
            action={
              <Button icon={<Plus aria-hidden="true" size={16} />} onClick={onNewProject} variant="secondary">
                Crear el primero
              </Button>
            }
            description="Todavía no hay proyectos. Crea una referencia local sin iniciar procesamiento de video."
            title="Tu workspace está listo"
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Card className="group p-5" key={`${project.name}-${project.fileName}`}>
                <div className="flex items-start justify-between gap-4">
                  <span className="grid h-11 w-11 place-items-center rounded-md bg-primary/10 text-cyan">
                    <FileVideo aria-hidden="true" size={20} />
                  </span>
                  <StatusBadge label="Sin procesar" />
                </div>
                <h3 className="mt-5 truncate font-semibold text-ink">{project.name}</h3>
                <p className="mt-1 truncate text-sm text-muted">{project.fileName}</p>
                <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-xs text-muted">
                  <span>Creado en esta sesión</span>
                  <ArrowRight aria-hidden="true" className="transition group-hover:translate-x-1 group-hover:text-cyan" size={16} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2">
          <Cpu aria-hidden="true" className="text-cyan" size={19} />
          <h2 className="text-xl font-semibold text-ink">Estado del sistema</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {systemStatus.map((status) => (
            <Card className="p-4" key={status.label}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{status.label}</p>
              <div className="mt-3">
                <StatusBadge label={status.value} tone={status.tone} />
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
