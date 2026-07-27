"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowBigUp, CornerDownLeft, Forward } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ChatPreferTool = "websearch" | "notion" | "sandbox";

const TOOLS: { id: ChatPreferTool; label: string }[] = [
  { id: "websearch", label: "websearch" },
  { id: "notion", label: "notion" },
  { id: "sandbox", label: "sandbox" },
];

interface ChatMessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
}

const MAX_HEIGHT_PX = 200;

/** Active `/query` at the start of the input (slash commands only). */
function getSlashQuery(value: string): string | null {
  const m = String(value || "").match(/^\/([a-z0-9_]*)$/i);
  if (!m) return null;
  return m[1].toLowerCase();
}

export function ChatMessageInput({
  value,
  onChange,
  onSend,
  disabled,
}: ChatMessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [highlight, setHighlight] = useState(0);

  const slashQuery = getSlashQuery(value);
  const showTools = slashQuery !== null;
  const filtered = useMemo(() => {
    if (slashQuery === null) return [];
    if (!slashQuery) return TOOLS;
    return TOOLS.filter((t) => t.id.startsWith(slashQuery));
  }, [slashQuery]);

  useEffect(() => {
    setHighlight(0);
  }, [slashQuery]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    el.style.height = `${Math.max(next, 40)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [value, showTools]);

  const pickTool = (id: ChatPreferTool) => {
    onChange(`/${id} `);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const pos = el.value.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showTools && filtered.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && slashQuery !== null && value.match(/^\/[a-z0-9_]*$/i))) {
        e.preventDefault();
        pickTool(filtered[highlight]?.id || filtered[0].id);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="w-full p-3 md:p-4">
      <div
        className={cn(
          "w-full overflow-hidden rounded-xl border border-border bg-background/70 shadow-sm backdrop-blur-md",
          "transition-[min-height] duration-150"
        )}
      >
        {showTools ? (
          <div className="border-b border-border/60">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 font-mono text-xs text-muted-foreground">
                no match
              </div>
            ) : (
              <ul className="space-y-0.5 px-1.5 py-1.5">
                {filtered.map((tool, idx) => (
                  <li key={tool.id}>
                    {idx > 0 ? (
                      <div
                        aria-hidden
                        className="mx-2 mb-0.5 h-px bg-border/50"
                      />
                    ) : null}
                    <button
                      type="button"
                      disabled={disabled}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => pickTool(tool.id)}
                      className={cn(
                        "flex w-full items-center rounded-lg px-2.5 py-1.5 text-left font-mono text-xs transition-colors",
                        idx === highlight
                          ? "bg-white/10 text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      /{tool.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <div className="flex w-full items-end gap-2 px-3 py-1">
          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={value}
              placeholder="Ask anything — type / for tools"
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              rows={1}
              className="min-h-10 max-h-[200px] w-full resize-none border-none bg-transparent px-0 py-2 font-mono text-base tracking-tight text-foreground outline-none placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:min-h-[52px] md:text-sm [scrollbar-width:thin]"
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
      </div>

      <div className="mt-1 hidden justify-start px-3 md:block">
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          <span>Press</span>
          <kbd className="inline-flex size-4 items-center justify-center rounded border border-border bg-muted">
            <CornerDownLeft className="size-2.5" aria-hidden />
            <span className="sr-only">Enter</span>
          </kbd>
          <span>to send · type</span>
          <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] leading-none">
            /
          </kbd>
          <span>for tools ·</span>
          <kbd className="inline-flex size-4 items-center justify-center rounded border border-border bg-muted">
            <ArrowBigUp className="size-2.5" strokeWidth={2.5} aria-hidden />
            <span className="sr-only">Shift</span>
          </kbd>
          <span>+</span>
          <kbd className="inline-flex size-4 items-center justify-center rounded border border-border bg-muted">
            <CornerDownLeft className="size-2.5" aria-hidden />
            <span className="sr-only">Enter</span>
          </kbd>
          <span>for newline</span>
        </p>
      </div>
    </div>
  );
}

export default ChatMessageInput;
