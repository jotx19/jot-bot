"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, TerminalIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type CodeBlockProps = {
  code: string;
  language?: string;
  className?: string;
};

export function CodeBlock({ code, language, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      /* ignore */
    }
  };

  const lang = (language || "bash").trim() || "bash";

  return (
    <div
      className={cn(
        "my-2 overflow-hidden rounded-xl border border-white/10 bg-[#0c0c0c] text-left shadow-sm",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#141414] px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <TerminalIcon className="size-3.5 shrink-0 text-emerald-400/90" />
          <span className="truncate font-mono text-[11px] text-neutral-400">
            {lang}
          </span>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => void onCopy()}
              aria-label={copied ? "Copied" : "Copy code"}
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-md transition-colors",
                copied
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "text-neutral-400 hover:bg-white/10 hover:text-neutral-100"
              )}
            >
              <span className="relative size-3.5">
                <CopyIcon
                  className={cn(
                    "absolute inset-0 size-3.5 transition-all duration-200",
                    copied
                      ? "scale-50 opacity-0"
                      : "scale-100 opacity-100"
                  )}
                />
                <CheckIcon
                  className={cn(
                    "absolute inset-0 size-3.5 text-emerald-400 transition-all duration-200",
                    copied
                      ? "scale-100 opacity-100"
                      : "scale-50 opacity-0"
                  )}
                />
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {copied ? "Copied" : "Copy"}
          </TooltipContent>
        </Tooltip>
      </div>

      <pre className="max-h-[28rem] overflow-auto p-3 font-mono text-[12px] leading-relaxed text-neutral-200 [scrollbar-width:thin]">
        <code className="whitespace-pre">{code.replace(/\n$/, "")}</code>
      </pre>
    </div>
  );
}

export type ContentPart =
  | { type: "text"; value: string }
  | { type: "code"; language: string; value: string };

/** Split markdown-ish content into text + fenced code parts. */
export function parseMessageParts(content: string): ContentPart[] {
  if (!content) return [];

  const parts: ContentPart[] = [];
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(content)) !== null) {
    if (match.index > last) {
      parts.push({ type: "text", value: content.slice(last, match.index) });
    }
    parts.push({
      type: "code",
      language: (match[1] || "").trim(),
      value: match[2] ?? "",
    });
    last = match.index + match[0].length;
  }

  const rest = content.slice(last);
  const openIdx = rest.indexOf("```");
  if (openIdx !== -1) {
    const before = rest.slice(0, openIdx);
    if (before) parts.push({ type: "text", value: before });

    const after = rest.slice(openIdx + 3);
    const nl = after.indexOf("\n");
    if (nl === -1) {
      parts.push({ type: "code", language: after.trim(), value: "" });
    } else {
      parts.push({
        type: "code",
        language: after.slice(0, nl).trim(),
        value: after.slice(nl + 1),
      });
    }
  } else if (rest) {
    parts.push({ type: "text", value: rest });
  }

  return parts.length ? parts : [{ type: "text", value: content }];
}

