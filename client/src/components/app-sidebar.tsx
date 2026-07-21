"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LogOutIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  CalendarClockIcon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import { api, type ChatSessionSummary } from "@/lib/api";
import { useAuthStore, useChatUiStore } from "@/stores/app-store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { TinyjotLogo } from "@/components/tinyjot-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function SessionLink({
  session,
  active,
  onRequestDelete,
  deleting,
}: {
  session: ChatSessionSummary;
  active: boolean;
  onRequestDelete: (session: ChatSessionSummary) => void;
  deleting: boolean;
}) {
  const setActiveSessionId = useChatUiStore((s) => s.setActiveSessionId);
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarMenuItem className="group/session relative">
      <SidebarMenuButton
        asChild
        isActive={active}
        className="h-10 rounded-xl px-2.5 pr-9 text-sm font-semibold"
      >
        <Link
          href={`/chat/${session.id}`}
          onClick={() => {
            setActiveSessionId(session.id);
            if (isMobile) setOpenMobile(false);
          }}
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {session.title}
          </span>
        </Link>
      </SidebarMenuButton>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Delete chat"
            disabled={deleting}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRequestDelete(session);
            }}
            className={cn(
              "absolute top-1/2 right-2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg",
              "text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive",
              "group-hover/session:opacity-100 focus-visible:opacity-100",
              active && "opacity-100",
              deleting && "pointer-events-none opacity-50"
            )}
          >
            <Trash2Icon className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Delete chat</TooltipContent>
      </Tooltip>
    </SidebarMenuItem>
  );
}

const navItems = [
  {
    href: "/automation",
    label: "Automation",
    icon: WorkflowSquare01Icon,
  },
  {
    href: "/scheduled",
    label: "Scheduled",
    icon: CalendarClockIcon,
  },
] as const;

