import { AsyncLocalStorage } from 'async_hooks';

/**
 * Request-scoped LLM / identity settings.
 * Falls back to process.env when unset.
 */
const llmContext = new AsyncLocalStorage();

/**
 * @param {{
 *   apiKey?: string|null,
 *   model?: string|null,
 *   botName?: string|null,
 *   botPersona?: string|null,
 *   userName?: string|null,
 *   fromUser?: boolean,
 * }} creds
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function runWithLlmCredentials(creds, fn) {
  return llmContext.run(
    {
      apiKey: creds?.apiKey?.trim() || null,
      model: creds?.model?.trim() || null,
      botName: creds?.botName?.trim() || null,
      botPersona:
        creds?.botPersona === undefined || creds?.botPersona === null
          ? null
          : String(creds.botPersona).trim(),
      userName: creds?.userName?.trim() || null,
      fromUser: Boolean(creds?.fromUser),
    },
    fn
  );
}

export function getLlmApiKey() {
  const store = llmContext.getStore();
  return store?.apiKey || process.env.OPENROUTER_API_KEY?.trim() || '';
}

export function getLlmModel() {
  const store = llmContext.getStore();
  return store?.model || process.env.OPENROUTER_MODEL?.trim() || 'openrouter/free';
}

export function getContextBotName() {
  const store = llmContext.getStore();
  return store?.botName || null;
}

/**
 * User persona: when request is for a logged-in user, use their settings only
 * (empty means no extra persona — do NOT fall back to .env BOT_PERSONA).
 */
export function getContextBotPersona() {
  const store = llmContext.getStore();
  if (store?.fromUser) {
    return store.botPersona || '';
  }
  if (store?.botPersona != null) return store.botPersona;
  return process.env.BOT_PERSONA?.trim() || '';
}

export function getContextUserName() {
  const store = llmContext.getStore();
  return store?.userName || null;
}

export function maskApiKey(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  if (k.length <= 8) return '••••••••';
  return `••••${k.slice(-4)}`;
}

/**
 * Build creds from a user document (settings + display name).
 * @param {object|null|undefined} userDoc
 */
export function credsFromUserDoc(userDoc) {
  const settings = userDoc?.settings || {};
  const userName =
    userDoc?.displayName?.trim() ||
    userDoc?.username?.trim() ||
    null;

  return {
    apiKey: settings.openrouterApiKey || null,
    model: settings.openrouterModel || null,
    botName: settings.botName || null,
    botPersona: settings.botPersona ?? '',
    userName,
    fromUser: Boolean(userDoc),
  };
}

/** @deprecated use credsFromUserDoc */
export function credsFromUserSettings(settings, userDoc) {
  if (userDoc) return credsFromUserDoc({ ...userDoc, settings: settings || userDoc.settings });
  return {
    apiKey: settings?.openrouterApiKey || null,
    model: settings?.openrouterModel || null,
    botName: settings?.botName || null,
    botPersona: settings?.botPersona ?? '',
    userName: null,
    fromUser: true,
  };
}
