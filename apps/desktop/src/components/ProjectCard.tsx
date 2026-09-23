import { ExternalLink, FileVideo, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatFileSize, formatProjectDate } from "../lib/format";
import type { LocalProject } from "../types/project";
import { Button } from "./Button";
import { Card } from "./Card";
import { StatusBadge } from "./StatusBadge";

interface ProjectCardProps {
  onDelete: (project: LocalProject) => void;
  onOpen: (project: LocalProject) => void;
  onRename: (project: LocalProject) => void;
  project: LocalProject;
}

export function ProjectCard({ onDelete, onOpen, onRename, project }: ProjectCardProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const closeMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMenuOpen]);

  return (
    <Card className="group surface-shine relative p-5 transition duration-200 hover:-translate-y-0.5 hover:border-line-bright hover:shadow-card-hover">
      <div className="flex items-start justify-between gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-cyan transition group-hover:bg-primary/15">
          <FileVideo aria-hidden="true" size={21} />
        </span>
        <div className="relative" ref={menuRef}>
          <button
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
            aria-label={`Opciones de ${project.name}`}
            className="rounded-md border border-transparent p-2 text-muted transition hover:border-line hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            onClick={() => setIsMenuOpen((current) => !current)}
            type="button"
          >
            <MoreHorizontal aria-hidden="true" size={19} />
          </button>
          {isMenuOpen ? (
            <div className="menu-enter absolute right-0 top-11 z-30 w-48 rounded-lg border border-line-bright bg-elevated p-2 shadow-modal" role="menu">
              <button
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-ink transition hover:bg-primary/10 hover:text-cyan"
                onClick={() => {
                  setIsMenuOpen(false);
                  onRename(project);
                }}
                role="menuitem"
                type="button"
              >
                <Pencil aria-hidden="true" size={15} />
                Renombrar
              </button>
              <button
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-muted transition hover:bg-danger/10 hover:text-danger"
                onClick={() => {
                  setIsMenuOpen(false);
                  onDelete(project);
                }}
                role="menuitem"
                type="button"
              >
                <Trash2 aria-hidden="true" size={15} />
                Eliminar referencia
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <h3 className="mt-5 truncate text-base font-bold text-ink">{project.name}</h3>
      <p className="mt-1.5 truncate text-sm text-muted" title={project.fileName}>{project.fileName}</p>
      <p className="mt-1 text-xs text-muted/70">{formatFileSize(project.fileSize)} · {project.fileExtension.toUpperCase()}</p>

      <div className="mt-5 flex items-end justify-between gap-4 border-t border-line pt-4">
        <div>
          <StatusBadge label="Preparado" tone="success" />
          <p className="mt-2 text-[11px] text-muted">{formatProjectDate(project.createdAt)}</p>
        </div>
        <Button
          icon={<ExternalLink aria-hidden="true" size={15} />}
          onClick={() => onOpen(project)}
          variant="secondary"
        >
          Abrir
        </Button>
      </div>
    </Card>
  );
}
