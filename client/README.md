# tinyjot Next.js client

Modern chat UI for the jot-bot Express backend.

## Stack

- **Next.js 15** (App Router)
- **shadcn-style** UI (Radix + Tailwind)
- **Zustand** — auth + sidebar UI state
- **TanStack Query** — sessions / settings cache
- **Axios** — hardened API client (JWT bearer + timeouts)
- **fetch SSE** — streaming chat (faster first token)
- **Hugeicons**
- **Google Identity Services** → backend `/api/auth/google` → **JWT**

## Run

Terminal 1 (API on `:5050`):

```bash
cd ..
npm run dev
```

Terminal 2 (client on `:3000`):

```bash
cd client
npm run dev
```

Open http://localhost:3000

## Env

**Client** (`client/.env.local`):

```
NEXT_PUBLIC_API_URL=http://localhost:5050
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
```

**API** (repo root `.env`):

```
PORT=5050
GOOGLE_CLIENT_ID=your-google-oauth-web-client-id
CLIENT_URL=http://localhost:3000
APP_URL=http://localhost:3000
AUTH_SECRET=long-random-string
```

Google Cloud Console → OAuth 2.0 Web client → Authorized JavaScript origins: `http://localhost:3000`

## Pages

| Route | Purpose |
|-------|---------|
| `/login` | Google + username/password |
| `/chat` | New session |
| `/chat/[sessionId]` | Streaming chat |
| `/settings` | Discord allowlist / notify |

## Faster responses

1. **SSE streaming** — tokens render as they arrive (`stream-chat.ts`)
2. **Optimistic user bubble** — message shows before the server replies
3. **TanStack cache** — sidebar sessions / settings stay warm
4. **Axios only for metadata** — chat path skips axios overhead
