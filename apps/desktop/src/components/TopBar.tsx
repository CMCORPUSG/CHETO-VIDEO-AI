import { CloudOff, ShieldCheck } from "lucide-react";

interface TopBarProps {
  title: string;
}

export function TopBar({ title }: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#080f19]/95 px-4 backdrop-blur-xl lg:px-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />

          <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted/45">
            Workspace local
          </span>
        </div>

        <h1 className="mt-0.5 truncate text-[13px] font-semibold tracking-tight text-ink">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-2.5 text-muted/55">
        <ShieldCheck
          aria-hidden="true"
          className="text-success/80"
          size={15}
          strokeWidth={1.8}
        />

        <div className="hidden sm:block">
          <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted/40">
            Privacidad
          </p>

          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-muted/70">
            <CloudOff aria-hidden="true" size={11} />
            API externa desactivada
          </p>
        </div>
      </div>
    </header>
  );
}
