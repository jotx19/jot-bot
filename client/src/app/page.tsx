"use client";

import Link from "next/link";
import Image from "next/image";
import { useAuthStore } from "@/stores/app-store";
import { TinyjotLogo } from "@/components/tinyjot-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { SiteFooter } from "@/components/site-footer";
import { cn } from "@/lib/utils";

export default function LandingPage() {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const primaryHref = user ? "/chat" : "/login";
  const primaryLabel = user ? "Open chat" : "Get started";

  return (
    <div className="flex min-h-svh flex-col bg-[#E8E4DC] text-[#0a0a0a] dark:bg-[#050505] dark:text-[#f5f5f7]">
      {/* Nav */}
      <header className="absolute inset-x-0 top-0 z-30">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:h-20 md:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <TinyjotLogo size="md" />
            <span className="text-[15px] font-semibold tracking-tight text-white drop-shadow-sm">
              tinyjot
            </span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="rounded-full border border-white/20 bg-black/25 p-0.5 backdrop-blur-md [&_button]:text-white [&_.border-border]:border-white/20">
              <ThemeToggle />
            </div>
            {hydrated && (
              <Link
                href={primaryHref}
                className={cn(
                  "inline-flex h-9 items-center rounded-full px-4 text-sm font-medium",
                  "bg-white text-neutral-900 transition-colors hover:bg-white/90"
                )}
              >
                {user ? "Open chat" : "Sign in"}
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col">
        {/* Hero — one composition */}
        <section className="relative flex min-h-svh items-end overflow-hidden">
          <Image
            src="/hero-bg.jpeg"
            alt=""
            fill
            priority
            className="landing-hero-image object-cover object-center"
            sizes="100vw"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-linear-to-t from-black/80 via-black/35 to-black/20"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-linear-to-r from-black/40 via-transparent to-transparent"
          />

          <div className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-16 pt-28 md:px-8 md:pb-24 md:pt-32">
            <div className="landing-hero-copy max-w-xl">
              <p className="mb-4 text-sm font-medium tracking-[0.18em] text-white/70 uppercase">
                tinyjot
              </p>
              <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl md:text-6xl">
                Your personal AI, ready when you are.
              </h1>
              <p className="mt-5 max-w-md text-base leading-relaxed text-white/75 sm:text-lg">
                Chat with memory, tools, and Discord — a private runtime that
                stays yours.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href={primaryHref}
                  className={cn(
                    "inline-flex h-11 items-center justify-center rounded-full px-6",
                    "bg-white text-sm font-semibold text-neutral-900",
                    "transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  )}
                >
                  {hydrated ? primaryLabel : "Get started"}
                </Link>
                {!user && (
                  <Link
                    href="/login"
                    className={cn(
                      "inline-flex h-11 items-center justify-center rounded-full px-6",
                      "border border-white/35 bg-white/10 text-sm font-medium text-white backdrop-blur-sm",
                      "transition-colors hover:bg-white/15"
                    )}
                  >
                    Sign in
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* One job: what it is */}
        <section
          id="features"
          className="mx-auto w-full max-w-6xl flex-1 scroll-mt-20 px-5 py-20 md:px-8 md:py-28"
        >
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Built for one person, you.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-neutral-600 dark:text-neutral-400 sm:text-lg">
              tinyjot keeps chats, remembers context, runs sandbox tools, and can
              talk to Discord when you need it. No dashboard clutter just a
              focused place to think with an agent that already knows your setup.
            </p>
          </div>

          <ul className="mt-14 grid gap-10 sm:grid-cols-3">
            {[
              {
                title: "Persistent memory",
                body: "Sessions that last days, not a tab close.",
              },
              {
                title: "Tools & automation",
                body: "Sandbox scripts and scheduled runs when you want them.",
              },
              {
                title: "Discord bridge",
                body: "Same agent, reachable from the channels you already use.",
              },
            ].map((item) => (
              <li key={item.title} className="landing-feature">
                <h3 className="text-sm font-semibold tracking-tight">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <SiteFooter />
    </div>
  );
}
