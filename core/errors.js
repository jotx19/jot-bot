/** Safe message shown in chat / API responses — never leak provider/billing details. */
export const PUBLIC_ERROR = 'Internal server error.';

/**
 * Log the real error server-side and return a generic client-safe string.
 * @param {unknown} err
 * @param {string} [label]
 * @returns {string}
 */
export function logAndPublicError(err, label = 'error') {
  const detail = err?.message != null ? String(err.message) : String(err);
  if (err?.stack) {
    console.error(`[${label}]`, detail, '\n', err.stack);
  } else {
    console.error(`[${label}]`, detail);
  }
  return PUBLIC_ERROR;
}

/**
 * True when an error looks like infra/billing/provider leakage we must not show clients.
 * (Used if we ever need selective sanitization; prefer always using PUBLIC_ERROR at boundaries.)
 */
export function isSensitiveProviderError(err) {
  const m = String(err?.message || err || '').toLowerCase();
  return (
    m.includes('openrouter') ||
    m.includes('rate limit') ||
    m.includes('credits') ||
    m.includes('api key') ||
    m.includes('byok') ||
    m.includes('insufficient') ||
    m.includes('quota')
  );
}
