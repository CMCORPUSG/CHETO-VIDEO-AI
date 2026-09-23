import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  icon?: ReactNode;
  variant?: ButtonVariant;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "border-primary/80 bg-[var(--gradient-primary)] text-white shadow-[0_10px_26px_rgba(47,107,255,.25)] hover:border-cyan/70 hover:brightness-110 focus-visible:ring-primary",
  secondary:
    "border-line-bright/70 bg-elevated text-ink shadow-sm hover:border-cyan/50 hover:bg-card focus-visible:ring-cyan",
  ghost:
    "border-transparent bg-transparent text-muted hover:bg-card hover:text-ink focus-visible:ring-cyan",
  danger:
    "border-danger/50 bg-danger/10 text-danger hover:border-danger hover:bg-danger hover:text-white focus-visible:ring-danger",
};

export function Button({
  children,
  className,
  icon,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none",
        variantStyles[variant],
        className,
      )}
      type={type}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
