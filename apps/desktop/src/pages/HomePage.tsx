import {
  Activity,
  Box,
  CloudOff,
  Cpu,
  Microchip,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { HeroCard } from "../components/HeroCard";
import { ProjectCard } from "../components/ProjectCard";
import type { LocalProject } from "../types/project";
import type { MediaDiagnosticState } from "../types/diagnostics";

interface HomePageProps {
  mediaDiagnostics: MediaDiagnosticState;
  onDeleteProject: (project: LocalProject) => void;
  onNewProject: () => void;
  onOpenProject: (project: LocalProject) => void;
  onRenameProject: (project: LocalProject) => void;
  projects: LocalProject[];
}

interface SystemStatusItem {
  description: string;
  icon: LucideIcon;
  label: string;
  state: "neutral" | "success" | "warning";
  value: string;
}

export function HomePage({
  mediaDiagnostics,
  onDeleteProject,
  onNewProject,
  onOpenProject,
  onRenameProject,
  projects,
}: HomePageProps) {
  const systemStatus: SystemStatusItem[] = [
    {
      label: "Motor multimedia",
      value: mediaDiagnostics.ffprobeAvailable
        ? "Disponible"
        : "No disponible",
      description: mediaDiagnostics.ffprobeAvailable
        ? `FFprobe ${mediaDiagnostics.ffprobeVersion ?? "detectado"}`
        : "FFprobe no detectado",
      state: mediaDiagnostics.ffprobeAvailable
        ? "success"
        : "warning",
      icon: Activity,
    },
    {
      label: "GPU",
      value: "Pendiente",
      description: "Detección aún no iniciada",
      state: "warning",
      icon: Microchip,
    },
    {
      label: "Modelos IA",
      value: "No instalados",
      description: "Sin descargas locales",
      state: "neutral",
      icon: Box,
    },
    {
      label: "Privacidad",
      value: "Local",
      description: "API externa desactivada",
      state: "success",
      icon: CloudOff,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-7">
      <HeroCard onNewProject={onNewProject} />

      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted/40">
              Workspace
            </p>

            <h2 className="mt-1 text-[16px] font-semibold tracking-tight text-ink">
              Proyectos recientes
            </h2>
          </div>

          <Button
            icon={<Plus aria-hidden="true" size={14} />}
            onClick={onNewProject}
            variant="secondary"
          >
            Nuevo
          </Button>
        </div>

        {projects.length === 0 ? (
          <EmptyState
            action={
              <Button
                icon={<Plus aria-hidden="true" size={14} />}
                onClick={onNewProject}
              >
                Crear proyecto
              </Button>
            }
            description="Selecciona un video local y crea tu primer espacio de edición."
            title="No hay proyectos recientes"
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.slice(0, 3).map((project) => (
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

      <section className="border-t border-white/[0.05] pt-7">
        <div className="mb-4 flex items-center gap-2">
          <Cpu
            aria-hidden="true"
            className="text-muted/45"
            size={13}
          />

          <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted/50">
            Estado local
          </h2>
        </div>

        <div className="grid overflow-hidden rounded-lg bg-[#090f18] ring-1 ring-white/[0.055] sm:grid-cols-2 xl:grid-cols-4">
          {systemStatus.map((status, index) => {
            const Icon = status.icon;

            return (
              <div
                className={`flex min-h-[105px] items-start gap-3 p-4 ${
                  index > 0
                    ? "border-t border-white/[0.05] sm:border-l sm:border-t-0"
                    : ""
                }`}
                key={status.label}
              >
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/[0.035] text-muted/55">
                  <Icon
                    aria-hidden="true"
                    size={14}
                    strokeWidth={1.7}
                  />
                </div>

                <div className="min-w-0">
                  <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-muted/40">
                    {status.label}
                  </p>

                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        status.state === "success"
                          ? "bg-success"
                          : status.state === "warning"
                            ? "bg-warning"
                            : "bg-muted/40"
                      }`}
                    />

                    <p className="truncate text-[11px] font-semibold text-ink">
                      {status.value}
                    </p>
                  </div>

                  <p className="mt-1.5 truncate text-[9px] text-muted/45">
                    {status.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
