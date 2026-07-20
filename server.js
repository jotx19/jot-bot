import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, getMongoStatus, User, isMongoReady } from './db/mongo.js';
import { ensureCollection, getQdrantStatus } from './db/qdrant.js';
import { storeExchange } from './core/rag.js';
import { loadSession, saveSession, clearSession } from './core/memory.js';
import { loadTools, listTools } from './tools/registry.js';
import { listScheduled, cancel, restoreScheduled } from './tools/sandbox/scheduler.js';
import { isNotifyConfigured } from './tools/sandbox/notify.js';
import { runChatTurn } from './core/runtime.js';
import { normalizeDiscordId, getDiscordInviteUrl } from './core/users.js';
import {
  isAuthEnabled,
  isUserAuthEnabled,
  isLegacyPasswordAuth,
  requireAuth,
  createSessionToken,
  clearSessionCookie,
  setSessionCookie,
  getAuthPayload,
  safeEqualPassword,
  hashPassword,
  verifyPassword,
  publicUser,
  loadRequestUser,
} from './core/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const corsOrigin = process.env.APP_URL?.trim() || true;
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));

/** Scope browser chat sessions per account so users don't share history. */
function scopeSessionId(sessionId, userId) {
  if (!sessionId) return sessionId;
  if (!userId) return sessionId;
  const prefix = `${userId}:`;
  return sessionId.startsWith(prefix) ? sessionId : `${prefix}${sessionId}`;
}

function usernameOk(name) {
  return /^[a-z0-9_]{3,32}$/i.test(String(name || ''));
}

/**
 * Auth status — user accounts when Mongo is up; else legacy AUTH_PASSWORD.
 */
app.get('/api/auth/me', async (req, res) => {
  const payload = getAuthPayload(req);

  let user = null;
  if (payload?.userId && isMongoReady()) {
    try {
      const doc = await User.findById(payload.userId).lean();
      user = publicUser(doc);
    } catch {
      /* ignore */
    }
  }

  return res.json({
    authRequired: isAuthEnabled(),
    userAuth: isUserAuthEnabled(),
    legacyAuth: isLegacyPasswordAuth() && !isUserAuthEnabled(),
    authenticated: isAuthEnabled() ? Boolean(payload) : true,
    user,
    discordBotConfigured: Boolean(process.env.DISCORD_BOT_TOKEN?.trim()),
    discordInviteUrl: getDiscordInviteUrl(),
  });
});

