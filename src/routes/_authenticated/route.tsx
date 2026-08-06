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
    if (role === "manager" && loc.pathname !== "/manager/new") {
      navigate({ to: "/manager/new", replace: true });
    }
  }, [role, loc.pathname, navigate]);

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const nav = [
    ...(isManager ? [{ to: "/manager/new", icon: Plus, label: "Новый заказ" }] : []),
    ...(isOwner ? [{ to: "/dashboard", icon: LayoutDashboard, label: "Дашборд" }] : []),
    ...(isOwner ? [{ to: "/admin/inbox", icon: Inbox, label: "Входящие" }] : []),
    { to: "/tables", icon: TableIcon, label: "Таблицы (Excel)" },
    ...(!isManager ? [{ to: "/chats", icon: MessageSquare, label: "Чаты" }] : []),
    ...(!isManager ? [{ to: "/dm", icon: BrainCircuit, label: "ИИ-ассистент Nerva" }] : []),
    ...(isOwner ? [
      { to: "/admin/orders", icon: FolderKanban, label: "Заказы" },
      { to: "/admin/users", icon: Users, label: "Сотрудники" },
      { to: "/admin/audit", icon: ScrollText, label: "Журнал аудита" },
      { to: "/admin/settings", icon: Bell, label: "Уведомления" },
    ] : []),
  ];

  const NavList = () => (
    <nav className="flex-1 p-3 space-y-1 overflow-y-auto soft-scrollbar">
      {nav.map((n) => {
        const active = loc.pathname.startsWith(n.to);
        return (
          <Link key={n.to} to={n.to as any} onClick={() => setOpen(false)}
            className={`flex items-center justify-between px-3.5 py-2.5 rounded-none text-xs font-mono tracking-wider transition border ${active ? "bg-primary/15 text-primary font-bold border-primary border-l-4 shadow-[inset_0_0_12px_rgba(var(--primary),0.2)]" : "border-transparent text-muted-foreground hover:bg-card/80 hover:text-foreground hover:border-border"}`}>
            <span className="flex items-center gap-3">
              <n.icon className={`size-4 shrink-0 ${active ? "text-primary" : "opacity-70"}`} />
              <span className="uppercase">{n.label}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );

  const SideContent = () => (
    <div className="flex h-full flex-col bg-card/90 border-r border-primary/30 font-mono select-none backdrop-blur-md">
      <div className="p-4 border-b border-primary/30 bg-background/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-base font-black tracking-widest text-foreground uppercase">
            <span className="flex size-8 items-center justify-center rounded-none bg-primary text-primary-foreground border border-primary font-mono font-black shadow-none">N</span>
            <span>NERVA // CORE</span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 bg-primary/20 text-primary border border-primary/40 font-bold tracking-tighter">v2.4</span>
        </div>
        <div className="mt-3 pt-2.5 border-t border-border/50 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>УРОВЕНЬ ДОСТУПА:</span>
          <span className="font-bold text-primary tracking-wider uppercase">{isOwner ? "[ ВЛАДЕЛЕЦ ]" : isManager ? "[ МЕНЕДЖЕР ]" : "[ СОТРУДНИК ]"}</span>
        </div>
      </div>
      <NavList />
      <div className="p-3 border-t border-primary/30 space-y-2 bg-background/60">
        <div className="flex items-center justify-between text-[11px] px-2 py-1 bg-card border border-border">
          <span className="text-muted-foreground truncate max-w-[140px]" title={user?.email ?? ""}>{user?.email}</span>
          <span className="size-2 bg-emerald-500 shrink-0" title="В сети" />
        </div>
        <Button variant="outline" size="sm" className="w-full justify-between text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-destructive hover:bg-destructive/15 hover:border-destructive rounded-none border-border" onClick={logout}>
          <span>[ ЗАВЕРШИТЬ СЕССИЮ ]</span>
          <LogOut className="size-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-transparent text-foreground font-sans overflow-hidden">
      <OwnerNotifications />
      <NervaAiWidget />
      
      {/* Верхняя тактическая панель */}
      <header className="h-10 shrink-0 border-b border-primary/30 bg-card/95 px-4 flex items-center justify-between text-xs font-mono select-none z-30">
        <div className="flex items-center gap-4 sm:gap-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="md:hidden h-7 px-2 rounded-none border border-primary/40 text-primary font-mono text-[11px] uppercase tracking-wider">[ МЕНЮ ]</Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72 border-r border-primary/40 rounded-none bg-background"><SideContent /></SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 font-bold tracking-widest text-foreground">
            <span className="size-2 bg-primary inline-block animate-pulse" />
            <span className="hidden sm:inline">СИСТЕМА УПРАВЛЕНИЯ ПРЕДПРИЯТИЕМ:</span>
            <span className="text-primary uppercase font-black">NERVA AI</span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="hidden md:inline uppercase tracking-wider">ПОЛЬЗОВАТЕЛЬ: <strong className="text-foreground">{user?.email?.split('@')[0]}</strong></span>
          <span className="border-l border-border pl-3 font-bold text-primary uppercase tracking-wider">{role || "USER"}</span>
        </div>
      </header>

      <div className="flex-1 flex min-h-0 relative">
        <aside className="hidden md:flex w-64 lg:w-72 shrink-0 flex-col z-20">
          <SideContent />
        </aside>
        <main className="flex-1 overflow-hidden min-w-0 relative z-10 flex flex-col bg-transparent">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
