import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, getMongoStatus } from './db/mongo.js';
import { ensureCollection, getQdrantStatus } from './db/qdrant.js';
import { storeExchange } from './core/rag.js';
import { loadSession, saveSession, clearSession } from './core/memory.js';
import { loadTools, listTools } from './tools/registry.js';
import { listScheduled, cancel, restoreScheduled } from './tools/sandbox/scheduler.js';
import { routeMessage } from './core/intent.js';
import {
  isAuthEnabled,
  requireAuth,
  createSessionToken,
  clearSessionCookie,
  setSessionCookie,
  isAuthenticated,
  safeEqualPassword,
} from './core/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const corsOrigin = process.env.APP_URL?.trim() || true;
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));

/**
 * Auth — optional password gate (set AUTH_PASSWORD in production).
 */
app.get('/api/auth/me', (req, res) => {
  const authRequired = isAuthEnabled();
  return res.json({
    authRequired,
    authenticated: isAuthenticated(req),
  });
});

app.post('/api/auth/login', (req, res) => {
  if (!isAuthEnabled()) {
    return res.json({ ok: true, authRequired: false });
  }

  const { password } = req.body || {};
  if (!safeEqualPassword(password, process.env.AUTH_PASSWORD)) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  try {
    const token = createSessionToken();
    setSessionCookie(res, token);
    return res.json({ ok: true, authRequired: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
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
 * Health check — includes MongoDB connection status.
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'qwen-agent',
    timestamp: new Date().toISOString(),
    mongodb: getMongoStatus(),
    qdrant: getQdrantStatus(),
  });
});

/**
 * List registered MCP-style tools.
 */
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

/**
 * Persist user + assistant messages to Qdrant (non-blocking).
 */
function indexChatTurn(sessionId, message, reply) {
  storeExchange(sessionId, message, reply).catch((err) => {
    console.warn('[rag] indexChatTurn:', err.message);
  });
}

/**
 * Restore session history from MongoDB when client sends empty history.
 */
async function resolveHistory(sessionId, history) {
  if (sessionId && (!history || history.length === 0)) {
    const loaded = await loadSession(sessionId);
    if (loaded.length > 0) return loaded;
  }
  return history || [];
}

/**
 * Append turn to session and persist (keeps last 50 messages).
 */
function persistSession(sessionId, history, message, reply, intent) {
  if (!sessionId) return;
  const updated = [
    ...history,
    { role: 'user', content: message },
    { role: 'assistant', content: reply, intent },
  ];
  saveSession(sessionId, updated).catch((err) => {
    console.warn('[memory] persistSession:', err.message);
  });
}

/**
 * Load prior session messages for frontend restore (Phase 6).
 */
app.get('/api/session/:sessionId', async (req, res) => {
  try {
    const messages = await loadSession(req.params.sessionId);
    return res.json({ sessionId: req.params.sessionId, messages });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Clear session history (MongoDB). Vector memory in Qdrant is unchanged.
 */
async function handleClearSession(req, res) {
  try {
    await clearSession(req.params.sessionId);
    return res.json({ sessionId: req.params.sessionId, cleared: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

app.delete('/api/session/:sessionId', handleClearSession);
app.post('/api/session/:sessionId/clear', handleClearSession);

/**
 * Main chat endpoint. Routes message through intent classifier and handlers.
 * Supports optional SSE streaming when Accept: text/event-stream or stream=true.
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history = [], sessionId, stream: wantStream } = req.body;

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

      const result = await routeMessage(message, chatHistory, {
        sessionId,
        onToken: (chunk) => {
          fullReply += chunk;
          res.write(`data: ${JSON.stringify({ type: 'token', content: chunk })}\n\n`);
        },
      });

      const finalReply = result.reply || fullReply;
      indexChatTurn(sessionId, message, finalReply);
      persistSession(sessionId, chatHistory, message, finalReply, result.intent);

      res.write(
        `data: ${JSON.stringify({
          type: 'done',
          intent: result.intent,
          reply: finalReply,
          toolUsed: result.toolUsed ?? null,
        })}\n\n`
      );
      return res.end();
    }

    const result = await routeMessage(message, chatHistory, { sessionId });
    indexChatTurn(sessionId, message, result.reply);
    persistSession(sessionId, chatHistory, message, result.reply, result.intent);
    return res.json({
      intent: result.intent,
      reply: result.reply,
      toolUsed: result.toolUsed ?? null,
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

/**
 * Bootstrap: connect MongoDB then listen.
 */
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

  app.listen(PORT, () => {
    console.log(`[qwen-agent] listening on http://localhost:${PORT}`);
    if (isAuthEnabled()) {
      console.log('[auth] password protection enabled');
    } else if (process.env.NODE_ENV === 'production') {
      console.warn('[auth] WARNING: AUTH_PASSWORD not set — your API is public');
    } else {
      console.log('[auth] disabled (set AUTH_PASSWORD to enable)');
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
