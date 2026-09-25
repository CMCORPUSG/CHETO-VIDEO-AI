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
        "min-w-0 max-w-full overflow-hidden rounded-lg bg-[#0a111b] ring-1 ring-white/[0.055]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
