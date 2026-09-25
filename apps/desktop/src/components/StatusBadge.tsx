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
  neutral:
    "border-white/[0.07] bg-white/[0.035] text-muted",
  success:
    "border-success/15 bg-success/[0.07] text-success",
  warning:
    "border-warning/15 bg-warning/[0.07] text-warning",
  error:
    "border-danger/15 bg-danger/[0.07] text-danger",
};

export function StatusBadge({
  label,
  tone = "neutral",
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 truncate rounded-full border px-2 py-1 text-[9px] font-medium leading-none",
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
