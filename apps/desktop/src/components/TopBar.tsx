import { CloudOff, ShieldCheck } from "lucide-react";

interface TopBarProps {
  title: string;
}

export function TopBar({ title }: TopBarProps) {
  return (
    <header className="flex h-[76px] shrink-0 items-center justify-between border-b border-line bg-canvas/80 px-6 backdrop-blur-md lg:px-8">
      <div>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
          <span>Workspace local</span>
          <span className="h-1 w-1 rounded-full bg-cyan" />
          <span className="text-success">En línea</span>
        </div>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-ink">{title}</h1>
      </div>
      <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface/85 px-3.5 py-2.5 text-xs font-semibold text-muted shadow-sm">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-success/10 text-success">
          <ShieldCheck aria-hidden="true" size={15} />
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-[10px] uppercase tracking-[0.12em] text-muted/70">Privacidad</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink">
            <CloudOff aria-hidden="true" size={12} />
            API externa desactivada
          </span>
        </span>
      </div>
    </header>
  );
}
