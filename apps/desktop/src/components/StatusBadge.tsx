import { cn } from "../lib/cn";

type StatusTone = "neutral" | "success" | "warning" | "error";

interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
}

const toneStyles: Record<StatusTone, string> = {
  neutral: "border-line-bright/70 bg-elevated text-muted",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  error: "border-danger/25 bg-danger/10 text-danger",
};

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        toneStyles[tone],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" aria-hidden="true" />
      {label}
    </span>
  );
}
