import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({
  children,
  className,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-hidden rounded-xl border border-white/[0.06] bg-[#0b121c] shadow-[0_12px_36px_rgba(0,0,0,.16)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
