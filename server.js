import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectDB, getMongoStatus, User, Session, isMongoReady } from './db/mongo.js';
import { ensureCollection, getQdrantStatus } from './db/qdrant.js';
import { storeExchange } from './core/rag.js';
import {
  loadSession,
  loadSessionDoc,
  saveSession,
  clearSession,
  pruneExpiredSessions,
  normalizeRetentionDays,
  refreshSessionExpiries,
  sweepAllExpiredSessions,
} from './core/memory.js';
import { loadTools, listTools } from './tools/registry.js';
import { listScheduled, cancel, pause, pauseStored, resume, restoreScheduled, schedule, setScriptInterval, formatInterval } from './tools/sandbox/scheduler.js';
import { isNotifyConfigured } from './tools/sandbox/notify.js';
import { listScripts, deleteScript, getScript, materializeOnDisk, saveScript } from './tools/sandbox/store.js';
import {
  listLibraryScripts,
  getLibraryScript,
  applyAutomationMeta,
  normalizeLibraryUrl,
  clearLibraryCache,
} from './tools/sandbox/library.js';
import { runChatTurn } from './core/runtime.js';
import { getExport, listExports, deleteExport, clearExports } from './tools/resume-pdf.js';
import { normalizeDiscordId, getDiscordInviteUrl } from './core/users.js';
import { runWithLlmCredentials, credsFromUserDoc } from './core/llm-context.js';
import { PUBLIC_ERROR, logAndPublicError } from './core/errors.js';
import {
  mergeMcpServers,
  stripEmptySecrets,
  testMcpServer,
  MCP_MAX_SERVERS,
  mcpConfigsFromUserDoc,
} from './core/mcp.js';
import {
  buildGoogleHealthOAuthUrl,
  clearGoogleHealthOAuthForUser,
  completeGoogleHealthOAuthForUser,
  fetchGoogleHealthSnapshot,
  formatGoogleHealthSnapshotMarkdown,
  getClientAppUrl,
  getGoogleHealthOAuthRedirectUri,
  googleHealthOAuthPublicStatus,
  isGoogleHealthOAuthConfigured,
  verifyGoogleHealthOAuthState,
} from './core/google-health.js';
import {
  isAuthEnabled,
  isUserAuthEnabled,
  isLegacyPasswordAuth,
  requireAuth,
  createSessionToken,
  createAccessJwt,
  clearSessionCookie,
  setSessionCookie,
  getAuthPayload,
  safeEqualPassword,
  hashPassword,
  verifyPassword,
  verifyGoogleIdToken,
  publicUser,
  loadRequestUser,
  usernameFromEmail,
} from './core/auth.js';

const app = express();
const PORT = process.env.PORT || 5050;

const corsOriginRaw = process.env.APP_URL?.trim() || process.env.CLIENT_URL?.trim();
const corsOrigin = corsOriginRaw
  ? corsOriginRaw.split(',').map((s) => s.trim()).filter(Boolean)
  : true;
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
    googleAuth: Boolean(process.env.GOOGLE_CLIENT_ID?.trim()),
    googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || null,
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
    const accessToken = createAccessJwt(String(doc._id), { username: doc.username });
    setSessionCookie(res, token);
    return res.json({ ok: true, user: publicUser(doc), accessToken });
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
      const accessToken = createAccessJwt(String(doc._id), { username: doc.username });
      setSessionCookie(res, token);
      return res.json({ ok: true, user: publicUser(doc), accessToken });
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
      return res.json({ ok: true, authRequired: true, legacy: true, accessToken: null });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (!isAuthEnabled()) {
    return res.json({ ok: true, authRequired: false });
  }

  return res.status(400).json({ error: 'Username and password required' });
});

