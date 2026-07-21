import mongoose from 'mongoose';

let isConnected = false;

const entitySchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  type: { type: String, default: 'fact' },
  properties: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
});

const relationSchema = new mongoose.Schema({
  entity1: { type: String, required: true, index: true },
  relation: { type: String, required: true },
  entity2: { type: String, required: true, index: true },
  createdAt: { type: Date, default: Date.now },
});

const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  messages: {
    type: [
      {
        role: { type: String, enum: ['user', 'assistant'], required: true },
        content: { type: String, required: true },
        intent: String,
      },
    ],
    default: [],
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  /** MongoDB TTL deletes the doc when this date is reached (per-user retention). */
  expiresAt: { type: Date, default: null },
});
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** Sandbox scripts — survives Render redeploys (disk is ephemeral). */
const sandboxScriptSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, index: true },
  code: { type: String, required: true },
  scheduled: { type: Boolean, default: false, index: true },
  intervalMs: { type: Number, default: null },
  runCount: { type: Number, default: 0 },
  failCount: { type: Number, default: 0 },
  lastRunAt: { type: Date, default: null },
  lastExitCode: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

/**
 * Registered accounts — Discord notify/allowlist live here (not only .env).
 */
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    minlength: 3,
    maxlength: 64,
  },
  passwordHash: { type: String, default: '' },
  googleId: { type: String, default: '', index: true },
  email: { type: String, default: '', trim: true, lowercase: true },
  displayName: { type: String, default: '' },
  avatarUrl: { type: String, default: '' },
  settings: {
    discordUserId: { type: String, default: '', trim: true },
    notifyChannelId: { type: String, default: '', trim: true },
    notifyScheduler: { type: Boolean, default: true },
    notifyAlways: { type: Boolean, default: true },
    botName: { type: String, default: '', trim: true },
    botPersona: { type: String, default: '' },
    /** Bring-your-own OpenRouter key (per user). Empty = use server .env fallback. */
    openrouterApiKey: { type: String, default: '' },
    openrouterModel: { type: String, default: '', trim: true },
    /** Keep chats for N days (7 | 11 | 15), then auto-delete. */
    chatRetentionDays: { type: Number, default: 7, enum: [7, 11, 15] },
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
userSchema.index({ 'settings.discordUserId': 1 });
userSchema.index({ email: 1 });

export const Entity = mongoose.model('Entity', entitySchema);
export const Relation = mongoose.model('Relation', relationSchema);
export const Session = mongoose.model('Session', sessionSchema);
export const SandboxScript = mongoose.model('SandboxScript', sandboxScriptSchema);
export const User = mongoose.model('User', userSchema);

/**
 * Connect to MongoDB Atlas using MONGODB_URI from environment.
 */
export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('[mongo] MONGODB_URI not set — graph memory disabled');
    return;
  }

  try {
    await mongoose.connect(uri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 10000,
    });
    isConnected = true;
    console.log('[mongo] Connected to MongoDB Atlas');

    // Ensure TTL index exists (deletes chat when expiresAt is reached)
    try {
      await Session.syncIndexes();
      console.log('[mongo] Session indexes synced (TTL on expiresAt)');
    } catch (idxErr) {
      console.warn('[mongo] Session index sync:', idxErr.message);
    }
  } catch (err) {
    isConnected = false;
    console.error('[mongo] Connection failed:', err.message);
    throw err;
  }
}

/**
 * Returns current MongoDB connection status for health checks.
 */
export function getMongoStatus() {
  if (!process.env.MONGODB_URI) {
    return { configured: false, connected: false, state: 'not_configured' };
  }
  const state = mongoose.connection.readyState;
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return {
    configured: true,
    connected: state === 1,
    state: states[state] ?? 'unknown',
  };
}

export function isMongoReady() {
  return isConnected && mongoose.connection.readyState === 1;
}

export { isConnected };
