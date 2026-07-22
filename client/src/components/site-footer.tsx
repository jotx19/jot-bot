import Link from "next/link";
import { TinyjotLogo } from "@/components/tinyjot-logo";

/** Compact footer — logo far left, vertical Site / Privacy columns on the right. */
export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-black text-white">
      <div className="mx-auto flex max-w-6xl items-start justify-between gap-8 px-5 py-6 md:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <TinyjotLogo size="sm" />
          <span className="text-xs font-semibold tracking-tight">tinyjot</span>
        </Link>

        <div className="flex items-start gap-8 md:gap-12">
          <div
            className="hidden h-14 w-px shrink-0 bg-white/15 sm:block"
            aria-hidden
          />
          <div className="flex gap-10 md:gap-14">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.14em] uppercase">
                Site
              </p>
              <ul className="mt-2.5 space-y-1.5 text-xs text-white/85">
                <li>
                  <Link
                    href="/contact"
                    className="transition-colors hover:text-white"
                  >
                    Contact Us
                  </Link>
                </li>
                <li>
                  <Link
                    href="/#features"
                    className="transition-colors hover:text-white"
                  >
                    Features
                  </Link>
                </li>
                <li>
                  <a
                    href="https://github.com/jotx19/jot-bot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-colors hover:text-white"
                  >
                    Contribute
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-semibold tracking-[0.14em] uppercase">
                Privacy
              </p>
              <ul className="mt-2.5 space-y-1.5 text-xs text-white/85">
                <li>
                  <Link
                    href="/terms"
                    className="transition-colors hover:text-white"
                  >
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link
                    href="/privacy"
                    className="transition-colors hover:text-white"
                  >
                    Privacy Policy
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
