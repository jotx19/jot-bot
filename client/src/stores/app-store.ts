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
        googleClientId: s.googleClientId,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.accessToken) setAccessToken(state.accessToken);
        state?.setHydrated(true);
      },
    }
  )
);

type ChatUiState = {
  sidebarOpen: boolean;
  settingsOpen: boolean;
  activeSessionId: string | null;
  setSidebarOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  toggleSidebar: () => void;
  setActiveSessionId: (id: string | null) => void;
};

export const useChatUiStore = create<ChatUiState>((set) => ({
  sidebarOpen: true,
  settingsOpen: false,
  activeSessionId: null,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
}));
