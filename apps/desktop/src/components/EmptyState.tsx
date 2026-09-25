import { Film } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  action?: ReactNode;
  description: string;
  title: string;
}

export function EmptyState({
  action,
  description,
  title,
}: EmptyStateProps) {
  return (
    <div className="flex min-h-[250px] flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.07] bg-white/[0.012] px-8 py-10 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-lg bg-white/[0.035] text-muted ring-1 ring-white/[0.055]">
        <Film
          aria-hidden="true"
          size={19}
          strokeWidth={1.7}
        />
      </div>

      <h3 className="mt-5 text-[15px] font-semibold tracking-tight text-ink">
        {title}
      </h3>

      <p className="mt-2 max-w-md text-[11px] leading-5 text-muted/65">
        {description}
      </p>

      {action ? (
        <div className="mt-5">
          {action}
        </div>
      ) : null}
    </div>
  );
}
