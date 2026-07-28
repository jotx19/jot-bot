import type { Metadata } from "next";
import Link from "next/link";
import { SitePage } from "@/components/site-page";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "About tinyjot",
  description:
    "tinyjot is a personal AI chat agent with persistent memory, tools, Google Health, automation, and Discord.",
  path: "/about",
  index: true,
});

export default function AboutPage() {
  return (
    <SitePage title="tinyjot">
      <p>
        <strong>tinyjot</strong> is a personal AI chat agent. Its purpose is to
        give you a private place to chat with an AI that keeps memory across
        sessions, runs sandbox tools and scheduled automation, can show Google
        Health insights when you connect them, and can bridge to Discord when
        you want the same agent there.
      </p>
      <p>
        Sign in with Google to create or access your own tinyjot account. Google
        account data is used only to authenticate you. If you connect Google
        Health, tinyjot reads health metrics you authorize so you can view them
        in your dashboard and talk about them with the agent. You can disconnect
        integrations at any time.
      </p>
      <p>
        tinyjot is an open-source educational project for self-hosted personal
        agents. It is not a commercial product and does not sell your data.
      </p>
      <p>
        <Link href="/privacy">Privacy Policy</Link>
        {" · "}
        <Link href="/terms">Terms of Service</Link>
        {" · "}
        <Link href="/contact">Contact</Link>
        {" · "}
        <Link href="/">Home</Link>
      </p>
    </SitePage>
  );
}
