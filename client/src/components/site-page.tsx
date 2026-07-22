import type { ReactNode } from "react";
import Link from "next/link";
import { TinyjotLogo } from "@/components/tinyjot-logo";
import { SiteFooter } from "@/components/site-footer";

export function SitePage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col bg-[#E8E4DC] text-[#0a0a0a] dark:bg-[#050505] dark:text-[#f5f5f7]">
      <header className="border-b border-black/10 dark:border-white/10">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <TinyjotLogo size="sm" />
            <span className="text-sm font-semibold tracking-tight">tinyjot</span>
          </Link>
          <Link
            href="/"
            className="text-sm text-neutral-600 underline-offset-4 hover:underline dark:text-neutral-400"
          >
            Back home
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-14 md:py-20">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <div className="prose-legal mt-8 space-y-4 text-[15px] leading-relaxed text-neutral-700 dark:text-neutral-300 [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4">
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
