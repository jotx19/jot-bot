"use client";

import { ThinkingOrb } from "thinking-orbs";
import { cn } from "@/lib/utils";

type SolvingIndicatorProps = {
  className?: string;
};

/** Waiting state — orb + ChatGPT-style shimmer “Thinking”. */
export function SolvingIndicator({ className }: SolvingIndicatorProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Thinking"
      className={cn(
        "inline-flex w-fit items-center gap-2 rounded-2xl rounded-bl-md",
        "bg-muted/70 px-3.5 py-2.5 shadow-sm",
        "dark:bg-neutral-800/90",
        className
      )}
    >
      <ThinkingOrb state="listening" size={20} theme="auto" />
      <span className="thinking-shimmer text-[13.5px] font-medium leading-none tracking-tight">
        Thinking
      </span>
    </div>
  );
}

export default SolvingIndicator;
