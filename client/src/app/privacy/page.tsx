import { SitePage } from "@/components/site-page";

export const metadata = { title: "Privacy Policy · tinyjot" };

export default function PrivacyPage() {
  return (
    <SitePage title="Privacy Policy">
      <p>Last updated: July 22, 2026</p>
      <p>
        tinyjot (“we”, “us”) is an open-source personal AI runtime. This policy
        explains what we collect when you use the hosted or self-hosted product,
        how it is used, and your choices. The project is under active
        development — practices may evolve; we will update this page when they
        do.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account data</strong> — username, password hash (if you
          register with a password), and, if you use Google Sign-In, your Google
          account id, email, and display name.
        </li>
        <li>
          <strong>Chat &amp; memory</strong> — messages you send, assistant
          replies, session metadata, and any memory/facts the product stores so
          conversations can continue.
        </li>
        <li>
          <strong>Settings</strong> — preferences you save (for example Discord
          IDs, notify options, bot name/persona, chat retention, and BYOK /
          OpenRouter settings you enter).
        </li>
        <li>
          <strong>Automation data</strong> — sandbox scripts you create, run
          counts, and related job metadata.
        </li>
        <li>
          <strong>Technical logs</strong> — basic server logs (timestamps,
          errors, request paths) used to keep the service running. We do not use
          advertising trackers.
        </li>
      </ul>

      <h2>Cookies &amp; local storage</h2>
      <p>We use browser storage that is necessary for the product to work:</p>
      <ul>
        <li>
          <strong>Auth / session</strong> — access tokens or session state so
          you stay signed in.
        </li>
        <li>
          <strong>Preferences</strong> — theme (light/dark) and similar UI
          choices.
        </li>
      </ul>
      <p>
        These are first-party, functional cookies / local storage — not ads or
        cross-site tracking cookies. You can clear them in your browser; you may
        need to sign in again afterward.
      </p>

      <h2>How we use data</h2>
      <ul>
        <li>Provide chat, memory, tools, automation, and Discord features</li>
        <li>Authenticate you and secure your account</li>
        <li>Apply the settings you choose</li>
        <li>Debug outages and improve reliability</li>
      </ul>
      <p>We do not sell your personal data.</p>

      <h2>Third parties &amp; model providers</h2>
      <p>
        When you chat, prompts may be sent to model providers you configure
        (for example OpenRouter or other APIs via keys you supply). Those
        providers process data under their own privacy policies. If Discord is
        connected, Discord receives messages and metadata according to Discord’s
        terms. Hosting providers (database, servers) store data you generate so
        the app can function.
      </p>

      <h2>Data retention</h2>
      <p>
        Chat retention follows the period you select in settings (when
        available). You can delete individual chats in the app. Account-level
        deletion can be requested as described below.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live, you may have rights to access, correct, or
        delete personal data. To request a copy of your data or account
        deletion, email{" "}
        <a href="mailto:singh20x7@gmail.com">singh20x7@gmail.com</a>.
      </p>

      <h2>Open source &amp; self-hosting</h2>
      <p>
        tinyjot is open source. If you run your own instance, you (or your
        organization) are the data controller for that deployment. The source is
        on GitHub:{" "}
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
