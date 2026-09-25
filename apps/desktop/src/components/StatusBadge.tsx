import { cn } from "../lib/cn";

type StatusTone =
  | "neutral"
  | "success"
  | "warning"
  | "error";

interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
}

const toneStyles: Record<StatusTone, string> = {
  neutral: "bg-white/[0.04] text-muted/80",
  success: "bg-success/[0.08] text-success",
  warning: "bg-warning/[0.08] text-warning",
  error: "bg-danger/[0.08] text-danger",
};

export function StatusBadge({
  label,
  tone = "neutral",
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 truncate rounded-full px-2 py-1 text-[9px] font-medium leading-none",
        toneStyles[tone],
      )}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
      />

      {label}
    </span>
  );
}
