import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

const buttonVariants = cva(
  "inline-flex h-8 min-w-0 max-w-full items-center justify-center gap-1.5 rounded-[6px] border px-3 text-[11px] font-semibold leading-none whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary:
          "border-primary/55 bg-primary text-white shadow-[0_6px_18px_rgba(47,107,255,.16)] hover:border-primary/75 hover:bg-primary/90 focus-visible:ring-primary/70",
        secondary:
          "border-white/[0.08] bg-white/[0.035] text-ink/85 hover:border-white/[0.13] hover:bg-white/[0.06] hover:text-ink focus-visible:ring-cyan/55",
        ghost:
          "border-transparent bg-transparent text-muted/70 hover:bg-white/[0.045] hover:text-ink focus-visible:ring-cyan/55",
        danger:
          "border-danger/20 bg-danger/[0.07] text-danger hover:border-danger/35 hover:bg-danger/[0.12] focus-visible:ring-danger/55",
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
      {icon ? <span className="shrink-0" aria-hidden="true">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </button>
  );
}
