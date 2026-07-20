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
});

/** Sandbox scripts — survives Render redeploys (disk is ephemeral). */
const sandboxScriptSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, index: true },
  code: { type: String, required: true },
  scheduled: { type: Boolean, default: false, index: true },
  intervalMs: { type: Number, default: null },
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
    maxlength: 32,
  },
  passwordHash: { type: String, required: true },
  settings: {
    discordUserId: { type: String, default: '', trim: true },
    notifyChannelId: { type: String, default: '', trim: true },
    notifyScheduler: { type: Boolean, default: true },
    notifyAlways: { type: Boolean, default: true },
    botName: { type: String, default: '', trim: true },
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
userSchema.index({ 'settings.discordUserId': 1 });

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
