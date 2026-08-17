import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Lock, UserRound } from "lucide-react";

const LOGIN_DOMAIN = "orderflow.local";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Вход — Nerva" }] }),
  ssr: false,
  component: AuthPage,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/" });
  },
});

function AuthPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background p-4 text-foreground flex items-center justify-center font-sans">
      {/* Ambient Soft Glow Background */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500/5 dark:bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-6 space-y-2">
          <div className="inline-flex items-center justify-center size-12 rounded-2xl bg-slate-900 text-white dark:bg-emerald-500 dark:text-slate-950 font-bold text-xl shadow-lg ring-1 ring-white/10 mb-2">
            N
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Nerva Enterprise</h1>
          <p className="text-xs text-muted-foreground">Система управления производством и заказами</p>
        </div>

        <Card className="border border-border bg-card/95 shadow-xl rounded-2xl overflow-hidden backdrop-blur-xl">
          <CardHeader className="space-y-1.5 p-6 pb-4 border-b border-border/60">
            <CardTitle className="text-lg font-semibold text-foreground">Вход в систему</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Введите данные вашей учётной записи для авторизации
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 pt-4">
            <LoginForm />
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Nerva Systems. Защищенный корпоративный доступ.
        </p>
      </div>
    </div>
  );
}

function loginToEmail(s: string) {
  const t = s.trim().toLowerCase();
  return t.includes("@") ? t : `${t}@${LOGIN_DOMAIN}`;
}

function LoginForm() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const email = loginToEmail(login);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        toast.error("Неверный логин или пароль");
        return;
      }
      window.location.assign("/");
    } catch {
      toast.error("Не удалось войти. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4 mt-2">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-foreground">Логин или Email</Label>
        <div className="relative">
          <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9 h-10 text-xs rounded-xl bg-secondary/30 border-border focus-visible:ring-emerald-500" required value={login} onChange={(e) => setLogin(e.target.value)} autoFocus placeholder="ivanov или email@company.ru" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-foreground">Пароль</Label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9 h-10 text-xs rounded-xl bg-secondary/30 border-border focus-visible:ring-emerald-500" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </div>
      <Button type="submit" className="w-full h-10 text-xs font-semibold rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-slate-950 shadow-sm transition-all" disabled={loading}>
        {loading ? "Авторизация…" : "Войти в систему"}
      </Button>
      <p className="text-[11px] text-muted-foreground text-center pt-1">Учётные записи сотрудников создаются владельцем в админ-панели.</p>
    </form>
  );
}
