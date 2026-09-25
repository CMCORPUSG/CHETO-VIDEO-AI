import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

const buttonVariants = cva(
  "inline-flex min-h-9 min-w-0 max-w-full items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold leading-tight whitespace-nowrap transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none",
  {
    variants: {
      variant: {
        primary:
          "border-primary/80 bg-[var(--gradient-primary)] text-white shadow-[0_10px_26px_rgba(47,107,255,.25)] hover:border-cyan/70 hover:brightness-110 focus-visible:ring-primary",
        secondary:
          "border-line-bright/70 bg-elevated text-ink shadow-sm hover:border-cyan/50 hover:bg-card focus-visible:ring-cyan",
        ghost:
          "border-transparent bg-transparent text-muted hover:bg-card hover:text-ink focus-visible:ring-cyan",
        danger:
          "border-danger/50 bg-danger/10 text-danger hover:border-danger hover:bg-danger hover:text-white focus-visible:ring-danger",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  },
);

type ButtonVariant = NonNullable<
  VariantProps<typeof buttonVariants>["variant"]
>;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  icon?: ReactNode;
  variant?: ButtonVariant;
}

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
      className={cn(buttonVariants({ variant }), className)}
      type={type}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
