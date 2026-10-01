import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Nerva — Нервная система предприятия" }] }),
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id).maybeSingle();
      const r = role?.role;
      throw redirect({ to: r === "owner" ? "/dashboard" : r === "manager" ? "/manager/new" : "/chats" });
    }
  },
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-background p-4 pb-8 text-foreground flex flex-col items-center justify-center">
      <div className="w-full max-w-md flex flex-col items-center text-center space-y-8">
        <div className="flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-2xl">
          N
        </div>

        <div className="space-y-3">
          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight">Nerva Enterprise</h1>
          <p className="text-base text-muted-foreground">
            Нервная система предприятия: управление производством и заказами в одном месте.
          </p>
        </div>

        <div className="w-full space-y-3">
          <Button asChild className="w-full h-12 text-base font-semibold rounded-lg">
            <Link to="/auth">Войти в систему</Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            Защищённый корпоративный доступ. Учётные записи сотрудников создаются владельцем.
          </p>
        </div>
      </div>
    </div>
  );
}
