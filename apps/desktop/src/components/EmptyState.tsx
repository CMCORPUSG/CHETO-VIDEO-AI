import { Film, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  action?: ReactNode;
  description: string;
  title: string;
}

export function EmptyState({ action, description, title }: EmptyStateProps) {
  return (
    <div className="surface-shine relative flex min-h-64 flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-line-bright bg-[radial-gradient(circle_at_50%_0%,rgba(47,107,255,.14),transparent_48%),linear-gradient(145deg,rgba(18,32,51,.96),rgba(12,23,38,.92))] px-6 py-11 text-center shadow-card">
      <div className="pointer-events-none absolute left-[15%] top-1/2 h-px w-[18%] bg-gradient-to-r from-transparent to-line-bright" />
      <div className="pointer-events-none absolute right-[15%] top-1/2 h-px w-[18%] bg-gradient-to-l from-transparent to-line-bright" />
      <div className="relative mb-5 grid h-16 w-16 place-items-center rounded-xl border border-cyan/25 bg-primary/10 text-cyan shadow-glow">
        <Film aria-hidden="true" size={26} />
        <Sparkles aria-hidden="true" className="absolute -right-2 -top-2 text-violet" size={17} />
      </div>
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
