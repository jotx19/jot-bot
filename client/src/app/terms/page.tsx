import type { Metadata } from "next";
import { SitePage } from "@/components/site-page";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Terms of Service",
  description:
    "Terms for tinyjot — an open-source educational self-hosted AI agent. Not a commercial service; integrations are user-owned.",
  path: "/terms",
  index: true,
});

export default function TermsPage() {
  return (
    <SitePage title="Terms of Service">
      <p>Last updated: July 28, 2026</p>
      <p>
        These terms cover use of tinyjot — an{" "}
        <strong>open-source educational project</strong> for a self-contained,
        personal AI agent. Software and a public demo (for example at{" "}
        <a href="https://tinyjot.jotx.space/">https://tinyjot.jotx.space/</a>)
        are provided so people can learn and experiment.{" "}
        <strong>tinyjot is not a commercial product</strong>: we do not sell
        subscriptions, hosted “AI as a service,” or paid plans, and we have no
        intent to commercialize your data.
      </p>
      <p>
        The project is <strong>under active development</strong>; features may
        change, break, or be removed without notice.
      </p>

      <h2>Acceptance</h2>
      <p>
        By creating an account or using tinyjot you agree to these terms and our{" "}
        <a href="/privacy">Privacy Policy</a>. If you do not agree, do not use
        the software or demo.
      </p>

      <h2>Nature of the project</h2>
      <ul>
        <li>
          <strong>Educational / open source</strong> — built to demonstrate a
          self-contained hosted agent you can run yourself.
        </li>
        <li>
          <strong>Not for sale</strong> — we do not offer tinyjot as a paid
          service and do not sell personal data.
        </li>
        <li>
          <strong>User-based integrations</strong> — Google Health, Discord,
          MCP, BYOK keys, and similar connections are authorized by each user
          for that user’s account only. They are not shared across users or
          reused by us for other purposes.
        </li>
      </ul>

      <h2>The software &amp; demo</h2>
      <p>
        tinyjot provides chat with an AI agent, optional memory, tools, sandbox
        automation, health integrations, and Discord bridging. A hosted demo may
        be invite-only or rate limited. We may suspend accounts that abuse shared
        demo infrastructure so the educational instance stays usable for
        everyone.
      </p>

      <h2>Accounts &amp; security</h2>
      <ul>
        <li>Keep your password and API keys confidential</li>
        <li>You are responsible for activity under your account</li>
        <li>
          Do not attempt to access other users’ data or disrupt shared demo
          infrastructure
        </li>
      </ul>

      <h2>Acceptable use</h2>
      <p>You agree not to use tinyjot to:</p>
      <ul>
        <li>Violate applicable laws or third-party rights</li>
        <li>Spam, harass, or distribute malware</li>
        <li>
          Overload sandbox execution, schedulers, Discord bots, or APIs beyond
          fair educational use
        </li>
        <li>Probe, scrape, or attack the demo or other users</li>
      </ul>

      <h2>Your content, integrations &amp; API keys</h2>
      <p>
        You retain ownership of content you submit. On a hosted demo, you grant
        only a limited license to process that content{" "}
        <strong>so the agent can work for your account</strong> — not to sell
        it, train unrelated products, or transfer it for commercial gain.
      </p>
      <p>
        Integrations and third-party API keys (Google, Discord, OpenRouter,
        MCP, etc.) are <strong>yours</strong>. You are responsible for prompts
        you send and for keys you supply. Do not upload secrets you are not
        allowed to use.
      </p>

      <h2>Third-party services</h2>
      <p>
        Model providers, Google, Discord, databases, and hosting partners have
        their own terms. When you connect them through tinyjot, you do so under
        those terms. tinyjot does not claim ownership of your third-party
        accounts or data.
      </p>

      <h2>Disclaimer</h2>
      <p>
        The software and demo are provided <strong>“as is”</strong> without
        warranties of any kind, including for fitness as a commercial service.
        AI outputs may be wrong, incomplete, or unsafe to rely on without
        review. We are not liable for decisions you make based on assistant
        replies, script runs, health insights, or Discord messages.
      </p>

      <h2>Open source &amp; contributions</h2>
      <p>
        tinyjot is open source for all. You are welcome to raise issues, open
        pull requests, and contribute on GitHub:{" "}
        <a
          href="https://github.com/jotx19/jot-bot"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/jotx19/jot-bot
        </a>
        . Contributions are typically accepted under the project’s existing
        license; by submitting a PR you agree your contribution may be included
        in the project.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms as the educational project evolves. Continued
        use after changes are posted means you accept the updated terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href="mailto:singh20x7@gmail.com">singh20x7@gmail.com</a>
      </p>
    </SitePage>
  );
}
