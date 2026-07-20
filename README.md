# jot-bot (tinyjot)

Personal AI runtime you host yourself. It routes intent, remembers what matters, searches the web, runs tools, and can write and schedule its own sandbox scripts — via **web chat** and **Discord**.

No SaaS subscription: bring your own [OpenRouter](https://openrouter.ai) key (free models work), MongoDB, and optional Discord bot.

## Features

| Area | What it does |
|------|----------------|
| **Chat** | Web UI + Discord (@mention / DM) |
| **Memory** | Graph facts in MongoDB; optional Qdrant vector RAG |
| **Search** | Live web / stocks / Wikipedia via Serper, Yahoo, DuckDuckGo |
| **Tools** | Calculator, URL summarize, recruiter email lookup |
| **Self-build** | LLM writes Node scripts, save to sandbox, run or schedule |
| **Accounts** | Register / login; chats scoped per user |
| **Settings UI** | Discord allowlist + notify channel — no `.env` edits for those |
| **Scheduler pings** | Posts script output to your Discord channel and @you |

## Quick start

**Requirements:** Node.js 18+, MongoDB (e.g. [Atlas free](https://www.mongodb.com/cloud/atlas))

```bash
git clone https://github.com/jotx19/jot-bot.git
cd jot-bot
cp .env.example .env
# edit .env — at least OPENROUTER_API_KEY and MONGODB_URI
npm install
npm run dev
```

Open **http://localhost:3000**

1. **Register** an account  
2. Open **Settings** → set your Discord User ID + notify Channel ID  
3. Chat on the web, or invite the bot and `@` it on Discord  

```bash
npm start   # production
```

## Environment

Copy `.env.example` → `.env`. Important variables:

| Variable | Required | Notes |
|----------|----------|--------|
| `OPENROUTER_API_KEY` | Yes | LLM + optional embeddings |
| `OPENROUTER_MODEL` | No | Default `openrouter/free` |
| `MONGODB_URI` | Yes* | Sessions, users, memory, sandbox scripts |
| `AUTH_SECRET` | Prod | Signs login cookies |
| `DISCORD_BOT_TOKEN` | For Discord | One bot per deploy |
| `DISCORD_INVITE_URL` | No | “Add to Discord” button/banner in chat |
| `DISCORD_CLIENT_ID` | No | Builds invite URL if `DISCORD_INVITE_URL` unset |
| `BOT_NAME` / `BOT_PERSONA` | No | Identity in replies |
| `SERPER_API_KEY` | No | Better web search |
| `HUNTER_API_KEY` | No | Recruiter email enrichment |
| `QDRANT_URL` / `QDRANT_API_KEY` | No | Vector recall |
| `APP_URL` | Prod | CORS / OpenRouter referer |

\*Without MongoDB, account Settings and durable memory are limited. Legacy `AUTH_PASSWORD` only applies when Mongo is down.

**Discord allowlist & notify channel** belong in the web **Settings** page after login. Optional `.env` fallbacks: `DISCORD_ALLOWED_USER_IDS`, `DISCORD_NOTIFY_CHANNEL_ID`.

## Discord setup

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications)  
2. Enable **Message Content Intent**  
3. Set `DISCORD_BOT_TOKEN` (and optionally `DISCORD_INVITE_URL`)  
4. Use **Add to Discord** in the web UI, or open your OAuth invite link  
5. In **Settings**, paste your Discord **User ID** (Developer Mode → Copy User ID)  
6. Only allowlisted users can chat with the bot  

More detail: [DISCORD_SETUP.md](./DISCORD_SETUP.md)

## Intents

Messages are classified and routed:

- `CHAT` — general conversation  
- `LEARN` — remember a fact  
- `RECALL` — past context / memory  
- `SEARCH` — live information  
- `TASK` — tools / sandbox scripts  

## Deploy (Render)

`render.yaml` targets the free web plan. Set env vars in the Render dashboard (`OPENROUTER_API_KEY`, `MONGODB_URI`, `AUTH_SECRET`, `DISCORD_BOT_TOKEN`, `APP_URL`, …).

**Note:** Free Render spins down after ~15 minutes idle (cold start ~1 min). For always-on Discord, use a keep-alive ping to `/health`, a paid instance, or a small always-on VM.

## Project layout

```
server.js           Express API + static UI
core/               LLM, intent, memory, auth, users
db/                 MongoDB (+ Qdrant client)
tools/              Built-in tools + sandbox scheduler
interfaces/         Discord bot
public/             Web chat, settings, register
```

## API (high level)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health + DB status |
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Login (cookie) |
| `GET` | `/api/auth/me` | Session + invite URL |
| `GET/PUT` | `/api/settings` | Per-user Discord settings |
| `POST` | `/api/chat` | Chat (JSON or SSE stream) |
| `GET` | `/api/session/:id` | Restore chat history |

## License

Use and modify for your own personal runtime. Add a `LICENSE` file if you publish under a specific license.
