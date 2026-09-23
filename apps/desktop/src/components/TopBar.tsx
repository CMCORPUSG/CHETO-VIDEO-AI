import { ShieldCheck } from "lucide-react";

interface TopBarProps {
  title: string;
}

export function TopBar({ title }: TopBarProps) {
  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-line bg-canvas/95 px-6 lg:px-8">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Workspace local</p>
        <h1 className="mt-0.5 text-lg font-semibold text-ink">{title}</h1>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-xs font-medium text-muted">
        <ShieldCheck aria-hidden="true" className="text-success" size={16} />
        <span className="hidden sm:inline">API externa desactivada</span>
        <span className="sm:hidden">Local</span>
      </div>
    </header>
  );
}