app.post('/api/auth/google', async (req, res) => {
  if (!isMongoReady()) {
    return res.status(503).json({ error: 'Google login requires MongoDB' });
  }

  try {
    const idToken = req.body?.idToken || req.body?.credential;
    const profile = await verifyGoogleIdToken(idToken);

    let doc =
      (await User.findOne({ googleId: profile.googleId })) ||
      (profile.email ? await User.findOne({ email: profile.email }) : null);

    if (!doc) {
      let username = usernameFromEmail(profile.email);
      const taken = await User.findOne({ username }).lean();
      if (taken) username = `${username}_${profile.googleId.slice(-4)}`;

      doc = await User.create({
        username,
        passwordHash: '',
        googleId: profile.googleId,
        email: profile.email,
        displayName: profile.name,
        avatarUrl: profile.picture,
        settings: { notifyScheduler: true, notifyAlways: true },
      });
    } else {
      doc.googleId = doc.googleId || profile.googleId;
      doc.email = doc.email || profile.email;
      doc.displayName = profile.name || doc.displayName;
      doc.avatarUrl = profile.picture || doc.avatarUrl;
      doc.updatedAt = new Date();
      await doc.save();
    }

    const token = createSessionToken(String(doc._id));
    const accessToken = createAccessJwt(String(doc._id), {
      username: doc.username,
      email: doc.email,
    });
    setSessionCookie(res, token);
    return res.json({ ok: true, user: publicUser(doc), accessToken });
  } catch (err) {
    console.warn('[auth/google]', err.message);
    return res.status(401).json({ error: err.message || 'Google login failed' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  return res.json({ ok: true });
});

/**
 * Google Health OAuth callback — public (auth via signed state).
 * Register redirect URI on the Google Cloud OAuth Web client:
 *   {API_PUBLIC_URL}/api/integrations/google-health/callback
 */
app.get('/api/integrations/google-health/callback', async (req, res) => {
  const appUrl = getClientAppUrl();
  const fail = (msg) =>
    res.redirect(
      `${appUrl}/integrations?health=error&message=${encodeURIComponent(msg)}`
    );

  try {
    if (req.query.error) {
      return fail(String(req.query.error_description || req.query.error));
    }
    const code = req.query.code;
    const verified = verifyGoogleHealthOAuthState(req.query.state);
    if (!verified?.userId) {
      return fail('Invalid or expired OAuth state — try connecting again.');
    }
    if (!code) return fail('Missing authorization code from Google.');

    await completeGoogleHealthOAuthForUser(verified.userId, code);
    console.log(`[google-health-oauth] connected user=${verified.userId}`);
    return res.redirect(`${appUrl}/integrations?health=connected`);
  } catch (e) {
    console.warn('[google-health-oauth/callback]', e.message);
    return fail(e.message || 'Google Health connection failed');
  }
});

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  if (req.path.startsWith('/integrations/google-health/callback')) return next();
  // Resume PDF downloads use unguessable ids; allow without session so
  // markdown / Discord links work across API origins.
  if (req.path.startsWith('/exports/resume/')) return next();
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
      serverOpenrouterFallback: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      googleHealthOAuth: googleHealthOAuthPublicStatus(user),
      hints: {
        discordUserId:
          'Discord → Settings → Advanced → Developer Mode → right-click your name → Copy User ID',
        notifyChannelId:
          'Developer Mode → right-click the channel → Copy Channel ID. Bot needs Send Messages there.',
        botToken: 'DISCORD_BOT_TOKEN stays in server .env / Render (one bot per deploy).',
        byok: 'Your OpenRouter key is stored for your account only. Leave blank to use the server fallback key if configured.',
        mcp: `Add up to ${MCP_MAX_SERVERS} MCP servers (HTTP URL or local stdio). Tools appear in chat automatically when enabled.`,
        googleHealth: isGoogleHealthOAuthConfigured()
          ? `Connect Google Health on Integrations — redirect URI ${getGoogleHealthOAuthRedirectUri()}`
          : 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Google Health connect.',
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
    if (body.botPersona !== undefined) {
      $set['settings.botPersona'] = String(body.botPersona || '').trim().slice(0, 4000);
    }
    if (body.openrouterModel !== undefined) {
      $set['settings.openrouterModel'] = String(body.openrouterModel || '')
        .trim()
        .slice(0, 120);
    }
    if (body.chatRetentionDays !== undefined) {
      $set['settings.chatRetentionDays'] = normalizeRetentionDays(
        body.chatRetentionDays
      );
    }
    if (body.automationLibraryUrl !== undefined) {
      const nextUrl = normalizeLibraryUrl(body.automationLibraryUrl) || '';
      if (String(body.automationLibraryUrl || '').trim() && !nextUrl) {
        return res.status(400).json({
          error:
            'automationLibraryUrl must be an http(s) URL to a pack root (catalog.json)',
        });
      }
      $set['settings.automationLibraryUrl'] = nextUrl;
      clearLibraryCache(nextUrl || undefined);
    }
    if (body.clearOpenrouterApiKey === true) {
      $set['settings.openrouterApiKey'] = '';
    } else if (
      body.openrouterApiKey !== undefined &&
      String(body.openrouterApiKey).trim()
    ) {
      $set['settings.openrouterApiKey'] = String(body.openrouterApiKey)
        .trim()
        .slice(0, 256);
    }

    if (body.mcpServers !== undefined) {
      const existing = await User.findById(req.auth.userId).select('settings.mcpServers').lean();
      $set['settings.mcpServers'] = mergeMcpServers(
        existing?.settings?.mcpServers,
        body.mcpServers
      ).slice(0, MCP_MAX_SERVERS);
    }

    const doc = await User.findByIdAndUpdate(
      req.auth.userId,
      { $set },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ error: 'User not found' });

    if (body.chatRetentionDays !== undefined) {
      const retention = normalizeRetentionDays(body.chatRetentionDays);
      const result = await refreshSessionExpiries(req.auth.userId, retention);
      if (result.deleted || result.updated) {
        console.log(
          `[memory] retention→${retention}d user=${req.auth.userId} deleted=${result.deleted} updated=${result.updated}`
        );
      }
    }

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

/** Start Google Health OAuth — returns Google consent URL. */
app.get('/api/integrations/google-health/connect', async (req, res) => {
  try {
    if (!req.auth?.userId) {
      return res.status(400).json({ error: 'Sign in required', code: 'USER_REQUIRED' });
    }
    if (!isGoogleHealthOAuthConfigured()) {
      return res.status(503).json({
        error:
          'Google Health is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to server .env.',
        code: 'GOOGLE_HEALTH_OAUTH_UNAVAILABLE',
      });
    }
    const url = buildGoogleHealthOAuthUrl(req.auth.userId);
    return res.json({ url, redirectUri: getGoogleHealthOAuthRedirectUri() });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.get('/api/integrations/google-health/status', async (req, res) => {
  try {
    const user = await loadRequestUser(req);
    return res.json(googleHealthOAuthPublicStatus(user));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/integrations/google-health', async (req, res) => {
  try {
    if (!req.auth?.userId) {
      return res.status(400).json({ error: 'Sign in required', code: 'USER_REQUIRED' });
    }
    const doc = await clearGoogleHealthOAuthForUser(req.auth.userId);
    return res.json({ ok: true, user: publicUser(doc) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/** Fetch today's Google Health snapshot for the signed-in user. */
app.get('/api/integrations/google-health/summary', async (req, res) => {
  try {
    if (!req.auth?.userId) {
      return res.status(400).json({ error: 'Sign in required', code: 'USER_REQUIRED' });
    }
    const user = await User.findById(req.auth.userId).lean();
    if (!user?.settings?.googleHealthRefreshToken) {
      return res.status(400).json({
        error: 'Google Health not connected',
        code: 'GOOGLE_HEALTH_NOT_CONNECTED',
      });
    }
    const snapshot = await fetchGoogleHealthSnapshot(user, {
      date: req.query.date || undefined,
    });
    return res.json({
      ok: true,
      snapshot,
      markdown: formatGoogleHealthSnapshotMarkdown(snapshot),
    });
  } catch (err) {
    console.warn('[google-health/summary]', err.message);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * Probe an MCP server config (or a saved server by id) and list its tools.
 */
app.post('/api/mcp/test', async (req, res) => {
  try {
    if (!req.auth?.userId) {
      return res.status(400).json({
        error: 'MCP test requires a registered account',
        code: 'USER_REQUIRED',
      });
    }

    const body = req.body || {};
    let cfg = body.server;

    if (body.id || cfg?.id) {
      const user = await User.findById(req.auth.userId).select('settings.mcpServers').lean();
      const existingList = user?.settings?.mcpServers || [];
      const id = body.id || cfg?.id;
      const existing = existingList.find((s) => s.id === id);
      if (cfg && existing) {
        cfg = mergeMcpServers([existing], [stripEmptySecrets({ ...cfg, id })])[0];
      } else if (!cfg && existing) {
        cfg = existing;
      }
    }

    if (!cfg) {
      return res.status(400).json({ error: 'Provide server config or id' });
    }

    const result = await testMcpServer(cfg);
    return res.json(result);
  } catch (err) {
    console.error('[mcp/test]', err.message);
    return res.status(400).json({
      ok: false,
      error: String(err.message || 'Connection failed').slice(0, 300),
    });
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

function resolveApiPublicUrl(req) {
  const env =
    process.env.API_PUBLIC_URL ||
    process.env.PUBLIC_API_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    '';
  if (String(env).trim()) return String(env).replace(/\/+$/, '');
  const host = req.get('host');
  if (!host) return '';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

/** List temp resume PDF artifacts for the signed-in user. */
app.get('/api/artifacts', async (req, res) => {
  try {
    const userId = req.auth?.userId || null;
    const artifacts = listExports({ userId }).map((a) => ({
      ...a,
      downloadUrl: `${resolveApiPublicUrl(req)}${a.url}`,
    }));
    return res.json({ artifacts, ttlHours: 24 });
  } catch (err) {
    return res.status(500).json({ error: err.message || PUBLIC_ERROR });
  }
});

/** Delete one artifact. */
app.delete('/api/artifacts/:id', async (req, res) => {
  try {
    const userId = req.auth?.userId || null;
    const result = deleteExport(req.params.id, { userId });
    if (!result.ok && result.reason === 'not_found') {
      return res.status(404).json({ error: 'Artifact not found or expired' });
    }
    if (!result.ok && result.reason === 'forbidden') {
      return res.status(403).json({ error: 'Not allowed' });
    }
    return res.json({ ok: true, id: req.params.id });
  } catch (err) {
    return res.status(500).json({ error: err.message || PUBLIC_ERROR });
  }
});

/** Clear all temp resume artifacts for this user. */
app.delete('/api/artifacts', async (req, res) => {
  try {
    const userId = req.auth?.userId || null;
    const result = clearExports({ userId });
    return res.json({ ok: true, deleted: result.deleted });
  } catch (err) {
    return res.status(500).json({ error: err.message || PUBLIC_ERROR });
  }
});

/** Download a generated resume PDF (unguessable id; expires in 24h). */
app.get('/api/exports/resume/:id', async (req, res) => {
  try {
    const meta = getExport(req.params.id);
    if (!meta) {
      return res.status(404).json({ error: 'File not found or expired' });
    }
    const fileName = String(meta.fileName || 'resume.pdf').replace(/"/g, '');
    const asDownload =
      req.query.download === '1' ||
      req.query.download === 'true' ||
      req.query.dl === '1';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${asDownload ? 'attachment' : 'inline'}; filename="${fileName}"`
    );
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // Allow embedding in the Next.js chat PDF viewer (cross-origin APP_URL).
    res.removeHeader('X-Frame-Options');
    const ancestors = [
      ...String(process.env.APP_URL || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      ...String(process.env.CLIENT_URL || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      "'self'",
    ].map((u) => u.replace(/\/+$/, ''));
    const unique = [...new Set(ancestors)];
    res.setHeader(
      'Content-Security-Policy',
      `frame-ancestors ${unique.join(' ')}`
    );
    return res.sendFile(meta.path);
  } catch (err) {
    return res.status(500).json({ error: err.message || PUBLIC_ERROR });
  }
});

app.get('/api/tools', (_req, res) => {
  res.json({ tools: listTools() });
});

app.get('/api/sandbox/scheduled', (_req, res) => {
  res.json({ scheduled: listScheduled() });
});

async function libraryUrlForRequest(req) {
  const user = await loadRequestUser(req);
  return normalizeLibraryUrl(user?.settings?.automationLibraryUrl) || null;
}

app.get('/api/sandbox/library', async (req, res) => {
  try {
    const libraryUrl = await libraryUrlForRequest(req);
    const result = await listLibraryScripts({ libraryUrl });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/sandbox/library/:id', async (req, res) => {
  try {
    const libraryUrl = await libraryUrlForRequest(req);
    const item = await getLibraryScript(req.params.id, { libraryUrl });
    if (!item?.code) return res.status(404).json({ error: 'Library script not found' });
    return res.json({
      script: {
        id: item.id,
        name: item.name,
        title: item.title,
        description: item.description,
        category: item.category,
        defaultIntervalMs: item.defaultIntervalMs,
        requires: item.requires,
        file: item.file,
        code: item.code,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/sandbox/library/:id/install', async (req, res) => {
  try {
    const libraryUrl = await libraryUrlForRequest(req);
    const item = await getLibraryScript(req.params.id, { libraryUrl });
    if (!item?.code) return res.status(404).json({ error: 'Library script not found' });

    const scheduleOnInstall = Boolean(req.body?.schedule);
    const intervalMsRaw = Number(req.body?.intervalMs);
    const intervalMs =
      Number.isFinite(intervalMsRaw) && intervalMsRaw > 0
        ? intervalMsRaw
        : item.defaultIntervalMs;

    const requestedName = String(req.body?.name || item.name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 64);
    const scriptName = requestedName || item.name;

    if (scheduleOnInstall && (!intervalMs || intervalMs <= 0)) {
      return res.status(400).json({ error: 'intervalMs required to schedule' });
    }

    // Stop tickers under library name and custom name before overwrite.
    cancel(item.name, { persist: false });
    if (scriptName !== item.name) cancel(scriptName, { persist: false });

    const code = applyAutomationMeta(item.code, {
      libraryId: item.id,
      name: scriptName,
      intervalMs: scheduleOnInstall ? intervalMs : null,
    });

    const scriptPath = materializeOnDisk(scriptName, code);
    const saved = await saveScript({
      name: scriptName,
      code,
      scheduled: scheduleOnInstall,
      intervalMs: scheduleOnInstall ? intervalMs : null,
    });

    if (scheduleOnInstall) {
      schedule(scriptName, scriptPath, intervalMs);
    }

    return res.json({
      installed: true,
      name: scriptName,
      libraryId: item.id,
      scheduled: scheduleOnInstall,
      intervalMs: scheduleOnInstall ? intervalMs : null,
      persisted: saved.persisted,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/sandbox/library/refresh', async (req, res) => {
  try {
    const libraryUrl = await libraryUrlForRequest(req);
    clearLibraryCache(libraryUrl);
    const result = await listLibraryScripts({ libraryUrl, force: true });
    return res.json({
      refreshed: true,
      source: result.source,
      connected: result.connected,
      remoteError: result.remoteError,
      count: result.scripts.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/sandbox/scripts', async (_req, res) => {
  try {
    if (!isMongoReady()) {
      return res.json({
        scripts: [],
        mongo: false,
        stats: {
          scripts: 0,
          scheduled: 0,
          paused: 0,
          totalRuns: 0,
          totalFails: 0,
          lastRunAt: null,
        },
      });
    }
    const docs = await listScripts();
    const scripts = docs.map((s) => ({
      name: s.name,
      scheduled: Boolean(s.scheduled),
      paused: Boolean(s.paused),
      intervalMs: s.intervalMs || null,
      code: s.code || '',
      bytes: Buffer.byteLength(s.code || '', 'utf8'),
      runCount: Number(s.runCount) || 0,
      failCount: Number(s.failCount) || 0,
      lastRunAt: s.lastRunAt || null,
      lastExitCode: s.lastExitCode ?? null,
      createdAt: s.createdAt || null,
      updatedAt: s.updatedAt || null,
    }));

    const totalRuns = scripts.reduce((sum, s) => sum + s.runCount, 0);
    const totalFails = scripts.reduce((sum, s) => sum + s.failCount, 0);
    const scheduledCount = scripts.filter((s) => s.scheduled && !s.paused).length;
    const pausedCount = scripts.filter((s) => s.paused).length;
    const lastRunAt = scripts
      .map((s) => (s.lastRunAt ? new Date(s.lastRunAt).getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0);

    return res.json({
      scripts,
      mongo: true,
      stats: {
        scripts: scripts.length,
        scheduled: scheduledCount,
        paused: pausedCount,
        totalRuns,
        totalFails,
        lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/sandbox/scripts/:name', async (req, res) => {
  try {
    const doc = await getScript(req.params.name);
    if (!doc) return res.status(404).json({ error: 'Script not found' });
    return res.json({
      script: {
        name: doc.name,
        scheduled: Boolean(doc.scheduled),
        intervalMs: doc.intervalMs || null,
        code: doc.code || '',
        bytes: Buffer.byteLength(doc.code || '', 'utf8'),
        createdAt: doc.createdAt || null,
        updatedAt: doc.updatedAt || null,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sandbox/scripts/:name', async (req, res) => {
  try {
    cancel(req.params.name);
    const result = await deleteScript(req.params.name);
    if (!result.ok) return res.status(404).json({ error: 'Script not found' });
    return res.json({ deleted: true, stateRemoved: result.stateRemoved || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/sandbox/scripts/:name/pause', async (req, res) => {
  try {
    const name = req.params.name;
    if (pause(name)) return res.json({ paused: true, name });

    const doc = await getScript(name);
    if (!doc?.code || !doc.intervalMs || doc.intervalMs <= 0) {
      return res.status(404).json({ error: 'No schedule for this script' });
    }
    if (doc.paused) return res.json({ paused: true, name });

    const scriptPath = materializeOnDisk(name, doc.code);
    pauseStored(name, scriptPath, doc.intervalMs);
    return res.json({ paused: true, name });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/sandbox/scripts/:name/resume', async (req, res) => {
  try {
    const name = req.params.name;
    const ok = await resume(name);
    if (!ok) {
      return res.status(404).json({ error: 'No paused schedule for this script' });
    }
    return res.json({ resumed: true, name });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/sandbox/scripts/:name/interval', async (req, res) => {
  try {
    const name = String(req.params.name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
    const intervalMs = Number(req.body?.intervalMs);
    const result = await setScriptInterval(name, intervalMs);
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 400;
      return res.status(status).json({
        error: result.message || result.error || 'Failed to update interval',
      });
    }
    return res.json({
      ok: true,
      name: result.name,
      intervalMs: result.intervalMs,
      paused: result.paused,
      scheduled: result.scheduled,
      label: formatInterval(result.intervalMs),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
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
    const userId = req.auth?.userId || null;
    const sid = scopeSessionId(req.params.sessionId, userId);
    const doc = await loadSessionDoc(sid);
    const messages = doc?.messages ?? [];

    let retentionDays = 7;
    if (userId && isMongoReady()) {
      const user = await User.findById(userId)
        .select('settings.chatRetentionDays')
        .lean();
      retentionDays = normalizeRetentionDays(user?.settings?.chatRetentionDays);
    }

    let expiresAt = doc?.expiresAt || null;
    if (!expiresAt && doc?.updatedAt) {
      expiresAt = new Date(
        new Date(doc.updatedAt).getTime() + retentionDays * 24 * 60 * 60 * 1000
      );
    }

    return res.json({
      sessionId: req.params.sessionId,
      messages,
      updatedAt: doc?.updatedAt || null,
      expiresAt,
      retentionDays,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/** List chat sessions for the logged-in user (sidebar). */
app.get('/api/sessions', async (req, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId || !isMongoReady()) {
      return res.json({ sessions: [] });
    }

    const user = await User.findById(userId).select('settings.chatRetentionDays').lean();
    const retention = normalizeRetentionDays(user?.settings?.chatRetentionDays);
    await pruneExpiredSessions(userId, retention);

    const docs = await Session.find({
      $or: [{ userId }, { sessionId: new RegExp(`^${userId}:`) }],
    })
      .sort({ updatedAt: -1 })
      .limit(40)
      .select('sessionId updatedAt createdAt messages')
      .lean();

    const sessions = docs.map((d) => {
      const raw = String(d.sessionId || '');
      const clientId = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw;
      const last = [...(d.messages || [])].reverse().find((m) => m.role === 'user');
      return {
        id: clientId,
        sessionId: clientId,
        title: (last?.content || 'New chat').slice(0, 60),
        updatedAt: d.updatedAt,
        createdAt: d.createdAt,
        messageCount: d.messages?.length || 0,
      };
    });

    return res.json({ sessions, retentionDays: retention });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

async function handleClearSession(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Sign in required', code: 'AUTH_REQUIRED' });
    }

    const sid = scopeSessionId(req.params.sessionId, userId);
    const doc = await Session.findOne({ sessionId: sid }).lean();
    if (doc) {
      const owned =
        String(doc.userId || '') === String(userId) ||
        String(doc.sessionId || '').startsWith(`${userId}:`);
      if (!owned) {
        return res.status(404).json({ error: 'Chat not found' });
      }
    }

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
    const { message, history = [], sessionId: rawSessionId, stream: wantStream, preferTool } =
      req.body;
    const userId = req.auth?.userId || null;
    const sessionId = scopeSessionId(rawSessionId, userId);

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    const chatHistory = await resolveHistory(sessionId, history);
    const userDoc = userId ? await User.findById(userId).lean() : null;
    const llmCreds = {
      ...credsFromUserDoc(userDoc),
      userId,
      mcpServers: mcpConfigsFromUserDoc(userDoc),
    };

    const useSSE =
      wantStream === true ||
      req.headers.accept === 'text/event-stream';

    const apiPublicUrl = resolveApiPublicUrl(req);

    return runWithLlmCredentials(llmCreds, async () => {
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
          preferTool,
          userId,
          apiPublicUrl,
          onToken: (chunk) => {
            fullReply += chunk;
            res.write(`data: ${JSON.stringify({ type: 'token', content: chunk })}\n\n`);
          },
        });

        if (!turn.ok) {
          res.write(
            `data: ${JSON.stringify({
              type: 'error',
              error: PUBLIC_ERROR,
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
            downloadUrl: result.downloadUrl ?? null,
            downloadPath: result.downloadPath ?? null,
            fileName: result.fileName ?? null,
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
        preferTool,
        userId,
        apiPublicUrl,
      });

      if (!turn.ok) {
        return res.status(500).json({
          error: PUBLIC_ERROR,
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
        downloadUrl: result.downloadUrl ?? null,
        downloadPath: result.downloadPath ?? null,
        fileName: result.fileName ?? null,
        task: turn.task,
      });
    });
  } catch (err) {
    logAndPublicError(err, 'api/chat');
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: PUBLIC_ERROR })}\n\n`);
      return res.end();
    }
    return res.status(500).json({ error: PUBLIC_ERROR });
  }
});

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

  // MongoDB TTL + orphan sweeper so chats actually expire without opening the UI
  const SWEEP_MS = 15 * 60 * 1000;
  const runSweep = () => {
    sweepAllExpiredSessions().catch((err) =>
      console.warn('[memory] sweep failed:', err.message)
    );
  };
  if (isMongoReady()) {
    runSweep();
    setInterval(runSweep, SWEEP_MS);
    console.log('[memory] chat TTL + orphan sweep every 15m (7d/11d/15d)');
  }

  if (process.env.DISCORD_BOT_TOKEN) {
    import('./interfaces/discord.js')
      .then((mod) => mod.startDiscordBot())
      .catch((err) => console.error('[discord] failed to start:', err.message));
  } else {
    console.log('[discord] skipped — no DISCORD_BOT_TOKEN set');
  }
}

start();
