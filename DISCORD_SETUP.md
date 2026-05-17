# Discord Bot Setup for qwen-agent

## 1. Create a Discord application

1. Go to [https://discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** and name it (e.g. `qwen-agent`)

## 2. Create the bot

1. Open the **Bot** tab
2. Click **Add Bot**
3. Click **Reset Token** and copy the token
4. Paste it in your `.env` file:

```env
DISCORD_BOT_TOKEN=your_bot_token_here
```

## 3. Enable Privileged Gateway Intents

Under **Bot → Privileged Gateway Intents**, enable:

- **Message Content Intent** (required — bot reads message text)
- **Server Members Intent** (optional, for future features)

Save changes.

## 4. Invite the bot to your server

1. Go to **OAuth2 → URL Generator**
2. **Scopes:** check `bot`
3. **Bot Permissions:** enable at minimum:
   - Send Messages
   - Read Messages / View Channels
   - Read Message History
4. Copy the generated URL, open it in your browser, and add the bot to your server

## 5. Configure environment

Add to `.env` (optional guild id for reference):

```env
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_GUILD_ID=your_server_id_optional
```

Ensure these are also set for full agent features:

```env
OPENROUTER_API_KEY=...
MONGODB_URI=...
```

## 6. Start the app

```bash
npm install
npm start
```

You should see:

```
[qwen-agent] listening on http://localhost:3000
[discord] bot online as qwen-agent#1234
```

If `DISCORD_BOT_TOKEN` is missing:

```
[discord] skipped — no DISCORD_BOT_TOKEN set
```

## 7. Deploy on Render

1. Add `DISCORD_BOT_TOKEN` in the Render dashboard **Environment** tab
2. Redeploy the service
3. Check logs for `[discord] bot online as ...`

## 8. Chat with the bot

- **In a server:** `@mention` the bot  
  Example: `@qwen-agent what is the capital of France?`
- **In DMs:** open a direct message with the bot and send any text

### Example behaviors

| You send | Bot replies |
|----------|-------------|
| `@bot what is the capital of France` | 💬 Paris is the capital of France. |
| `@bot remember that I prefer short answers` | 📝 Got it! I'll keep my answers short for you. |
| `@bot search latest AI news` | 🔍 [summarized web results] |
| `@bot what did I tell you before` | 🧠 You told me you prefer short answers. |

## Intent badges

| Badge | Intent |
|-------|--------|
| 💬 | CHAT — general conversation |
| 🧠 | RECALL — past conversation memory |
| 📝 | LEARN — saved facts about you |
| 🔧 | TASK — tools (calculator, summarize, etc.) |
| 🔍 | SEARCH — web search |

## Session memory

Each Discord user gets a persistent session: `{userId}-discord`

Memory is stored in the same MongoDB database as the web UI, so facts learned on the web or in Discord stay in sync when using the same backing services.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Bot online but ignores messages | Enable **Message Content Intent** in the Developer Portal |
| `disallowed intents` error | Add `Message Content` intent and restart |
| Rate limit / OpenRouter errors | Wait 1–2 minutes or check `OPENROUTER_API_KEY` |
| Bot does not start on Render | Set `DISCORD_BOT_TOKEN` in Render env vars |
