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
  | "automation"
  | "appearance";

type PdfDoc = {
  url: string;
  fileName: string;
};

type ChatUiState = {
  sidebarOpen: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  activeSessionId: string | null;
  pdfOpen: boolean;
  pdfDoc: PdfDoc | null;
  pdfExpanded: boolean;
  pdfWidthPct: number;
  /** Sidebar open state before PDF viewer opened (restored on close). */
  sidebarBeforePdf: boolean | null;
  setSidebarOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  openSettings: (tab?: SettingsTab) => void;
  toggleSidebar: () => void;
  setActiveSessionId: (id: string | null) => void;
  openPdfViewer: (doc: PdfDoc) => void;
  closePdfViewer: () => void;
  setPdfExpanded: (v: boolean) => void;
  togglePdfExpanded: () => void;
  setPdfWidthPct: (pct: number) => void;
};

const clampWidth = (pct: number) => Math.min(72, Math.max(28, Math.round(pct)));

export const useChatUiStore = create<ChatUiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      settingsOpen: false,
      settingsTab: "general",
      activeSessionId: null,
      pdfOpen: false,
      pdfDoc: null,
      pdfExpanded: false,
      pdfWidthPct: 46,
      sidebarBeforePdf: null,
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
      openPdfViewer: (doc) =>
        set((s) => ({
          pdfOpen: true,
          pdfDoc: doc,
          pdfExpanded: false,
          sidebarBeforePdf: s.pdfOpen ? s.sidebarBeforePdf : s.sidebarOpen,
          sidebarOpen: false,
        })),
      closePdfViewer: () =>
        set((s) => ({
          pdfOpen: false,
          pdfDoc: null,
          pdfExpanded: false,
          sidebarOpen:
            s.sidebarBeforePdf != null ? s.sidebarBeforePdf : s.sidebarOpen,
          sidebarBeforePdf: null,
        })),
      setPdfExpanded: (pdfExpanded) => set({ pdfExpanded }),
      togglePdfExpanded: () => set((s) => ({ pdfExpanded: !s.pdfExpanded })),
      setPdfWidthPct: (pct) => set({ pdfWidthPct: clampWidth(pct) }),
    }),
    {
      name: "tinyjot-chat-ui",
      partialize: (s) => ({
        pdfWidthPct: s.pdfWidthPct,
      }),
    }
  )
);
