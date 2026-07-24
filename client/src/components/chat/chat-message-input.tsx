"use client";

import { useEffect, useRef } from "react";
import { Forward } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ChatMessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
}

/** Grow until this height, then scroll inside the field. */
const MAX_HEIGHT_PX = 200;

export function ChatMessageInput({
  value,
  onChange,
  onSend,
  disabled,
}: ChatMessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    el.style.height = `${Math.max(next, 40)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="w-full p-3 md:p-4">
      <div className="flex w-full items-end gap-2 rounded-xl border border-border bg-background/70 px-3 py-1 shadow-sm backdrop-blur-md">
        <div className="flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            placeholder="Sending message!"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
            className="min-h-[40px] max-h-[200px] w-full resize-none border-none bg-px-0 py-2 font-mono text-base tracking-tight text-foreground outline-none placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:min-h-[52px] md:text-sm [scrollbar-width:thin]"
          />
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={onSend}
              className="mb-1 rounded-full bg-blue-500 text-white hover:bg-blue-600"
              size="icon"
              disabled={disabled || !value.trim()}
              type="button"
              aria-label="Send message"
            >
              <Forward className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Send message</TooltipContent>
        </Tooltip>
      </div>

      <div className="mt-1 hidden justify-start px-3 md:block">
        <p className="text-xs text-muted-foreground">
          Press{" "}
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            Enter
          </kbd>{" "}
          to send ·{" "}
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            Shift
          </kbd>{" "}
          +{" "}
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            Enter
          </kbd>{" "}
          for newline
        </p>
      </div>
    </div>
  );
}

export default ChatMessageInput;
