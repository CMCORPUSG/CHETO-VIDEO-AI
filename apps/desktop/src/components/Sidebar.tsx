import {
  Activity,
  FolderKanban,
  Home,
  Settings,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";
import type { PageId } from "../types/navigation";
import type { LocalProfile } from "../types/profile";
import { UserProfile } from "./UserProfile";

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  onProfileAvatarChange: (avatar: string) => void;
  onProfileAvatarRemove: () => void;
  onProfileEdit: () => void;
  onProfileError: (message: string) => void;
  profile: LocalProfile;
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

export function Sidebar({
  activePage,
  onNavigate,
  onProfileAvatarChange,
  onProfileAvatarRemove,
  onProfileEdit,
  onProfileError,
  profile,
}: SidebarProps) {
  return (
    <aside className="relative flex w-20 shrink-0 flex-col overflow-visible border-r border-line bg-[linear-gradient(180deg,var(--color-surface),#091422)] px-3 py-5 md:w-64 md:px-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-primary/10 to-transparent" />
      <div className="relative flex items-center gap-3 px-1 md:px-2">
        <div className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-cyan/25 bg-[var(--gradient-primary)] text-white shadow-glow">
          <WandSparkles aria-hidden="true" size={20} />
          <span className="absolute bottom-0 left-0 h-0.5 w-full bg-cyan" />
        </div>
        <div className="hidden min-w-0 md:block">
          <p className="truncate text-sm font-extrabold tracking-[0.04em] text-ink">CHETO VIDEO AI</p>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-cyan">Desktop Studio</p>
        </div>
      </div>

      <p className="relative mt-10 hidden px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-muted/70 md:block">
        Navegación
      </p>
      <nav aria-label="Navegación principal" className="relative mt-3 space-y-1.5">
        {navigation.map(({ icon: Icon, id, label }) => {
          const isActive = activePage === id;

          return (
            <button
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-lg border px-3 py-3 text-sm font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan md:justify-start",
                isActive
                  ? "border-primary/25 bg-[linear-gradient(90deg,rgba(47,107,255,.2),rgba(0,213,255,.05))] text-ink shadow-[inset_0_1px_rgba(255,255,255,.04)]"
                  : "border-transparent text-muted hover:border-line hover:bg-card/70 hover:text-ink",
              )}
              key={id}
              onClick={() => onNavigate(id)}
              title={label}
              type="button"
            >
              {isActive ? (
                <span className="absolute left-0 h-7 w-0.5 rounded-full bg-cyan shadow-[0_0_12px_var(--color-secondary)]" />
              ) : null}
              <span className={cn("grid h-7 w-7 place-items-center rounded-md transition", isActive ? "bg-primary/20 text-cyan" : "text-muted group-hover:text-cyan")}>
                <Icon aria-hidden="true" size={17} />
              </span>
              <span className="hidden md:inline">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="relative mt-auto">
        <div className="mb-3 hidden items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/70 md:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_8px_var(--color-success)]" />
          Sesión protegida
        </div>
        <UserProfile
          onAvatarChange={onProfileAvatarChange}
          onAvatarRemove={onProfileAvatarRemove}
          onEditName={onProfileEdit}
          onError={onProfileError}
          profile={profile}
        />
      </div>

      <p className="relative mt-3 text-center font-mono text-[10px] text-muted/60 md:text-left md:pl-2">v0.2.0 · local</p>
    </aside>
  );
}
