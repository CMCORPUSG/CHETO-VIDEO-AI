import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowUpRight,
  FileVideo,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { formatFileSize, formatProjectDate } from "../lib/format";
import type { LocalProject } from "../types/project";
import { Card } from "./Card";
import { StatusBadge } from "./StatusBadge";

interface ProjectCardProps {
  onDelete: (project: LocalProject) => void;
  onOpen: (project: LocalProject) => void;
  onRename: (project: LocalProject) => void;
  project: LocalProject;
}

export function ProjectCard({
  onDelete,
  onOpen,
  onRename,
  project,
}: ProjectCardProps) {
  const extension =
    project.metadata?.extension.toUpperCase() ??
    "LEGACY";

  return (
    <Card className="group relative flex min-h-[230px] flex-col transition-[background-color,transform,box-shadow] duration-150 hover:-translate-y-px hover:bg-[#0d1521] hover:ring-white/[0.09]">
      <div className="flex items-start justify-between px-5 pt-5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.035] text-muted/70 ring-1 ring-white/[0.055]">
          <FileVideo
            aria-hidden="true"
            size={16}
            strokeWidth={1.7}
          />
        </div>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              aria-label={`Opciones de ${project.name}`}
              className="grid h-8 w-8 place-items-center rounded-md text-muted/45 transition-colors hover:bg-white/[0.05] hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan/60"
              type="button"
            >
              <MoreHorizontal
                aria-hidden="true"
                size={16}
              />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="menu-enter z-[100] min-w-[190px] rounded-lg border border-white/[0.08] bg-[#0d1623] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,.45)]"
            >
              <DropdownMenu.Item
                className="flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-[11px] text-muted outline-none data-[highlighted]:bg-white/[0.05] data-[highlighted]:text-ink"
                onSelect={() => onRename(project)}
              >
                <Pencil
                  aria-hidden="true"
                  size={14}
                />

                Renombrar
              </DropdownMenu.Item>

              <DropdownMenu.Separator className="my-1 h-px bg-white/[0.06]" />

              <DropdownMenu.Item
                className="flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-[11px] text-muted outline-none data-[highlighted]:bg-danger/10 data-[highlighted]:text-danger"
                onSelect={() => onDelete(project)}
              >
                <Trash2
                  aria-hidden="true"
                  size={14}
                />

                Eliminar referencia
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <div className="px-5 pt-5">
        <h3 className="truncate text-[14px] font-semibold tracking-tight text-ink">
          {project.name}
        </h3>

        <p
          className="mt-1.5 truncate text-[10px] text-muted/50"
          title={project.source.fileName}
        >
          {project.source.fileName}
        </p>

        <div className="mt-4 flex items-center gap-2 text-[9px] font-medium text-muted/45">
          <span>{formatFileSize(project.source.sizeBytes)}</span>

          <span className="h-1 w-1 rounded-full bg-muted/30" />

          <span>{extension}</span>
        </div>
      </div>

      <div className="mt-auto flex items-end justify-between gap-4 border-t border-white/[0.055] px-5 py-4">
        <div className="min-w-0">
          <StatusBadge
            label={
              project.status === "ready"
                ? "Listo"
                : project.status === "source-missing"
                  ? "Fuente ausente"
                  : project.status === "source-changed"
                    ? "Fuente modificada"
                    : "Reubicar fuente"
            }
            tone={
              project.status === "ready"
                ? "success"
                : "warning"
            }
          />

          <p className="mt-2 text-[9px] text-muted/40">
            {formatProjectDate(project.createdAt)}
          </p>
        </div>

        <button
          aria-label={`Abrir ${project.name}`}
          className="group/open flex h-8 items-center gap-1.5 rounded-md bg-white/[0.035] px-3 text-[10px] font-medium text-muted/80 ring-1 ring-white/[0.065] transition-colors hover:bg-white/[0.06] hover:text-ink hover:ring-white/[0.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/55"
          onClick={() => onOpen(project)}
          type="button"
        >
          Abrir

          <ArrowUpRight
            aria-hidden="true"
            className="transition-transform group-hover/open:-translate-y-px group-hover/open:translate-x-px"
            size={13}
          />
        </button>
      </div>
    </Card>
  );
}
