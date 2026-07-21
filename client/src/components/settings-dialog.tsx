"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  KeyRound,
  Monitor,
  Moon,
  Settings2,
  Sun,
  UserRound,
  XIcon,
} from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { DiscordIcon } from "@hugeicons/core-free-icons";
import { api } from "@/lib/api";
import { useAuthStore, useChatUiStore } from "@/stores/app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type SettingsTab = "general" | "account" | "discord" | "byok" | "appearance";

const tabs: {
  id: SettingsTab;
  label: string;
  group: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "general",
    label: "General",
    group: "Settings",
    icon: <Settings2 className="size-4" />,
  },
  {
    id: "account",
    label: "Account",
    group: "Settings",
    icon: <UserRound className="size-4" />,
  },
  {
    id: "discord",
    label: "Discord",
    group: "Settings",
    icon: <HugeiconsIcon icon={DiscordIcon} size={16} />,
  },
  {
    id: "byok",
    label: "BYOK",
    group: "Settings",
    icon: <KeyRound className="size-4" />,
  },
  {
    id: "appearance",
    label: "Appearance",
    group: "Customize",
    icon: <Sun className="size-4" />,
  },
];

const MODEL_PRESETS = [
  "openrouter/free",
  "openai/gpt-4o-mini",
  "anthropic/claude-3.5-haiku",
  "google/gemini-2.0-flash-001",
];

