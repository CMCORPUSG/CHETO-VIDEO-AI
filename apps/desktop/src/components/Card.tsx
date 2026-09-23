import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className, ...props }: CardProps) {
  return (
    <div
      className={cn("rounded-lg border border-line bg-card shadow-card", className)}
      {...props}
    >
      {children}
    </div>
  );
}
