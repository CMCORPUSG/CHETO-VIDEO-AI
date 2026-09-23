import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-[linear-gradient(145deg,var(--color-card),color-mix(in_srgb,var(--color-card)_82%,var(--color-elevated)))] shadow-card",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
