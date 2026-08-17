import { createFileRoute, Outlet, redirect, Link, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { MessageSquare, LayoutDashboard, Users, FolderKanban, LogOut, Bot, ScrollText, Bell, Menu, Sparkles, Inbox, Plus, BrainCircuit, Table as TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { OwnerNotifications } from "@/components/owner-notifications";
import { NervaAiWidget } from "@/components/nerva-ai-widget";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedShell,
});

function AuthedShell() {
  const { user, role, isOwner, isManager } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Менеджер не принудительно сидит на /manager/new: доступны его страницы
    const allowedForManager = ["/manager/new", "/admin/inbox", "/tables"];
    if (role === "manager" && !allowedForManager.some((p) => loc.pathname.startsWith(p))) {
      navigate({ to: "/manager/new", replace: true });
    }
  }, [role, loc.pathname, navigate]);

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const navGroups = [
    {
      title: "Главное",
      items: [
        ...(isManager ? [{ to: "/manager/new", icon: Plus, label: "Новый заказ" }] : []),
        ...(isOwner ? [{ to: "/dashboard", icon: LayoutDashboard, label: "Дашборд" }] : []),
        ...(isOwner || isManager ? [{ to: "/admin/inbox", icon: Inbox, label: "Входящие" }] : []),
      ]
    },
    {
      title: "Операции",
      items: [
        { to: "/tables", icon: TableIcon, label: "Таблицы (Excel)" },
        ...(!isManager ? [{ to: "/chats", icon: MessageSquare, label: "Чаты" }] : []),
        ...(!isManager ? [{ to: "/dm", icon: BrainCircuit, label: "Ассистент Nerva" }] : []),
      ]
    },
    ...(isOwner ? [{
      title: "Администрирование",
      items: [
        { to: "/admin/orders", icon: FolderKanban, label: "Заказы" },
        { to: "/admin/users", icon: Users, label: "Сотрудники" },
        { to: "/admin/audit", icon: ScrollText, label: "Журнал аудита" },
        { to: "/admin/settings", icon: Bell, label: "Уведомления" },
      ]
    }] : [])
  ];

  const NavList = () => (
    <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto soft-scrollbar">
      {navGroups.map((group, gIdx) => (
        <div key={gIdx} className="space-y-1.5">
          <div className="px-3 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
            {group.title}
          </div>
          <div className="space-y-0.5">
            {group.items.map((n) => {
              const active = loc.pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to as any}
                  onClick={() => setOpen(false)}
                  className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-150 ${
                    active
                      ? "bg-accent/10 text-accent dark:bg-emerald-500/10 dark:text-emerald-400 font-semibold shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  }`}
                >
                  <n.icon className={`size-4 shrink-0 transition-colors ${active ? "text-accent dark:text-emerald-400" : "text-muted-foreground group-hover:text-foreground"}`} />
                  <span className="truncate">{n.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const SideContent = () => (
    <div className="flex h-full flex-col bg-card border-r border-border font-sans select-none">
      {/* Brand Header */}
      <div className="p-4 border-b border-border/80 bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-emerald-500 dark:text-slate-950 font-bold text-base shadow-sm ring-1 ring-white/10">
              N
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm tracking-tight text-foreground">NERVA</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium border border-emerald-500/20">v2.4</span>
              </div>
              <p className="text-[11px] text-muted-foreground">Система предприятия</p>
            </div>
          </div>
        </div>
      </div>

      <NavList />

      {/* User Footer */}
      <div className="p-3 border-t border-border bg-card/50 space-y-2">
        <div className="flex items-center justify-between p-2 rounded-lg bg-secondary/40 border border-border/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="size-2 rounded-full bg-emerald-500 shrink-0" title="В сети" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground truncate" title={user?.email ?? ""}>
                {user?.email?.split('@')[0]}
              </p>
              <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide">
                {isOwner ? "Владелец" : isManager ? "Менеджер" : "Сотрудник"}
              </p>
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg h-9"
          onClick={logout}
        >
          <span>Выйти</span>
          <LogOut className="size-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-background text-foreground font-sans overflow-hidden">
      <OwnerNotifications />
      <NervaAiWidget />
      
      {/* Top Header Bar */}
      <header className="h-12 shrink-0 border-b border-border bg-card px-4 flex items-center justify-between text-xs select-none z-30 shadow-xs">
        <div className="flex items-center gap-3">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="md:hidden h-8 px-2.5 rounded-lg border-border text-foreground text-xs gap-2">
                <Menu className="size-4" />
                <span>Меню</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72 border-r border-border rounded-none bg-card">
              <SideContent />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="hidden sm:inline font-medium">Операционная система:</span>
            <span className="text-foreground font-semibold">Nerva Enterprise</span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="hidden md:inline text-muted-foreground">
            Пользователь: <strong className="text-foreground font-medium">{user?.email}</strong>
          </span>
          <span className="px-2.5 py-1 rounded-full bg-secondary text-foreground text-[11px] font-medium border border-border">
            {isOwner ? "Владелец" : isManager ? "Менеджер" : "Сотрудник"}
          </span>
        </div>
      </header>

      <div className="flex-1 flex min-h-0 relative">
        <aside className="hidden md:flex w-64 lg:w-72 shrink-0 flex-col z-20">
          <SideContent />
        </aside>
        <main className="flex-1 overflow-hidden min-w-0 relative z-10 flex flex-col bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
