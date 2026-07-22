import { SitePage } from "@/components/site-page";

export const metadata = { title: "Terms of Service · tinyjot" };

export default function TermsPage() {
  return (
    <SitePage title="Terms of Service">
      <p>Last updated: July 22, 2026</p>
      <p>
        These terms cover use of tinyjot — a personal AI runtime available as
        open-source software and (where offered) a hosted demo. The product is{" "}
        <strong>under active development</strong>; features may change, break, or
        be removed without notice.
      </p>

      <h2>Acceptance</h2>
      <p>
        By creating an account or using tinyjot you agree to these terms and our{" "}
        <a href="/privacy">Privacy Policy</a>. If you do not agree, do not use
        the service.
      </p>

      <h2>The service</h2>
      <p>
        tinyjot provides chat with an AI agent, optional memory, tools, sandbox
        automation, and Discord integration. Access may be invite-only or rate
        limited. We may suspend accounts that abuse the platform.
      </p>

      <h2>Accounts &amp; security</h2>
      <ul>
        <li>Keep your password and API keys confidential</li>
        <li>You are responsible for activity under your account</li>
        <li>
          Do not attempt to access other users’ data or disrupt shared
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
          fair use
        </li>
        <li>Probe, scrape, or attack the service</li>
      </ul>

      <h2>Your content &amp; API keys</h2>
      <p>
        You retain ownership of content you submit. You grant us a limited
        license to process that content solely to operate the features you use.
        You are responsible for prompts you send to models and for any
        third-party API keys (e.g. OpenRouter) you provide. Do not upload secrets
        you are not allowed to use.
      </p>

      <h2>Third-party services</h2>
      <p>
        Model providers, Discord, databases, and hosting partners have their own
        terms. Your use of those services through tinyjot is also subject to
        those terms.
      </p>

      <h2>Disclaimer</h2>
      <p>
        The service is provided <strong>“as is”</strong> without warranties of
        any kind. AI outputs may be wrong, incomplete, or unsafe to rely on
        without review. We are not liable for decisions you make based on
        assistant replies, script runs, or Discord messages.
      </p>

      <h2>Open source &amp; contributions</h2>
      <p>
        tinyjot is open source and in development. You are welcome to raise
        issues, open pull requests, and contribute code or docs on GitHub:{" "}
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
        We may update these terms as the product evolves. Continued use after
        changes are posted means you accept the updated terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href="mailto:singh20x7@gmail.com">singh20x7@gmail.com</a>
      </p>
    </SitePage>
  );
}
