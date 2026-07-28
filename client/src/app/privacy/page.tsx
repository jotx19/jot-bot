import type { Metadata } from "next";
import { SitePage } from "@/components/site-page";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Privacy Policy",
  description:
    "tinyjot is an open-source educational project. Integrations are user-owned; we do not sell data or commercial services.",
  path: "/privacy",
  index: true,
});

export default function PrivacyPage() {
  return (
    <SitePage title="Privacy Policy">
      <p>Last updated: July 28, 2026</p>
      <p>
        tinyjot (“we”, “us”) is an{" "}
        <strong>open-source educational project</strong> for building a
        self-contained, self-hosted personal AI agent. It is{" "}
        <strong>not a commercial product</strong>. We do not sell tinyjot as a
        service, we do not monetize your data, and we do not intend to use your
        information for advertising, profiling, or resale.
      </p>
      <p>
        A public demo may run at{" "}
        <a href="https://tinyjot.jotx.space/">https://tinyjot.jotx.space/</a> so
        people can try the software. Hosting that demo does not change the
        project’s purpose: learn, experiment, and keep a private agent under{" "}
        <em>your</em> control.
      </p>

      <h2>User-owned data &amp; integrations</h2>
      <p>
        Everything in tinyjot is <strong>user-based and scoped to your
        account</strong>. Integrations (Google Sign-In, Google Health, Discord,
        MCP servers, OpenRouter / BYOK keys, sandbox scripts, and similar
        connections) are authorized <strong>by you</strong>, for{" "}
        <strong>your</strong> use only. We do not harvest those connections to
        build a shared dataset, train models for others, or operate a business
        on top of your personal information.
      </p>
      <ul>
        <li>
          Tokens and settings you connect stay attached to your user account.
        </li>
        <li>
          Other users cannot see your chats, health data, Discord config, or API
          keys.
        </li>
        <li>
          We do not sell, rent, or trade personal data with third parties for
          marketing.
        </li>
      </ul>

      <h2>What may be stored (so the agent works for you)</h2>
      <p>
        To run a self-contained agent, the instance you use may store data{" "}
        <strong>only to provide the features you use</strong>:
      </p>
      <ul>
        <li>
          <strong>Account</strong> — username, password hash (if used), or
          Google account id / email / name if you sign in with Google.
        </li>
        <li>
          <strong>Chat &amp; memory</strong> — messages and optional memory so
          conversations can continue for you.
        </li>
        <li>
          <strong>Settings</strong> — preferences you save (bot name, Discord
          IDs, retention, BYOK keys you enter, MCP configs, etc.).
        </li>
        <li>
          <strong>Integrations</strong> — OAuth tokens or credentials you
          authorize (e.g. Google Health, Discord), stored per user so those
          tools work for that account only.
        </li>
        <li>
          <strong>Automation</strong> — sandbox scripts and job metadata you
          create.
        </li>
        <li>
          <strong>Technical logs</strong> — basic server logs for reliability.
          No advertising trackers.
        </li>
      </ul>

      <h2>Cookies &amp; local storage</h2>
      <p>Browser storage is first-party and functional only:</p>
      <ul>
        <li>
          <strong>Auth / session</strong> — so you stay signed in.
        </li>
        <li>
          <strong>Preferences</strong> — theme and similar UI choices.
        </li>
      </ul>
      <p>
        No ads or cross-site tracking cookies. Clearing storage may require
        signing in again.
      </p>

      <h2>How data is used</h2>
      <ul>
        <li>
          Operate chat, memory, tools, automation, health, and Discord{" "}
          <em>for your account</em>
        </li>
        <li>Authenticate you and keep the demo instance working</li>
        <li>Debug outages on the educational / open-source deployment</li>
      </ul>
      <p>
        We do <strong>not</strong> use personal data to sell services, run ads,
        or transfer it for commercial purposes.
      </p>

      <h2>Third parties you choose</h2>
      <p>
        When you chat or connect an integration, requests may go to providers{" "}
        <strong>you</strong> enable (for example OpenRouter with your key,
        Google Health under your Google account, Discord under your bot /
        guild). Those providers process data under{" "}
        <em>their</em> policies. tinyjot only passes what is needed to fulfill
        the action you started — it does not collect that data to use somewhere
        else.
      </p>

      <h2>Data retention</h2>
      <p>
        Retention follows settings you choose (when available). You can delete
        chats in the app. To request account deletion on the hosted demo, email{" "}
        <a href="mailto:singh20x7@gmail.com">singh20x7@gmail.com</a>.
      </p>

      <h2>Open source &amp; self-hosting</h2>
      <p>
        tinyjot is open source for everyone. If you self-host, you control that
        deployment and its data. Source:{" "}
        <a
          href="https://github.com/jotx19/jot-bot"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/jotx19/jot-bot
        </a>
        .
      </p>

      <h2>Contact</h2>
      <p>
        Privacy questions:{" "}
        <a href="mailto:singh20x7@gmail.com">singh20x7@gmail.com</a>
      </p>
    </SitePage>
  );
}