app.post('/api/auth/register', async (req, res) => {
  if (!isMongoReady()) {
    return res.status(503).json({ error: 'Registration requires MongoDB (MONGODB_URI)' });
  }

  const username = String(req.body?.username || '')
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || '');

  if (!usernameOk(username)) {
    return res.status(400).json({
      error: 'Username must be 3–32 chars (letters, numbers, underscore)',
    });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const existing = await User.findOne({ username }).lean();
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const doc = await User.create({
      username,
      passwordHash: hashPassword(password),
      settings: {
        notifyScheduler: true,
        notifyAlways: true,
      },
    });

    const token = createSessionToken(String(doc._id));
    setSessionCookie(res, token);
    return res.json({ ok: true, user: publicUser(doc) });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};

  // User account login (preferred)
  if (isMongoReady() && username) {
    try {
      const doc = await User.findOne({
        username: String(username).trim().toLowerCase(),
      });
      if (!doc || !verifyPassword(password, doc.passwordHash)) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      const token = createSessionToken(String(doc._id));
      setSessionCookie(res, token);
      return res.json({ ok: true, user: publicUser(doc) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Legacy shared password
  if (isLegacyPasswordAuth()) {
    if (!safeEqualPassword(password, process.env.AUTH_PASSWORD)) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    try {
      const token = createSessionToken(null);
      setSessionCookie(res, token);
      return res.json({ ok: true, authRequired: true, legacy: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (!isAuthEnabled()) {
    return res.json({ ok: true, authRequired: false });
  }

  return res.status(400).json({ error: 'Username and password required' });
});

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  return res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  return requireAuth(req, res, next);
});

/**
 * User settings (Discord allowlist + notify channel) — stored in Mongo, not .env.
 */
app.get('/api/settings', async (req, res) => {
  try {
    const user = await loadRequestUser(req);
    if (!user) {
      return res.status(400).json({
        error:
          'Settings require a registered account. Sign out and create an account, or check MongoDB.',
        code: 'USER_REQUIRED',
      });
    }
    return res.json({
      user: publicUser(user),
      discordBotConfigured: Boolean(process.env.DISCORD_BOT_TOKEN?.trim()),
      hints: {
        discordUserId:
          'Discord → Settings → Advanced → Developer Mode → right-click your name → Copy User ID',
        notifyChannelId:
          'Developer Mode → right-click the channel → Copy Channel ID. Bot needs Send Messages there.',
        botToken: 'DISCORD_BOT_TOKEN stays in server .env / Render (one bot per deploy).',
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    if (!req.auth?.userId) {
      return res.status(400).json({
        error: 'Settings require a registered account',
        code: 'USER_REQUIRED',
      });
    }

    const body = req.body || {};
    const $set = { updatedAt: new Date() };

    if (body.discordUserId !== undefined) {
      $set['settings.discordUserId'] = normalizeDiscordId(body.discordUserId);
    }
    if (body.notifyChannelId !== undefined) {
      $set['settings.notifyChannelId'] = normalizeDiscordId(body.notifyChannelId);
    }
    if (body.notifyScheduler !== undefined) {
      $set['settings.notifyScheduler'] = Boolean(body.notifyScheduler);
    }
    if (body.notifyAlways !== undefined) {
      $set['settings.notifyAlways'] = Boolean(body.notifyAlways);
    }
    if (body.botName !== undefined) {
      $set['settings.botName'] = String(body.botName || '').trim().slice(0, 40);
    }

    const doc = await User.findByIdAndUpdate(
      req.auth.userId,
      { $set },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ error: 'User not found' });

    try {
      const discord = await import('./interfaces/discord.js');
      discord.invalidateDiscordAllowlistCache?.();
    } catch {
      /* bot may not be loaded */
    }

    return res.json({ ok: true, user: publicUser(doc) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'qwen-agent',
    timestamp: new Date().toISOString(),
    mongodb: getMongoStatus(),
    qdrant: getQdrantStatus(),
  });
});

app.get('/api/tools', (_req, res) => {
  res.json({ tools: listTools() });
});

app.get('/api/sandbox/scheduled', (_req, res) => {
  res.json({ scheduled: listScheduled() });
});

app.delete('/api/sandbox/scheduled/:name', (req, res) => {
  const ok = cancel(req.params.name);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  return res.json({ cancelled: true });
});

function indexChatTurn(sessionId, message, reply) {
  storeExchange(sessionId, message, reply).catch((err) => {
    console.warn('[rag] indexChatTurn:', err.message);
  });
}

async function resolveHistory(sessionId, history) {
  if (sessionId && (!history || history.length === 0)) {
    const loaded = await loadSession(sessionId);
    if (loaded.length > 0) return loaded;
  }
  return history || [];
}

function persistSession(sessionId, history, message, reply, intent, userId = null) {
  if (!sessionId) return;
  const updated = [
    ...history,
    { role: 'user', content: message },
    { role: 'assistant', content: reply, intent },
  ];
  saveSession(sessionId, updated, userId).catch((err) => {
    console.warn('[memory] persistSession:', err.message);
  });
}

app.get('/api/session/:sessionId', async (req, res) => {
  try {
    const sid = scopeSessionId(req.params.sessionId, req.auth?.userId);
    const messages = await loadSession(sid);
    return res.json({ sessionId: req.params.sessionId, messages });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

async function handleClearSession(req, res) {
  try {
    const sid = scopeSessionId(req.params.sessionId, req.auth?.userId);
    await clearSession(sid);
    return res.json({ sessionId: req.params.sessionId, cleared: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

app.delete('/api/session/:sessionId', handleClearSession);
app.post('/api/session/:sessionId/clear', handleClearSession);

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history = [], sessionId: rawSessionId, stream: wantStream } = req.body;
    const userId = req.auth?.userId || null;
    const sessionId = scopeSessionId(rawSessionId, userId);

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    const chatHistory = await resolveHistory(sessionId, history);

    const useSSE =
      wantStream === true ||
      req.headers.accept === 'text/event-stream';

    if (useSSE) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let fullReply = '';

      const turn = await runChatTurn({
        message,
        history: chatHistory,
        sessionId,
        channel: 'web',
        onToken: (chunk) => {
          fullReply += chunk;
          res.write(`data: ${JSON.stringify({ type: 'token', content: chunk })}\n\n`);
        },
      });

      if (!turn.ok) {
        res.write(
          `data: ${JSON.stringify({
            type: 'error',
            error: turn.error,
            task: turn.task,
          })}\n\n`
        );
        return res.end();
      }

      const result = turn.result;
      const finalReply = result.reply || fullReply;
      indexChatTurn(sessionId, message, finalReply);
      persistSession(sessionId, chatHistory, message, finalReply, result.intent, userId);

      res.write(
        `data: ${JSON.stringify({
          type: 'done',
          intent: result.intent,
          reply: finalReply,
          toolUsed: result.toolUsed ?? null,
          task: turn.task,
        })}\n\n`
      );
      return res.end();
    }

    const turn = await runChatTurn({
      message,
      history: chatHistory,
      sessionId,
      channel: 'web',
    });

    if (!turn.ok) {
      return res.status(500).json({
        error: turn.error,
        task: turn.task,
      });
    }

    const result = turn.result;
    indexChatTurn(sessionId, message, result.reply);
    persistSession(sessionId, chatHistory, message, result.reply, result.intent, userId);
    return res.json({
      intent: result.intent,
      reply: result.reply,
      toolUsed: result.toolUsed ?? null,
      task: turn.task,
    });
  } catch (err) {
    console.error('[api/chat]', err.message);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      return res.end();
    }
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

async function start() {
  try {
    await connectDB();
  } catch (err) {
    console.error('[startup] MongoDB connection failed:', err.message);
  }

  try {
    await ensureCollection();
  } catch (err) {
    console.error('[startup] Qdrant init failed:', err.message);
  }

  try {
    await loadTools();
  } catch (err) {
    console.error('[startup] Tool registry failed:', err.message);
  }

  try {
    await restoreScheduled();
  } catch (err) {
    console.error('[startup] Scheduler restore failed:', err.message);
  }

  const notifyOn = await isNotifyConfigured();
  if (notifyOn) {
    console.log('[notify] Discord scheduler pings enabled (per-user Settings / .env fallback)');
  } else {
    console.log(
      '[notify] off — set DISCORD_BOT_TOKEN + notify channel in Settings (or .env)'
    );
  }

  app.listen(PORT, () => {
    console.log(`[qwen-agent] listening on http://localhost:${PORT}`);
    if (isUserAuthEnabled()) {
      console.log('[auth] user accounts enabled (register / login)');
    } else if (isLegacyPasswordAuth()) {
      console.log('[auth] legacy AUTH_PASSWORD gate');
    } else if (process.env.NODE_ENV === 'production') {
      console.warn('[auth] WARNING: no auth — set MONGODB_URI for accounts');
    } else {
      console.log('[auth] open (dev) — connect MongoDB to enable accounts');
    }
  });

  if (process.env.DISCORD_BOT_TOKEN) {
    import('./interfaces/discord.js')
      .then((mod) => mod.startDiscordBot())
      .catch((err) => console.error('[discord] failed to start:', err.message));
  } else {
    console.log('[discord] skipped — no DISCORD_BOT_TOKEN set');
  }
}

start();
