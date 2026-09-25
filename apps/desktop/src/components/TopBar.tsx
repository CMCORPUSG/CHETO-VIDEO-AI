import {
  Activity,
  CloudOff,
  FolderOpen,
  Settings,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import type { PageId } from "../types/navigation";

interface TopBarProps {
  activePage: PageId;
  editorMode?: boolean;
  onNavigate: (page: PageId) => void;
  title: string;
}

export function TopBar({
  editorMode = false,
  onNavigate,
  title,
}: TopBarProps) {
  if (editorMode) {
    return (
      <header className="editor-app-topbar flex h-14 shrink-0 items-center border-b border-white/[0.06] bg-[#07101a]/98 px-3">
        <div className="flex min-w-[210px] items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/[0.12] text-cyan ring-1 ring-cyan/20">
            <WandSparkles aria-hidden="true" size={16} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold tracking-tight text-ink">CHETO VIDEO AI</p>
            <p className="text-[8px] font-medium uppercase tracking-[0.12em] text-muted/40">Editor local</p>
          </div>
        </div>

        <nav className="mx-auto flex items-center gap-1">
          <EditorNavButton active icon={<Sparkles size={14} />} label="Editor" onClick={() => undefined} />
          <EditorNavButton icon={<FolderOpen size={14} />} label="Proyectos" onClick={() => onNavigate("projects")} />
          <EditorNavButton icon={<Activity size={14} />} label="Diagnóstico" onClick={() => onNavigate("diagnostics")} />
          <EditorNavButton icon={<Settings size={14} />} label="Configuración" onClick={() => onNavigate("settings")} />
        </nav>

        <div className="flex min-w-[210px] items-center justify-end gap-2 text-muted/55">
          <ShieldCheck aria-hidden="true" className="text-success/80" size={15} />
          <div className="hidden xl:block">
            <p className="text-[8px] font-medium uppercase tracking-[0.1em] text-muted/35">Privacidad</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[9px] font-medium text-muted/65">
              <CloudOff aria-hidden="true" size={10} />
              API externa desactivada
            </p>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#080f19]/95 px-4 backdrop-blur-xl lg:px-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted/45">Workspace local</span>
        </div>
        <h1 className="mt-0.5 truncate text-[13px] font-semibold tracking-tight text-ink">{title}</h1>
      </div>
      <div className="flex items-center gap-2.5 text-muted/55">
        <ShieldCheck aria-hidden="true" className="text-success/80" size={15} strokeWidth={1.8} />
        <div className="hidden sm:block">
          <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted/40">Privacidad</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-muted/70"><CloudOff aria-hidden="true" size={11} />API externa desactivada</p>
        </div>
      </div>
    </header>
  );
}

function EditorNavButton({
  active = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active
        ? "flex h-9 items-center gap-2 rounded-md bg-primary/[0.12] px-4 text-[10px] font-semibold text-ink ring-1 ring-primary/25"
        : "flex h-9 items-center gap-2 rounded-md px-4 text-[10px] font-semibold text-muted/65 transition-colors hover:bg-white/[0.04] hover:text-ink"}
      onClick={onClick}
      type="button"
    >
      {icon}{label}
    </button>
  );
}
