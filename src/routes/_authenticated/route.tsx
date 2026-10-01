import { createFileRoute, Outlet, redirect, Link, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { MessageSquare, LayoutDashboard, Users, FolderKanban, LogOut, ScrollText, Bell, Menu, Inbox, Plus, BrainCircuit, Table as TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { OwnerNotifications } from "@/components/owner-notifications";
import { NervaAiWidget } from "@/components/nerva-ai-widget";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedShell,
});

type NavItem = {
  to: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  roles: Array<"owner" | "manager" | "worker">;
  badge?: string;
};

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Дашборд", roles: ["owner"] },
  { to: "/tables", icon: TableIcon, label: "Таблицы", roles: ["worker", "manager", "owner"] },
  { to: "/manager/new", icon: Plus, label: "Новый заказ", roles: ["manager"] },
  { to: "/admin/inbox", icon: Inbox, label: "Входящие", roles: ["manager", "owner"] },
  { to: "/chats", icon: MessageSquare, label: "Чаты", roles: ["worker", "owner"] },
  { to: "/dm", icon: BrainCircuit, label: "Ассистент", roles: ["worker", "owner"] },
  { to: "/admin/orders", icon: FolderKanban, label: "Заказы", roles: ["owner"] },
  { to: "/admin/users", icon: Users, label: "Сотрудники", roles: ["owner"] },
  { to: "/admin/audit", icon: ScrollText, label: "Журнал аудита", roles: ["owner"] },
  { to: "/admin/settings", icon: Bell, label: "Уведомления", roles: ["owner"] },
];

function roleLabel(isOwner: boolean, isManager: boolean) {
  return isOwner ? "Владелец" : isManager ? "Менеджер" : "Сотрудник";
}

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

  const allowed = (item: NavItem) => {
    if (!role) return false;
    if (role === "owner") return item.roles.includes("owner");
    if (role === "manager") return item.roles.includes("manager");
    return item.roles.includes("worker");
  };

  const visibleItems = NAV_ITEMS.filter(allowed);
  const isActive = (to: string) => loc.pathname.startsWith(to);

  const groups = [
    { title: "Главное", items: visibleItems.filter((n) => ["/dashboard", "/tables", "/manager/new", "/admin/inbox"].includes(n.to)) },
    { title: "Операции", items: visibleItems.filter((n) => ["/chats", "/dm"].includes(n.to)) },
    { title: "Администрирование", items: visibleItems.filter((n) => ["/admin/orders", "/admin/users", "/admin/audit", "/admin/settings"].includes(n.to)) },
  ].filter((g) => g.items.length > 0);

  const NavLink = ({ item, onNavigate, mobile = false }: { item: NavItem; onNavigate?: () => void; mobile?: boolean }) => {
    const active = isActive(item.to);
    return (
      <Link
        key={item.to}
        to={item.to as any}
        onClick={onNavigate}
        className={cn(
          mobile
            ? "flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-medium transition-colors"
            : "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors",
          active
            ? "text-emerald-700 bg-emerald-50"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/70",
        )}
      >
        <item.icon className={cn("shrink-0", mobile ? "size-5" : "size-[18px]", active ? "text-emerald-600" : "text-muted-foreground group-hover:text-foreground")} />
        {!mobile && <span className="truncate">{item.label}</span>}
        {!mobile && active && <span className="ml-auto size-1.5 rounded-full bg-emerald-500" />}
      </Link>
    );
  };

  // Мобильная нижняя навигация: главные экраны + пункт «Ещё» с полным меню
  const primaryMobile = visibleItems.filter((n) => ["/dashboard", "/tables", "/manager/new", "/chats", "/dm"].includes(n.to)).slice(0, 4);
  const secondaryMobile = visibleItems.filter((n) => !primaryMobile.some((p) => p.to === n.to));

  return (
    <div className="flex h-[100dvh] w-full bg-background text-foreground overflow-hidden">
      <OwnerNotifications />
      <NervaAiWidget />

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-card">
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 h-16 border-b border-border shrink-0">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-base">
            N
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-tight leading-none">Nerva</div>
            <div className="text-[11px] text-muted-foreground mt-1">Система предприятия</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto soft-scrollbar px-3 py-4 space-y-5">
          {groups.map((group, gIdx) => (
            <div key={gIdx} className="space-y-1">
              <div className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {group.title}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => <NavLink key={item.to} item={item} />)}
              </div>
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-border p-3 shrink-0">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground text-xs font-semibold">
              {user?.email?.[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-tight">{user?.email?.split("@")[0]}</p>
              <p className="text-[11px] text-muted-foreground">{roleLabel(isOwner, isManager)}</p>
            </div>
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={logout} title="Выйти">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Mobile header */}
        <header className="md:hidden h-14 shrink-0 border-b border-border bg-card px-4 flex items-center justify-between select-none">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
              N
            </div>
            <span className="font-semibold text-[15px] tracking-tight">Nerva</span>
          </div>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="size-11 rounded-lg text-muted-foreground" aria-label="Меню">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="p-0 w-72">
              <div className="flex h-full flex-col">
                <div className="flex items-center gap-3 px-5 h-16 border-b border-border">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
                    N
                  </div>
                  <div>
                    <div className="text-sm font-semibold leading-none">Nerva</div>
                    <div className="text-[11px] text-muted-foreground mt-1">{user?.email}</div>
                  </div>
                </div>
                <nav className="flex-1 overflow-y-auto soft-scrollbar px-3 py-4 space-y-5">
                  {groups.map((group, gIdx) => (
                    <div key={gIdx} className="space-y-1">
                      <div className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                        {group.title}
                      </div>
                      <div className="space-y-0.5">
                        {group.items.map((item) => <NavLink key={item.to} item={item} onNavigate={() => setOpen(false)} />)}
                      </div>
                    </div>
                  ))}
                </nav>
                <div className="border-t border-border p-3">
                  <Button variant="ghost" className="w-full justify-between text-[13px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-10" onClick={logout}>
                    <span>Выйти</span>
                    <LogOut className="size-4" />
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </header>

        <main className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </main>

        {/* Mobile bottom navigation */}
        <nav className="md:hidden shrink-0 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-stretch px-2 py-2">
            {primaryMobile.map((item) => (
              <NavLink key={item.to} item={item} mobile />
            ))}
            {secondaryMobile.length > 0 && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-medium text-muted-foreground"
              >
                <Menu className="size-5" />
                Ещё
              </button>
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}
