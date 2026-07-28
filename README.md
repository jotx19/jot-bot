# jot-bot (tinyjot)

Personal AI runtime you host yourself. It routes intent, remembers what matters, searches the web, runs tools, and can schedule vetted sandbox automations — via **web chat** and **Discord**.

No SaaS subscription: bring your own [OpenRouter](https://openrouter.ai) key (free models work), MongoDB, and optional Discord bot.

## Features

| Area | What it does |
|------|----------------|
| **Chat** | Web UI + Discord (@mention / DM) |
| **Memory** | Graph facts in MongoDB; optional Qdrant vector RAG |
| **Search** | Live web / stocks / Wikipedia via Serper, Yahoo, DuckDuckGo |
| **Tools** | Calculator, URL summarize, recruiter email lookup, per-user MCP servers |
| **Automation** | Connect a remote script library; install, schedule, pause, change interval, Discord notify |
| **Accounts** | Register / login; chats scoped per user |
| **Settings UI** | Discord, Automation library URL, MCP — no `.env` for those |
| **Scheduler pings** | Posts script stdout to your Discord channel and @you |

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

Open **http://localhost:3000** (Next.js UI). API runs on **http://localhost:5050**.

1. **Register** an account  
2. Open **Settings** → set your Discord User ID + notify Channel ID  
3. Open **Settings → Automation** and paste a library pack URL (see below), then **Automation → Connect**  
4. Chat on the web, or invite the bot and `@` it on Discord  

```bash
npm start   # production
```

## Automation library

Sandbox scripts are **not** generated from chat. You connect a public GitHub pack (raw URL) and install vetted `.mjs` scripts. The Script library stays empty until a repo URL is set and connected.

**Starter pack:** [jotx19/tinyjot-automations](https://github.com/jotx19/tinyjot-automations)

Copy this into **Settings → Automation → Library repo URL**:

```
https://raw.githubusercontent.com/jotx19/tinyjot-automations/main
```

That root must contain `catalog.json` + `scripts/*.mjs` (+ optional `RULE.md` for AI authoring).

Then on **Automation**:

1. Click **Connect** (turns green when the catalog loads)  
2. **Get** a script into your sandbox  
3. Pause / resume / delete in the UI, or from chat:

| Chat | Example |
|------|---------|
| List | `list my scripts` |
| Pause / resume | `pause health_discord_digest` |
| Change interval | `set health_discord_digest every 5 minutes` |

**Custom packs:** fork the starter repo, add entries to `catalog.json`, follow `RULE.md` in that repo, then point Settings at your raw `main` URL.

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
| `AUTOMATION_LIBRARY_CACHE_MS` | No | Remote catalog cache TTL (default 5m) |

\*Without MongoDB, account Settings and durable memory are limited. Legacy `AUTH_PASSWORD` only applies when Mongo is down.

**Discord allowlist, notify channel, and Automation library URL** belong in the web **Settings** page after login. Optional `.env` fallbacks: `DISCORD_ALLOWED_USER_IDS`, `DISCORD_NOTIFY_CHANNEL_ID`.

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
- `TASK` — tools / sandbox scripts (list, pause, resume, change interval)  

## Deploy (Render)

`render.yaml` targets the free web plan. Set env vars in the Render dashboard (`OPENROUTER_API_KEY`, `MONGODB_URI`, `AUTH_SECRET`, `DISCORD_BOT_TOKEN`, `APP_URL`, …).

**Note:** Free Render spins down after ~15 minutes idle (cold start ~1 min). For always-on Discord, use a keep-alive ping to `/health`, a paid instance, or a small always-on VM.

## Project layout

```
server.js           Express API
client/             Next.js chat UI
core/               LLM, intent, memory, auth, users
db/                 MongoDB (+ Qdrant client)
tools/              Built-in tools + sandbox scheduler / library client
interfaces/         Discord bot
```

## API (high level)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health + DB status |
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Login (cookie) |
| `GET` | `/api/auth/me` | Session + invite URL |
| `GET/PUT` | `/api/settings` | Per-user settings (Discord, library URL, MCP, …) |
| `POST` | `/api/chat` | Chat (JSON or SSE stream) |
| `GET` | `/api/session/:id` | Restore chat history |
| `GET` | `/api/sandbox/library` | Scripts from connected library URL |
| `POST` | `/api/sandbox/library/:id/install` | Install into sandbox |
| `POST` | `/api/sandbox/scripts/:name/interval` | Change schedule interval |

## Next.js client

The chat UI lives in [`client/`](./client):

```bash
# API (:5050)
npm run dev

# UI (:3000) — separate terminal
cd client && npm run dev
```

See [client/README.md](./client/README.md) for Google JWT auth, streaming, and env setup.
