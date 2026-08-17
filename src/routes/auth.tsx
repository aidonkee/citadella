import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { bootstrapOwner } from "@/lib/users.functions";
import { Bot, Lock, Mail, Sparkles, UserRound, BrainCircuit, Activity } from "lucide-react";

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
            <Tabs defaultValue="login" className="w-full">
              <TabsList className="grid grid-cols-2 w-full p-1 bg-secondary/60 rounded-xl mb-4">
                <TabsTrigger value="login" className="rounded-lg text-xs font-medium py-1.5">
                  Вход
                </TabsTrigger>
                <TabsTrigger value="register" className="rounded-lg text-xs font-medium py-1.5">
                  Первый владелец
                </TabsTrigger>
              </TabsList>
              <TabsContent value="login"><LoginForm /></TabsContent>
              <TabsContent value="register"><RegisterForm /></TabsContent>
            </Tabs>
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

function RegisterForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data: signUp, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { display_name: name }, emailRedirectTo: window.location.origin },
    });
    try {
      if (error) {
        if (error.message.toLowerCase().includes("already")) toast.error("Пользователь уже существует — откройте вкладку «Вход».");
        else toast.error(error.message);
        return;
      }
      if (!signUp.session) {
        const { error: sErr } = await supabase.auth.signInWithPassword({ email, password });
        if (sErr) { toast.error(sErr.message); return; }
      }
      try {
        await Promise.race([
          bootstrapOwner(),
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ]);
      } catch { /* first owner bootstrap is best-effort */ }
      window.location.assign("/dashboard");
    } finally {
      setLoading(false);
    }
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4 mt-2">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-foreground">Ваше имя</Label>
        <div className="relative">
          <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9 h-10 text-xs rounded-xl bg-secondary/30 border-border focus-visible:ring-emerald-500" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Алексей Смирнов" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-foreground">Рабочий Email</Label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9 h-10 text-xs rounded-xl bg-secondary/30 border-border focus-visible:ring-emerald-500" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@company.ru" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-foreground">Пароль</Label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9 h-10 text-xs rounded-xl bg-secondary/30 border-border focus-visible:ring-emerald-500" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </div>
      <Button type="submit" className="w-full h-10 text-xs font-semibold rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-slate-950 shadow-sm transition-all" disabled={loading}>
        {loading ? "Регистрация…" : "Зарегистрироваться как владелец"}
      </Button>
      <p className="text-[11px] text-muted-foreground text-center pt-1">Первый зарегистрированный аккаунт получает права владельца.</p>
    </form>
  );
}

