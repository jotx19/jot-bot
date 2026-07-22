"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { cn } from "@/lib/utils";
import { CodeBlock } from "@/components/chat/code-block";

type ChatMarkdownProps = {
  content: string;
  className?: string;
};

const components: Components = {
  p: ({ children }) => (
    <p className="mb-2.5 last:mb-0 leading-relaxed">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-500 dark:text-blue-400"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="mb-2.5 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2.5 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed [&>p]:mb-0">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-3 text-[15px] font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-2.5 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-2 text-sm font-semibold first:mt-0">{children}</h4>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2.5 border-l-2 border-border pl-3 text-muted-foreground italic last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  table: ({ children }) => (
    <div className="mb-2.5 overflow-x-auto last:mb-0">
      <table className="w-full min-w-[16rem] border-collapse text-left text-[13px]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border text-muted-foreground">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-2 py-1.5 font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-t border-border/60 px-2 py-1.5 align-top">{children}</td>
  ),
  code: ({ className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || "");
    const text = String(children).replace(/\n$/, "");
    const isBlock = Boolean(match) || text.includes("\n");

    if (isBlock) {
      return <CodeBlock code={text} language={match?.[1]} className="my-2" />;
    }

    return (
      <code
        className="rounded-md bg-black/8 px-1 py-0.5 font-mono text-[12px] dark:bg-white/10"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
};

function ChatMarkdownInner({ content, className }: ChatMarkdownProps) {
  return (
    <div
      className={cn(
        "chat-md text-[13.5px] leading-relaxed text-foreground",
        "*:first:mt-0 *:last:mb-0",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const ChatMarkdown = memo(ChatMarkdownInner);
export default ChatMarkdown;
