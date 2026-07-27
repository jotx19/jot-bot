import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PublicUser } from "@/lib/api";
import { setAccessToken } from "@/lib/api-base";

type AuthState = {
  user: PublicUser | null;
  accessToken: string | null;
  googleClientId: string | null;
  hydrated: boolean;
  setSession: (user: PublicUser | null, accessToken?: string | null) => void;
  setGoogleClientId: (id: string | null) => void;
  logout: () => void;
  setHydrated: (v: boolean) => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      googleClientId: null,
      hydrated: false,
      setSession: (user, accessToken = null) => {
        setAccessToken(accessToken);
        set({ user, accessToken });
      },
      setGoogleClientId: (googleClientId) => set({ googleClientId }),
      logout: () => {
        setAccessToken(null);
        set({ user: null, accessToken: null });
      },
      setHydrated: (hydrated) => set({ hydrated }),
    }),
    {
      name: "tinyjot-auth",
      partialize: (s) => ({
        user: s.user,
        accessToken: s.accessToken,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.accessToken) setAccessToken(state.accessToken);
        state?.setHydrated(true);
      },
    }
  )
);

export type SettingsTab =
  | "general"
  | "account"
  | "discord"
  | "byok"
  | "mcp"
  | "appearance";

type ChatUiState = {
  sidebarOpen: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  activeSessionId: string | null;
  setSidebarOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  openSettings: (tab?: SettingsTab) => void;
  toggleSidebar: () => void;
  setActiveSessionId: (id: string | null) => void;
};

export const useChatUiStore = create<ChatUiState>((set) => ({
  sidebarOpen: true,
  settingsOpen: false,
  settingsTab: "general",
  activeSessionId: null,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSettingsOpen: (settingsOpen) =>
    set((s) => ({
      settingsOpen,
      settingsTab: settingsOpen ? s.settingsTab : "general",
    })),
  openSettings: (tab = "general") =>
    set({ settingsOpen: true, settingsTab: tab }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
}));
