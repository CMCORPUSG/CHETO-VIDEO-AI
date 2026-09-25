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
import { Tooltip } from "./Tooltip";
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
    <aside className="relative flex w-[72px] shrink-0 flex-col border-r border-white/[0.06] bg-[#080f19] px-2.5 py-4 md:w-[220px] md:px-3">
      <div className="flex h-11 items-center gap-2.5 px-1.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.10] bg-white/[0.04] text-cyan">
          <WandSparkles aria-hidden="true" size={17} strokeWidth={1.8} />
        </div>

        <div className="hidden min-w-0 md:block">
          <p className="truncate text-[12px] font-bold tracking-[0.03em] text-ink">
            CHETO VIDEO AI
          </p>
          <p className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-muted/60">
            Desktop Studio
          </p>
        </div>
      </div>

      <div className="mt-8 hidden px-2 md:block">
        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted/45">
          Workspace
        </p>
      </div>

      <nav
        aria-label="Navegación principal"
        className="mt-2 flex flex-col gap-1"
      >
        {navigation.map(({ icon: Icon, id, label }) => {
          const isActive = activePage === id;

          const button = (
            <button
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative flex h-10 w-full items-center justify-center gap-3 rounded-md px-2.5 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan/70 md:justify-start",
                isActive
                  ? "bg-white/[0.07] text-ink"
                  : "text-muted/75 hover:bg-white/[0.04] hover:text-ink",
              )}
              onClick={() => onNavigate(id)}
              type="button"
            >
              {isActive ? (
                <span className="absolute left-0 h-5 w-[2px] rounded-r-full bg-cyan" />
              ) : null}

              <Icon
                aria-hidden="true"
                className={cn(
                  "shrink-0 transition-colors",
                  isActive
                    ? "text-cyan"
                    : "text-muted/65 group-hover:text-muted",
                )}
                size={16}
                strokeWidth={1.8}
              />

              <span className="hidden truncate md:block">{label}</span>
            </button>
          );

          return (
            <Tooltip
              content={label}
              key={id}
              side="right"
              delayDuration={500}
            >
              {button}
            </Tooltip>
          );
        })}
      </nav>

      <div className="mt-auto">
        <div className="mb-2 hidden items-center gap-2 px-2 md:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />

          <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted/50">
            Local · protegido
          </span>
        </div>

        <UserProfile
          onAvatarChange={onProfileAvatarChange}
          onAvatarRemove={onProfileAvatarRemove}
          onEditName={onProfileEdit}
          onError={onProfileError}
          profile={profile}
        />

        <p className="mt-2 hidden px-2 font-mono text-[8px] text-muted/35 md:block">
          CHETO v0.2.0
        </p>
      </div>
    </aside>
  );
}
