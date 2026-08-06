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
    <div className="relative min-h-screen overflow-hidden bg-transparent p-4 text-foreground flex items-center justify-center">
      <div className="relative z-10 w-full max-w-md">
        <Card className="border border-border/80 bg-card/90 shadow-2xl overflow-hidden rounded-none">
          <CardHeader className="space-y-2 relative z-10 p-5 border-b border-border/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-2xl font-bold tracking-tight text-foreground uppercase">NERVA</CardTitle>
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 bg-primary/20 text-primary border border-primary/40">SYS::v2.0</span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground font-mono uppercase">Авторизация в системе</div>
          </CardHeader>
        <CardContent>
          <Tabs defaultValue="login">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="login">Вход</TabsTrigger>
              <TabsTrigger value="register">Первый владелец</TabsTrigger>
            </TabsList>
            <TabsContent value="login"><LoginForm /></TabsContent>
            <TabsContent value="register"><RegisterForm /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>
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
    <form onSubmit={onSubmit} className="space-y-4 mt-4">
      <div className="space-y-2"><Label>Логин</Label><div className="relative"><UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" required value={login} onChange={(e) => setLogin(e.target.value)} autoFocus placeholder="ivanov или email" /></div></div>
      <div className="space-y-2"><Label>Пароль</Label><div className="relative"><Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div></div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? "Входим…" : "Войти"}</Button>
      <p className="text-xs text-muted-foreground text-center">Учётки сотрудников создаёт владелец в админ-панели.</p>
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
        if (error.message.toLowerCase().includes("already")) toast.error("Пользователь уже есть — откройте вкладку «Вход».");
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
    <form onSubmit={onSubmit} className="space-y-4 mt-4">
      <div className="space-y-2"><Label>Имя</Label><div className="relative"><UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" required value={name} onChange={(e) => setName(e.target.value)} /></div></div>
      <div className="space-y-2"><Label>Email</Label><div className="relative"><Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div></div>
      <div className="space-y-2"><Label>Пароль</Label><div className="relative"><Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></div></div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? "Создаём…" : "Зарегистрироваться как владелец"}</Button>
      <p className="text-xs text-muted-foreground text-center">Только первый аккаунт становится владельцем.</p>
    </form>
  );
}
