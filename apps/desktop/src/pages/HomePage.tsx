import {
  Activity,
  ArrowRight,
  Box,
  CloudOff,
  Cpu,
  FileVideo,
  Microchip,
  Plus,
  type LucideIcon,
} from "lucide-react";
import type { ProjectDraft } from "../components/NewProjectModal";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { HeroCard } from "../components/HeroCard";
import { StatusBadge } from "../components/StatusBadge";

interface HomePageProps {
  onNewProject: () => void;
  projects: ProjectDraft[];
}

interface SystemStatusItem {
  accent: string;
  description: string;
  icon: LucideIcon;
  label: string;
  tone: "neutral" | "success" | "warning";
  value: string;
}

const systemStatus: SystemStatusItem[] = [
  {
    label: "Motor",
    value: "Inactivo",
    description: "Listo para una fase futura",
    tone: "neutral",
    icon: Activity,
    accent: "bg-primary/15 text-cyan",
  },
  {
    label: "GPU",
    value: "Pendiente",
    description: "Detección aún no iniciada",
    tone: "warning",
    icon: Microchip,
    accent: "bg-warning/10 text-warning",
  },
  {
    label: "Modelos",
    value: "No instalados",
    description: "Sin descargas locales",
    tone: "neutral",
    icon: Box,
    accent: "bg-violet/15 text-violet",
  },
  {
    label: "API externa",
    value: "Desactivada",
    description: "Privacidad local activa",
    tone: "success",
    icon: CloudOff,
    accent: "bg-success/10 text-success",
  },
];

export function HomePage({ onNewProject, projects }: HomePageProps) {
  return (
    <div className="space-y-10">
      <HeroCard onNewProject={onNewProject} />

      <section>
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan">Workspace</p>
            <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-ink">Proyectos recientes</h2>
          </div>
          <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] font-semibold text-muted">
            Sólo esta sesión
          </span>
        </div>

        {projects.length === 0 ? (
          <EmptyState
            action={
              <Button icon={<Plus aria-hidden="true" size={16} />} onClick={onNewProject} variant="secondary">
                Crear el primero
              </Button>
            }
            description="Crea un proyecto para preparar tu material. En esta fase el archivo se conserva sólo como referencia visual y nunca sale de tu equipo."
            title="Tu próxima edición empieza aquí"
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Card className="group surface-shine p-5 transition duration-200 hover:-translate-y-0.5 hover:border-line-bright hover:shadow-card-hover" key={`${project.name}-${project.fileName}`}>
                <div className="flex items-start justify-between gap-4">
                  <span className="grid h-12 w-12 place-items-center rounded-lg border border-primary/20 bg-[var(--gradient-primary)] text-white shadow-glow">
                    <FileVideo aria-hidden="true" size={20} />
                  </span>
                  <StatusBadge label="Sin procesar" />
                </div>
                <h3 className="mt-5 truncate text-base font-semibold text-ink">{project.name}</h3>
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
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan">
              <Cpu aria-hidden="true" size={14} />
              Entorno local
            </p>
            <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-ink">Estado del sistema</h2>
          </div>
          <p className="hidden text-xs text-muted sm:block">Sin procesos pesados activos</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {systemStatus.map((status) => (
            <Card className="group relative overflow-hidden p-5 transition duration-200 hover:border-line-bright hover:shadow-card-hover" key={status.label}>
              <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/5 blur-2xl transition group-hover:bg-primary/10" />
              <div className="relative flex items-start justify-between gap-3">
                <span className={`grid h-10 w-10 place-items-center rounded-lg ${status.accent}`}>
                  <status.icon aria-hidden="true" size={18} />
                </span>
                <StatusBadge label={status.value} tone={status.tone} />
              </div>
              <h3 className="relative mt-5 text-sm font-bold uppercase tracking-[0.1em] text-ink">{status.label}</h3>
              <p className="relative mt-1.5 text-xs leading-5 text-muted">{status.description}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
