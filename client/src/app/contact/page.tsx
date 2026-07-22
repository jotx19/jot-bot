import { SitePage } from "@/components/site-page";

export const metadata = { title: "Contact Us · tinyjot" };

export default function ContactPage() {
  return (
    <SitePage title="Contact Us">
      <p>
        tinyjot is an open-source personal AI runtime under active development.
        Reach out for access questions, account help, or product feedback.
      </p>

      <h2>Email</h2>
      <p>
        <a href="mailto:singh20x7@gmail.com">singh20x7@gmail.com</a>
      </p>

      <h2>Contribute</h2>
      <p>
        Found a bug or want to ship a feature? Open an issue or raise a pull
        request on GitHub — contributions are welcome.
      </p>
      <p>
        Repository:{" "}
        <a
          href="https://github.com/jotx19/jot-bot"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/jotx19/jot-bot
        </a>
      </p>
      <ul>
        <li>Fork the repo and create a branch</li>
        <li>Open a PR with a clear description of the change</li>
        <li>Keep PRs focused — smaller reviews ship faster</li>
      </ul>

      <h2>Self-hosting</h2>
      <p>
        Prefer to run your own instance? Clone the repo, copy{" "}
        <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[13px] dark:bg-white/10">
          .env.example
        </code>{" "}
        to{" "}
        <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[13px] dark:bg-white/10">
          .env
        </code>
        , and follow the README quick start.
      </p>
    </SitePage>
  );
}
