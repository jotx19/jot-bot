import crypto from 'crypto';
import { User, isMongoReady } from '../db/mongo.js';

export const SESSION_COOKIE = 'tinyjot_session';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Legacy single-password gate (optional fallback when no users exist). */
export function isLegacyPasswordAuth() {
  return Boolean(process.env.AUTH_PASSWORD?.trim());
}

/** User accounts require MongoDB. */
export function isUserAuthEnabled() {
  return isMongoReady();
}

export function isAuthEnabled() {
  return isUserAuthEnabled() || isLegacyPasswordAuth();
}

function getSecret() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required in production');
  }
  return process.env.OPENROUTER_API_KEY || 'tinyjot-dev-insecure-secret';
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};

  return Object.fromEntries(
    header.split(';').map((part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return [part.trim(), ''];
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      return [key, decodeURIComponent(val)];
    })
  );
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const next = crypto.scryptSync(String(password), salt, 64);
  const prev = Buffer.from(hash, 'hex');
  if (prev.length !== next.length) return false;
  return crypto.timingSafeEqual(prev, next);
}

/**
 * Signed cookie payload. userId null = legacy shared password session.
 */
export function createSessionToken(userId = null) {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Date.now() + MAX_AGE_MS,
      v: 2,
      uid: userId || null,
    })
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;

  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;

  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sig !== sign(payload)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp <= Date.now()) return null;
    return { userId: data.uid || null, exp: data.exp, v: data.v || 1 };
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  return cookies[SESSION_COOKIE] || null;
}

export function getAuthPayload(req) {
  return verifySessionToken(getSessionFromRequest(req));
}

export function isAuthenticated(req) {
  if (!isAuthEnabled()) return true;
  return Boolean(getAuthPayload(req));
}

export function setSessionCookie(res, token) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`,
  ];
  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function safeEqualPassword(input, expected) {
  const a = Buffer.from(String(input ?? ''));
  const b = Buffer.from(String(expected ?? ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Protect API routes. Attaches req.auth = { userId }.
 */
export function requireAuth(req, res, next) {
  if (!isAuthEnabled()) {
    req.auth = { userId: null };
    return next();
  }
  const payload = getAuthPayload(req);
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
  }
  req.auth = { userId: payload.userId };
  return next();
}

/**
 * Load user document for authenticated requests (null if legacy/no user).
 */
export async function loadRequestUser(req) {
  const userId = req.auth?.userId;
  if (!userId || !isMongoReady()) return null;
  try {
    return await User.findById(userId).lean();
  } catch {
    return null;
  }
}

/**
 * Public user + settings shape (no password).
 */
export function publicUser(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    username: doc.username,
    createdAt: doc.createdAt,
    settings: {
      discordUserId: doc.settings?.discordUserId || '',
      notifyChannelId: doc.settings?.notifyChannelId || '',
      notifyScheduler: doc.settings?.notifyScheduler !== false,
      notifyAlways: Boolean(doc.settings?.notifyAlways),
      botName: doc.settings?.botName || '',
    },
  };
}
