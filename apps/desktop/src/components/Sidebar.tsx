import {
  Activity,
  FolderKanban,
  Home,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";
import type { PageId } from "../types/navigation";

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
}

interface NavigationItem {
  icon: LucideIcon;
  id: PageId;
  label: string;
}

const navigation: NavigationItem[] = [
  { id: "home", label: "Inicio", icon: Home },
  { id: "projects", label: "Proyectos", icon: FolderKanban },
  { id: "diagnostics", label: "Diagnóstico", icon: Activity },
  { id: "settings", label: "Configuración", icon: Settings },
];

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  return (
    <aside className="flex w-20 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 md:w-60 md:px-4">
      <div className="flex items-center gap-3 px-1 md:px-2">
        <div className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md bg-primary text-white">
          <Sparkles aria-hidden="true" size={20} />
          <span className="absolute bottom-0 left-0 h-0.5 w-full bg-cyan" />
        </div>
        <div className="hidden min-w-0 md:block">
          <p className="truncate text-sm font-bold tracking-wide text-ink">CHETO VIDEO AI</p>
          <p className="text-xs text-muted">Desktop Studio</p>
        </div>
      </div>

      <nav aria-label="Navegación principal" className="mt-10 space-y-1">
        {navigation.map(({ icon: Icon, id, label }) => {
          const isActive = activePage === id;

          return (
            <button
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative flex w-full items-center justify-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan md:justify-start",
                isActive
                  ? "bg-primary/15 text-ink"
                  : "text-muted hover:bg-card hover:text-ink",
              )}
              key={id}
              onClick={() => onNavigate(id)}
              title={label}
              type="button"
            >
              {isActive ? (
                <span className="absolute -left-3 h-6 w-0.5 rounded-full bg-cyan md:-left-4" />
              ) : null}
              <Icon aria-hidden="true" className={isActive ? "text-cyan" : ""} size={19} />
              <span className="hidden md:inline">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto hidden rounded-md border border-line bg-card p-3 md:block">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink">
          <span className="h-2 w-2 rounded-full bg-success" />
          Sesión local
        </div>
        <p className="text-xs leading-5 text-muted">Sin servicios externos activos.</p>
      </div>

      <p className="mt-4 text-center font-mono text-[11px] text-muted md:text-left md:pl-2">v0.1.0</p>
    </aside>
  );
}
