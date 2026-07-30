import axios, { AxiosError, type AxiosInstance } from "axios";
import {
  apiBaseUrl,
  getAccessToken,
  setAccessToken,
} from "@/lib/api-base";

export { getAccessToken, setAccessToken, apiBaseUrl };

/**
 * Hardened axios for metadata (auth, settings, sessions).
 * Chat tokens use fetch SSE in stream-chat.ts for lower latency.
 */
export const api: AxiosInstance = axios.create({
  baseURL: apiBaseUrl(),
  timeout: 20_000,
  withCredentials: true,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
  },
  validateStatus: (s) => s >= 200 && s < 300,
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error: AxiosError<{ error?: string; code?: string }>) => {
    const status = error.response?.status;
    const message =
      error.response?.data?.error || error.message || "Request failed";

    if (status === 401 && typeof window !== "undefined") {
      setAccessToken(null);
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }

    return Promise.reject(
      Object.assign(new Error(message), {
        status,
        code: error.response?.data?.code,
      })
    );
  }
);

export type McpServerPublic = {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  envKeys?: string[];
  headerKeys?: string[];
  hasEnv?: boolean;
  hasHeaders?: boolean;
};

export type GoogleHealthStatus = {
  connected: boolean;
  connectedAt?: string | null;
  oauthAvailable: boolean;
  redirectUri?: string;
};

export type HealthSnapshot = {
  date: string;
  source?: string;
  api?: string;
  identity?: {
    healthUserId?: string | null;
    legacyFitbitUserId?: string | null;
  };
  profile?: {
    age?: number | null;
  };
  devices?: Array<{
    name: string;
    type?: string | null;
    batteryStatus?: string | null;
    batteryLevel?: number | null;
    lastSyncTime?: string | null;
  }>;
  activity?: {
    steps?: number | null;
    activeMinutes?: number | null;
    activeMinutesByLevel?: Record<string, number>;
    activeZoneMinutes?: number | null;
    activeZoneMinutesDetail?: {
      total: number;
      fatBurn: number;
      cardio: number;
      peak: number;
    } | null;
    sedentaryMinutes?: number | null;
    calories?: number | null;
    distanceKm?: number | null;
    floors?: number | null;
  };
  heart?: {
    avgBpm?: number | null;
    minBpm?: number | null;
    maxBpm?: number | null;
    restingBpm?: number | null;
  };
  sleep?: {
    minutesAsleep?: number | null;
    minutesAwake?: number | null;
    minutesInSleepPeriod?: number | null;
    minutesToFallAsleep?: number | null;
    startTime?: string | null;
    endTime?: string | null;
    stages?: Record<string, number>;
    type?: string | null;
  } | null;
  exercises?: Array<{
    name: string;
    type?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    activeDurationMinutes?: number | null;
  }>;
  charts?: {
    weekSteps?: Array<{ date: string | null; steps: number | null }>;
    heartHourly?: Array<{ label: string; bpm: number | null }>;
  };
  errors?: Record<string, string | null>;
};

export type PublicUser = {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  settings: {
    discordUserId: string;
    notifyChannelId: string;
    notifyScheduler: boolean;
    notifyAlways: boolean;
    botName: string;
    botPersona?: string;
    openrouterModel?: string;
    openrouterApiKeySet?: boolean;
    openrouterApiKeyHint?: string;
    chatRetentionDays?: 7 | 11 | 15;
    mcpServers?: McpServerPublic[];
    googleHealth?: GoogleHealthStatus;
  };
};

export type ChatSessionSummary = {
  id: string;
  sessionId: string;
  title: string;
  updatedAt?: string;
  createdAt?: string;
  messageCount: number;
};

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent?: string | null;
  toolUsed?: string | null;
  downloadUrl?: string | null;
  fileName?: string | null;
  streaming?: boolean;
};
