import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

interface TooltipProps {
  children: ReactElement;
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delayDuration?: number;
}

export function Tooltip({
  children,
  content,
  side = "top",
  align = "center",
  delayDuration = 350,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          {children}
        </TooltipPrimitive.Trigger>

        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            align={align}
            side={side}
            sideOffset={6}
            className="z-[100] max-w-xs rounded-md border border-line-bright bg-elevated px-2 py-1.5 text-[10px] font-medium leading-tight text-ink shadow-lg"
          >
            {content}

            <TooltipPrimitive.Arrow className="fill-elevated" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
