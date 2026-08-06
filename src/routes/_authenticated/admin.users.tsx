import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { createWorker, deleteWorker } from "@/lib/users.functions";
import { createChat, setChatMembers } from "@/lib/chats.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, UserPlus, Plus, Users as UsersIcon, BrainCircuit, ShieldAlert, UserCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "Сотрудники и Цеха Nerva — Нервная система компании" }] }),
  component: UsersAdmin,
});

type Worker = { id: string; display_name: string; username: string | null; role: "worker" | "manager" };
type Chat = { id: string; name: string };

function UsersAdmin() {
  const { isOwner, loading } = useAuth();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [members, setMembers] = useState<Record<string, string[]>>({});
  const [openUser, setOpenUser] = useState(false);
  const [openChat, setOpenChat] = useState(false);
  const [editChat, setEditChat] = useState<Chat | null>(null);

  const load = async () => {
    const { data: rls } = await supabase.from("user_roles").select("user_id, role").in("role", ["worker", "manager"]);
    const roleMap = new Map((rls ?? []).map((r: any) => [r.user_id, r.role]));
    const ids = Array.from(roleMap.keys());
    let workerList: Worker[] = [];
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("id, display_name, username").in("id", ids);
      workerList = (ps ?? []).map((p: any) => ({ ...p, role: roleMap.get(p.id) })) as Worker[];
    }
    setWorkers(workerList);
    const { data: cs } = await supabase.from("chats").select("id, name").eq("is_dm", false).order("created_at");
    setChats(cs ?? []);
    const { data: cm } = await supabase.from("chat_members").select("chat_id, user_id");
    const map: Record<string, string[]> = {};
    for (const m of cm ?? []) { (map[m.chat_id] ||= []).push(m.user_id); }
    setMembers(map);
  };
  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-8 text-muted-foreground animate-pulse">Загрузка структуры Nerva…</div>;
  if (!isOwner) return <div className="p-8 text-muted-foreground">Доступно только владельцу предприятия.</div>;

  return (
    <div className="soft-scrollbar h-full overflow-auto p-4 sm:p-6 space-y-6 bg-transparent relative overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,color-mix(in_oklab,var(--primary)_20%,transparent),transparent_35rem),radial-gradient(circle_at_85%_85%,color-mix(in_oklab,var(--accent)_25%,transparent),transparent_35rem)]" />
      
      <div>
        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground flex items-center gap-2.5">
          <BrainCircuit className="size-6 text-primary animate-pulse" />
          Сотрудники и цеха (Узлы Nerva)
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          Управление учётными записями, ролями и распределением сотрудников по рабочим чатам
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
        {/* Workers List */}
        <Card className="glass-panel liquid-card rounded-2xl border border-primary/30 shadow-xl overflow-hidden">
          <CardHeader className="border-b border-primary/15 bg-primary/5 px-5 py-4 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
              <UserCheck className="size-4 text-primary" />
              <span>Сотрудники ({workers.length})</span>
            </CardTitle>
            <Dialog open={openUser} onOpenChange={setOpenUser}>
              <DialogTrigger asChild>
                <Button size="sm" className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-md shadow-primary/20">
                  <UserPlus className="size-4 mr-1.5" />Добавить
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-2xl border-primary/30 glass-panel">
                <DialogHeader><DialogTitle className="font-bold text-foreground">Новый сотрудник</DialogTitle></DialogHeader>
                <WorkerForm onDone={() => { setOpenUser(false); load(); }} />
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-4 space-y-2.5">
            {workers.map((w) => (
              <div key={w.id} className="flex items-center justify-between border border-primary/20 bg-background/50 hover:bg-primary/10 rounded-xl px-4 py-3 backdrop-blur-md transition-all">
                <div>
                  <div className="font-bold text-sm flex items-center gap-2 text-foreground">
                    {w.display_name}
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                      w.role === "manager"
                        ? "bg-primary/20 text-primary border-primary/30"
                        : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    }`}>
                      {w.role === "manager" ? "Менеджер" : "Работник"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 font-mono">Логин: {w.username ?? "—"}</div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/15"
                  onClick={async () => {
                    if (!confirm(`Удалить сотрудника ${w.display_name}?`)) return;
                    try {
                      await deleteWorker({ data: { user_id: w.id } as any });
                      toast.success("Сотрудник удалён из системы");
                      load();
                    } catch (e: any) {
                      toast.error(e.message);
                    }
                  }}
                  title="Удалить сотрудника"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            {workers.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center italic">Сотрудников пока нет</div>}
          </CardContent>
        </Card>

        {/* Chats List */}
        <Card className="glass-panel liquid-card rounded-2xl border border-primary/30 shadow-xl overflow-hidden">
          <CardHeader className="border-b border-primary/15 bg-primary/5 px-5 py-4 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
              <UsersIcon className="size-4 text-primary" />
              <span>Рабочие чаты и цеха ({chats.length})</span>
            </CardTitle>
            <Dialog open={openChat} onOpenChange={setOpenChat}>
              <DialogTrigger asChild>
                <Button size="sm" className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-md shadow-primary/20">
                  <Plus className="size-4 mr-1.5" />Создать цех
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-2xl border-primary/30 glass-panel">
                <DialogHeader><DialogTitle className="font-bold text-foreground">Новый рабочий чат / цех</DialogTitle></DialogHeader>
                <ChatForm onDone={() => { setOpenChat(false); load(); }} />
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-4 space-y-2.5">
            {chats.map((c) => (
              <div key={c.id} className="flex items-center justify-between border border-primary/20 bg-background/50 hover:bg-primary/10 rounded-xl px-4 py-3 backdrop-blur-md transition-all">
                <div>
                  <div className="font-bold text-sm text-foreground">{c.name}</div>
                  <div className="text-xs text-primary font-medium mt-0.5">{(members[c.id]?.length ?? 0)} сотрудников прикреплено</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setEditChat(c)} className="rounded-xl border-primary/30 hover:bg-primary/15 text-foreground font-medium">
                  <UsersIcon className="size-3.5 mr-1.5 text-primary" />Состав цеха
                </Button>
              </div>
            ))}
            {chats.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center italic">Рабочих чатов пока нет</div>}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editChat} onOpenChange={(o) => !o && setEditChat(null)}>
        <DialogContent className="rounded-2xl border-primary/30 glass-panel">
          <DialogHeader><DialogTitle className="font-bold text-foreground">Участники цеха: {editChat?.name}</DialogTitle></DialogHeader>
          {editChat && (
            <MembersForm chat={editChat} workers={workers} initial={members[editChat.id] ?? []}
              onDone={() => { setEditChat(null); load(); }} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkerForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ display_name: "", login: "", password: "", role: "worker" as "worker" | "manager" });
  const [saving, setSaving] = useState(false);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault(); setSaving(true);
      try { await createWorker({ data: f as any }); toast.success(f.role === "manager" ? "Менеджер создан" : "Сотрудник создан"); onDone(); }
      catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
    }} className="space-y-4">
      <div className="space-y-1.5"><Label className="text-xs font-semibold">Имя сотрудника</Label><Input required value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} className="rounded-xl border-primary/30 bg-background/60" placeholder="Иван Петров" /></div>
      <div className="space-y-1.5"><Label className="text-xs font-semibold">Логин для входа</Label><Input required value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} className="rounded-xl border-primary/30 bg-background/60" placeholder="ivan_ceh1" /></div>
      <div className="space-y-1.5"><Label className="text-xs font-semibold">Пароль (минимум 6 символов)</Label><Input required type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} minLength={6} className="rounded-xl border-primary/30 bg-background/60" /></div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Роль в системе Nerva</Label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {(["worker", "manager"] as const).map((r) => (
            <button type="button" key={r} onClick={() => setF({ ...f, role: r })}
              className={`px-3 py-2.5 rounded-xl border text-xs font-semibold transition ${f.role === r ? "border-primary bg-primary/20 text-primary shadow-sm" : "border-border/40 text-muted-foreground hover:bg-accent/40"}`}>
              {r === "worker" ? "🛠 Работник (исполнитель)" : "📋 Менеджер (создаёт заказы)"}
            </button>
          ))}
        </div>
      </div>
      <Button type="submit" disabled={saving} className="w-full rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-md shadow-primary/20 h-11">{saving ? "Создание…" : "Создать сотрудника"}</Button>
    </form>
  );
}

function ChatForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault(); setSaving(true);
      try { await createChat({ data: { name } as any }); toast.success("Цех создан"); onDone(); }
      catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
    }} className="space-y-4">
      <div className="space-y-1.5"><Label className="text-xs font-semibold">Название цеха или отдела</Label><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Цех сборки №1" className="rounded-xl border-primary/30 bg-background/60" /></div>
      <Button type="submit" disabled={saving} className="w-full rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-md shadow-primary/20 h-11">{saving ? "Создание…" : "Создать цех"}</Button>
    </form>
  );
}

function MembersForm({ chat, workers, initial, onDone }: { chat: Chat; workers: Worker[]; initial: string[]; onDone: () => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set(initial));
  const [saving, setSaving] = useState(false);
  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  return (
    <form onSubmit={async (e) => {
      e.preventDefault(); setSaving(true);
      try { await setChatMembers({ data: { chat_id: chat.id, member_ids: Array.from(sel) } as any }); toast.success("Состав сохранён"); onDone(); }
      catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
    }} className="space-y-4">
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1 soft-scrollbar">
        {workers.filter((w) => w.role === "worker").map((w) => (
          <label key={w.id} className="flex items-center gap-3 border border-primary/20 rounded-xl bg-background/50 hover:bg-primary/10 px-3.5 py-2.5 cursor-pointer transition">
            <Checkbox checked={sel.has(w.id)} onCheckedChange={() => toggle(w.id)} />
            <div><div className="text-sm font-bold text-foreground">{w.display_name}</div><div className="text-xs text-muted-foreground font-mono">{w.username}</div></div>
          </label>
        ))}
        {workers.filter((w) => w.role === "worker").length === 0 && <div className="text-sm text-muted-foreground text-center py-6 italic">Сначала добавьте работников на вкладке сотрудников</div>}
      </div>

      <Button type="submit" disabled={saving} className="w-full rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-md shadow-primary/20 h-11">{saving ? "Сохранение…" : "Сохранить состав цеха"}</Button>
    </form>
  );
}