export function AppSidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { sidebarOpen, setSidebarOpen, activeSessionId, setActiveSessionId } =
    useChatUiStore();
  const setSettingsOpen = useChatUiStore((s) => s.setSettingsOpen);
  const displayName = user?.displayName || user?.username || "you";
  const [isApple, setIsApple] = React.useState(true);

  React.useEffect(() => {
    setIsApple(/Mac|iPhone|iPod|iPad/i.test(navigator.platform || navigator.userAgent));
  }, []);

  const shortcutKeys = isApple ? ["⌘", "⇧", "O"] : ["Ctrl", "Shift", "O"];
  const shortcutLabel = shortcutKeys.join("+");

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const { data } = await api.get<{ sessions: ChatSessionSummary[] }>(
        "/api/sessions"
      );
      return data.sessions;
    },
    enabled: Boolean(user),
  });

  const newChat = React.useCallback(() => {
    const id = crypto.randomUUID();
    setActiveSessionId(id);
    router.push(`/chat/${id}`);
    qc.invalidateQueries({ queryKey: ["sessions"] });
  }, [qc, router, setActiveSessionId]);

  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [pendingDelete, setPendingDelete] =
    React.useState<ChatSessionSummary | null>(null);

  const confirmDeleteChat = React.useCallback(async () => {
    if (!pendingDelete || deletingId) return;
    const id = pendingDelete.id;

    setDeletingId(id);
    setPendingDelete(null);
    try {
      await api.delete(`/api/session/${id}`);
      qc.removeQueries({ queryKey: ["session", id] });
      await qc.invalidateQueries({ queryKey: ["sessions"] });
      if (activeSessionId === id || pathname === `/chat/${id}`) {
        const nextId = crypto.randomUUID();
        setActiveSessionId(nextId);
        router.push(`/chat/${nextId}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingId(null);
    }
  }, [
    activeSessionId,
    deletingId,
    pathname,
    pendingDelete,
    qc,
    router,
    setActiveSessionId,
  ]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "o") return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }

      e.preventDefault();
      newChat();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newChat]);

  const signOut = async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      /* ignore */
    }
    logout();
    router.replace("/login");
  };

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <div className="fixed left-4 top-4 z-50">
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger className="size-9 rounded-xl border border-border bg-white/70 text-black shadow-md hover:bg-white/90 [&_svg]:size-4 dark:bg-white/70 dark:text-black dark:hover:bg-white/90" />
          </TooltipTrigger>
          <TooltipContent side="right">Toggle sidebar</TooltipContent>
        </Tooltip>
      </div>

      <Sidebar
        collapsible="offcanvas"
        className="z-40 transform-gpu will-change-transform"
      >
        <SidebarHeader className="gap-3">
          <div className="flex w-full gap-2 bg-black/50 rounded-md items-center justify-center px-3 md:mt-1">
            <TinyjotLogo size="lg" /> <span className="text-sm text-foreground font-semibold">tinyjot</span>
          </div>

          <div className="px-1.5 pt-1 md:mt-5 md:pt-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  className="h-10 w-full justify-start gap-2 rounded-xl border border-dashed px-2.5 text-sm font-semibold"
                  onClick={newChat}
                >
                  <HugeiconsIcon icon={Add01Icon} size={20} />
                  <span className="flex-1 text-left">New chat</span>
                  <span
                    aria-hidden
                    className="pointer-events-none ml-auto hidden items-center gap-1 sm:inline-flex"
                  >
                    {shortcutKeys.map((key) => (
                      <kbd
                        key={key}
                        className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-sidebar-border bg-sidebar-accent px-1 font-sans text-[10px] font-medium text-muted-foreground shadow-[0_1px_0_0_rgba(255,255,255,0.06)]"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                New chat ({shortcutLabel})
              </TooltipContent>
            </Tooltip>
          </div>

          <SidebarMenu className="gap-0.5 px-1.5">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    className="h-10 gap-2 rounded-xl px-2.5 text-sm font-semibold"
                  >
                    <Link href={item.href}>
                      <HugeiconsIcon icon={item.icon} size={20} />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="px-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Chats
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5 px-1.5">
                {isLoading
                  ? Array.from({ length: 5 }).map((_, idx) => (
                      <Skeleton
                        key={idx}
                        className="mb-1 h-10 rounded-xl"
                      />
                    ))
                  : sessions.map((s) => {
                      const active =
                        activeSessionId === s.id ||
                        pathname === `/chat/${s.id}`;
                      return (
                        <SessionLink
                          key={s.id}
                          session={s}
                          active={active}
                          onRequestDelete={setPendingDelete}
                          deleting={deletingId === s.id}
                        />
                      );
                    })}
                {!isLoading && !sessions.length && (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    No chats yet
                  </p>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="gap-3">
          <div className="flex items-center justify-between px-1">
            <ThemeToggle />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Settings"
                >
                  <SettingsIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Settings</TooltipContent>
            </Tooltip>
          </div>

          <SidebarSeparator className="mx-0" />

          <div className="flex items-center gap-2 px-1">
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarImage src={user?.avatarUrl} alt="" />
              <AvatarFallback className="bg-muted text-xs text-muted-foreground">
                {displayName.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {displayName}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {user?.email || user?.username}
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="destructive"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-xl"
                  onClick={signOut}
                  aria-label="Sign out"
                >
                  <LogOutIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Sign out</TooltipContent>
            </Tooltip>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-transparent">{children}</SidebarInset>

      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-sm gap-4 rounded-2xl border-border bg-background p-5 sm:max-w-sm"
        >
          <DialogHeader>
            <DialogTitle>Delete chat?</DialogTitle>
            <DialogDescription>
              {pendingDelete?.title
                ? `"${pendingDelete.title}" will be permanently removed. This cannot be undone.`
                : "This chat will be permanently removed. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="rounded-xl"
              disabled={Boolean(deletingId)}
              onClick={() => void confirmDeleteChat()}
            >
              {deletingId ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