function TabButton({
  active,
  onClick,
  icon,
  label,
  className,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
        active
          ? "bg-white/10 text-white"
          : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200",
        className
      )}
    >
      <span className="opacity-80">{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

export function SettingsDialog() {
  const open = useChatUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useChatUiStore((s) => s.setSettingsOpen);
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<SettingsTab>("general");
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await api.get("/api/settings");
      return data;
    },
    enabled: open,
  });

  const [discordUserId, setDiscordUserId] = useState("");
  const [notifyChannelId, setNotifyChannelId] = useState("");
  const [botName, setBotName] = useState("");
  const [botPersona, setBotPersona] = useState("");
  const [notifyScheduler, setNotifyScheduler] = useState(true);
  const [notifyAlways, setNotifyAlways] = useState(true);
  const [openrouterModel, setOpenrouterModel] = useState("");
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [keySet, setKeySet] = useState(false);
  const [keyHint, setKeyHint] = useState("");
  const [chatRetentionDays, setChatRetentionDays] = useState<7 | 11 | 15>(7);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const s = data?.user?.settings;
    if (!s) return;
    setDiscordUserId(s.discordUserId || "");
    setNotifyChannelId(s.notifyChannelId || "");
    setBotName(s.botName || "");
    setBotPersona(s.botPersona || "");
    setNotifyScheduler(s.notifyScheduler !== false);
    setNotifyAlways(Boolean(s.notifyAlways));
    setOpenrouterModel(s.openrouterModel || "");
    setKeySet(Boolean(s.openrouterApiKeySet));
    setKeyHint(s.openrouterApiKeyHint || "");
    setOpenrouterApiKey("");
    const days = Number(s.chatRetentionDays);
    setChatRetentionDays(days === 11 || days === 15 ? days : 7);
  }, [data]);

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await api.put("/api/settings", payload);
      return data;
    },
    onSuccess: (_data, variables) => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["auth-me"] });
      if (variables.chatRetentionDays !== undefined) {
        qc.invalidateQueries({ queryKey: ["sessions"] });
      }
      setOpenrouterApiKey("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const displayName = user?.displayName || user?.username || "you";
  const groups = ["Settings", "Customize"] as const;

  return (
    <Dialog open={open} onOpenChange={setSettingsOpen}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "gap-0 overflow-hidden border-border bg-[#1a1a1a] p-0 text-foreground shadow-2xl",
          "fixed inset-x-0 bottom-0 top-auto flex h-[min(92dvh,720px)] w-full max-w-none translate-x-0 translate-y-0 rounded-t-2xl rounded-b-none",
          "data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4",
          "sm:inset-auto sm:top-[50%] sm:left-[50%] sm:h-[min(640px,85vh)] sm:w-full sm:max-w-[860px] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl",
          "sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95 sm:flex-row"
        )}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          App settings dialog
        </DialogDescription>

        {/* Mobile top bar + horizontal tabs */}
        <div className="flex shrink-0 flex-col border-b border-white/10 sm:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-sm font-semibold">Settings</p>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                  aria-label="Close"
                >
                  <XIcon className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex gap-1 overflow-x-auto px-3 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((t) => (
              <TabButton
                key={t.id}
                active={tab === t.id}
                onClick={() => setTab(t.id)}
                icon={t.icon}
                label={t.label}
              />
            ))}
          </div>
        </div>

        {/* Desktop left nav */}
        <aside className="hidden w-[220px] shrink-0 flex-col border-r border-white/10 bg-[#141414] p-3 sm:flex">
          <p className="mb-3 px-2 text-xs font-medium text-muted-foreground">
            Settings
          </p>
          <nav className="flex flex-1 flex-col gap-4 overflow-y-auto">
            {groups.map((group) => (
              <div key={group} className="space-y-1">
                {group !== "Settings" && (
                  <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {group}
                  </p>
                )}
                {tabs
                  .filter((t) => t.group === group)
                  .map((t) => (
                    <TabButton
                      key={t.id}
                      active={tab === t.id}
                      onClick={() => setTab(t.id)}
                      icon={t.icon}
                      label={t.label}
                      className="w-full"
                    />
                  ))}
              </div>
            ))}
          </nav>
        </aside>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="absolute top-3 right-3 z-10 hidden rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground sm:inline-flex"
                aria-label="Close"
              >
                <XIcon className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 sm:pr-12">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : tab === "general" ? (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">
                    General
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Identity and persona for chat and Discord.
                  </p>
                </div>

                <div className="space-y-4 border-t border-white/10 pt-5">
                  <div className="grid gap-1.5 sm:grid-cols-[9rem_1fr] sm:items-center sm:gap-4">
                    <Label htmlFor="botName" className="text-xs sm:text-sm">
                      Display name
                    </Label>
                    <Input
                      id="botName"
                      value={botName}
                      onChange={(e) => setBotName(e.target.value)}
                      placeholder="tinyjot"
                      maxLength={40}
                      className="h-9 rounded-lg bg-white/5 text-sm"
                    />
                  </div>

                  <div className="space-y-1.5 border-t border-white/10 pt-4">
                    <Label htmlFor="botPersona" className="text-xs sm:text-sm">
                      Bot persona
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Tone and preferences only. Your name is taken from your
                      account automatically.
                    </p>
                    <Textarea
                      id="botPersona"
                      value={botPersona}
                      onChange={(e) => setBotPersona(e.target.value)}
                      placeholder="e.g. Be casual and practical. Prefer short answers. Never mention being Qwen or Alibaba."
                      maxLength={4000}
                      className="min-h-28 rounded-lg border-white/10 bg-white/5 text-sm"
                    />
                    <p className="text-right text-[10px] text-muted-foreground">
                      {botPersona.length}/4000
                    </p>
                  </div>

                  <div className="space-y-2 border-t border-white/10 pt-4">
                    <Label className="text-xs sm:text-sm">Save chats for</Label>
                    <p className="text-xs text-muted-foreground">
                      Chats auto-delete after this many days from last activity.
                    </p>
                    <div className="inline-flex w-full items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1 sm:w-auto">
                      {([7, 11, 15] as const).map((days) => {
                        const selected = chatRetentionDays === days;
                        return (
                          <Tooltip key={days}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => setChatRetentionDays(days)}
                                className={cn(
                                  "inline-flex flex-1 items-center justify-center rounded-lg px-4 py-1.5 text-xs font-medium transition-colors sm:flex-none sm:min-w-14",
                                  selected
                                    ? "bg-white/15 text-white"
                                    : "text-muted-foreground hover:text-foreground"
                                )}
                              >
                                {days}d
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              Keep chats for {days} days, then auto-delete
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <Button
                  type="button"
                  size="sm"
                  className="h-9 w-full rounded-lg sm:w-auto"
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate({ botName, botPersona, chatRetentionDays })
                  }
                >
                  {save.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            ) : tab === "account" ? (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">
                    Account
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Your signed-in profile.
                  </p>
                </div>
                <div className="space-y-4 border-t border-white/10 pt-5">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={user?.avatarUrl} alt="" />
                      <AvatarFallback className="bg-muted text-sm">
                        {displayName.slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {displayName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {user?.email || `@${user?.username}`}
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-[9rem_1fr] sm:items-center sm:gap-4">
                    <Label className="text-xs sm:text-sm">Username</Label>
                    <Input
                      value={user?.username || ""}
                      disabled
                      className="h-9 rounded-lg bg-white/5 text-sm opacity-70"
                    />
                  </div>
                </div>
              </div>
            ) : tab === "discord" ? (
              <div className="space-y-6">
                <div>
                  <div className="mb-2">
                    <span
                      className={cn(
                        "inline-flex items-center -mt-2 px-2 py-0.5 text-[11px] font-medium",
                        data?.discordBotConfigured
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-red-500/10 text-red-400"
                      )}
                    >
                      {data?.discordBotConfigured
                        ? "Bot connected"
                        : "Bot token missing"}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold tracking-tight">
                    Discord
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Allowlist and scheduler notify for this account.
                  </p>
                </div>

                <div className="space-y-4 border-t border-white/10 pt-5">
                  <div className="space-y-1.5">
                    <Label htmlFor="discordUserId" className="text-xs">
                      Discord User ID
                    </Label>
                    <Input
                      id="discordUserId"
                      value={discordUserId}
                      onChange={(e) => setDiscordUserId(e.target.value)}
                      placeholder="Your Discord user ID"
                      className="h-9 rounded-lg bg-white/5 text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Only this account can @mention the bot.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="notifyChannelId" className="text-xs">
                      Notify channel ID
                    </Label>
                    <Input
                      id="notifyChannelId"
                      value={notifyChannelId}
                      onChange={(e) => setNotifyChannelId(e.target.value)}
                      placeholder="Discord channel ID"
                      className="h-9 rounded-lg bg-white/5 text-sm"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Notify on schedule</p>
                      <p className="text-xs text-muted-foreground">
                        Post when a scheduled script finishes
                      </p>
                    </div>
                    <Switch
                      checked={notifyScheduler}
                      onCheckedChange={setNotifyScheduler}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Include empty runs</p>
                      <p className="text-xs text-muted-foreground">
                        Ping even when the script prints nothing
                      </p>
                    </div>
                    <Switch
                      checked={notifyAlways}
                      onCheckedChange={setNotifyAlways}
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  size="sm"
                  className="h-9 w-full rounded-lg sm:w-auto"
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate({
                      discordUserId,
                      notifyChannelId,
                      notifyScheduler,
                      notifyAlways,
                    })
                  }
                >
                  {save.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            ) : tab === "byok" ? (
              <div className="space-y-6">
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 text-[11px] font-medium",
                        keySet
                          ? "bg-emerald-500/10 text-emerald-400"
                          : data?.serverOpenrouterFallback
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-red-500/10 text-red-400"
                      )}
                    >
                      {keySet
                        ? `Key saved ${keyHint}`
                        : data?.serverOpenrouterFallback
                          ? "Using server fallback"
                          : "No key configured"}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold tracking-tight">BYOK</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Bring your own OpenRouter API key and model for this
                    account.
                  </p>
                </div>

                <div className="space-y-4 border-t border-white/10 pt-5">
                  <div className="space-y-1.5">
                    <Label htmlFor="openrouterApiKey" className="text-xs">
                      OpenRouter API key
                    </Label>
                    <Input
                      id="openrouterApiKey"
                      type="password"
                      autoComplete="off"
                      value={openrouterApiKey}
                      onChange={(e) => setOpenrouterApiKey(e.target.value)}
                      placeholder={
                        keySet
                          ? `Saved ${keyHint}. Paste to replace`
                          : "sk-or-v1-…"
                      }
                      className="h-9 rounded-lg bg-white/5 font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Get a key at{" "}
                      <a
                        href="https://openrouter.ai/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline"
                      >
                        openrouter.ai/keys
                      </a>
                      .
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="openrouterModel" className="text-xs">
                      Model
                    </Label>
                    <Input
                      id="openrouterModel"
                      value={openrouterModel}
                      onChange={(e) => setOpenrouterModel(e.target.value)}
                      placeholder="openrouter/free"
                      list="openrouter-models"
                      className="h-9 rounded-lg bg-white/5 font-mono text-sm"
                    />
                    <datalist id="openrouter-models">
                      {MODEL_PRESETS.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {MODEL_PRESETS.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setOpenrouterModel(m)}
                          className={cn(
                            "rounded-md border px-2 py-0.5 font-mono text-[10px] transition-colors",
                            openrouterModel === m
                              ? "border-blue-500/40 bg-blue-500/15 text-blue-300"
                              : "border-white/10 text-muted-foreground hover:bg-white/5"
                          )}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 flex-1 rounded-lg sm:flex-none"
                    disabled={save.isPending}
                    onClick={() => {
                      const payload: Record<string, unknown> = {
                        openrouterModel,
                      };
                      if (openrouterApiKey.trim()) {
                        payload.openrouterApiKey = openrouterApiKey.trim();
                      }
                      save.mutate(payload);
                    }}
                  >
                    {save.isPending ? "Saving…" : "Save BYOK"}
                  </Button>
                  {keySet && (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      className="h-9 rounded-lg"
                      disabled={save.isPending}
                      onClick={() =>
                        save.mutate({ clearOpenrouterApiKey: true })
                      }
                    >
                      Clear key
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">
                    Appearance
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Theme preference for the app.
                  </p>
                </div>
                <div className="border-t border-white/10 pt-5">
                  <Label className="mb-2 block text-xs">Color mode</Label>
                  {mounted && (
                    <div className="inline-flex w-full items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1 sm:w-auto">
                      {(
                        [
                          { id: "system", icon: Monitor, label: "System" },
                          { id: "light", icon: Sun, label: "Light" },
                          { id: "dark", icon: Moon, label: "Dark" },
                        ] as const
                      ).map((opt) => {
                        const Icon = opt.icon;
                        const active = (theme || "dark") === opt.id;
                        return (
                          <Tooltip key={opt.id}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => setTheme(opt.id)}
                                className={cn(
                                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none",
                                  active
                                    ? "bg-white/15 text-white"
                                    : "text-muted-foreground hover:text-foreground"
                                )}
                              >
                                <Icon className="size-3.5" />
                                {opt.label}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {opt.id === "system"
                                ? "Match your device theme"
                                : `${opt.label} theme`}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsDialog;
