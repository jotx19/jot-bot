import crypto from 'crypto';

export const SESSION_COOKIE = 'tinyjot_session';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isAuthEnabled() {
  return Boolean(process.env.AUTH_PASSWORD?.trim());
}

function getSecret() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required in production when AUTH_PASSWORD is set');
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

export function createSessionToken() {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + MAX_AGE_MS, v: 1 })
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;

  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;

  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  if (sig !== sign(payload)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  return cookies[SESSION_COOKIE] || null;
}

export function isAuthenticated(req) {
  if (!isAuthEnabled()) return true;
  return verifySessionToken(getSessionFromRequest(req));
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
 * Protect API routes when AUTH_PASSWORD is set.
 */
export function requireAuth(req, res, next) {
  if (!isAuthEnabled()) return next();
  if (isAuthenticated(req)) return next();
  return res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
}
