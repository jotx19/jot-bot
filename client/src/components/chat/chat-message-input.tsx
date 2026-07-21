"use client";

import { Forward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

export function ChatMessageInput({
  value,
  onChange,
  onSend,
  disabled,
}: ChatMessageInputProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="w-full border-t border-border p-3">
      <div className="flex w-full items-start gap-2 rounded-xl border border-border bg-background/80 px-3 py-1 shadow-sm backdrop-blur-md">
        <div className="flex-1">
          <Textarea
            value={value}
            placeholder="Sending message!"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className="min-h-[40px] max-h-[120px] resize-none border-none bg-transparent font-mono tracking-tight shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 md:min-h-[52px]"
            rows={1}
          />
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={onSend}
              className="mt-1 rounded-full bg-blue-500 text-white hover:bg-blue-600"
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
