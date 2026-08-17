import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import { getNotificationSettings, saveNotificationSettings } from "@/lib/notifications.functions";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  component: SettingsPage,
});

type S = {
  realtime_status_changes: boolean;
  realtime_worker_replies: boolean;
  realtime_new_claims: boolean;
  email_status_changes: boolean;
  email_worker_replies: boolean;
  email_new_claims: boolean;
  email_address: string | null;
};

function SettingsPage() {
  const { user, isOwner, loading } = useAuth();
  const [s, setS] = useState<S | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    getNotificationSettings().then((d: any) => setS({
      realtime_status_changes: !!d.realtime_status_changes,
      realtime_worker_replies: !!d.realtime_worker_replies,
      realtime_new_claims: !!d.realtime_new_claims,
      email_status_changes: !!d.email_status_changes,
      email_worker_replies: !!d.email_worker_replies,
      email_new_claims: !!d.email_new_claims,
      email_address: d.email_address ?? user?.email ?? null,
    }));
  }, [user, isOwner]);

  if (loading) return <div className="p-6 text-muted-foreground">Загрузка…</div>;
  if (!isOwner) return <div className="p-6 text-muted-foreground">Доступно только владельцу предприятия.</div>;
  if (!s) return <div className="p-6 text-muted-foreground">Загрузка…</div>;

  const set = <K extends keyof S>(k: K, v: S[K]) => setS({ ...s, [k]: v });

  const save = async () => {
    setSaving(true);
    try {
      await saveNotificationSettings({ data: s as any });
      toast.success("Сохранено");
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const Row = ({ label, rt, em, onRt, onEm }: { label: string; rt: boolean; em: boolean; onRt: (v: boolean) => void; onEm: (v: boolean) => void }) => (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 items-center py-3 border-b border-border/40 last:border-0">
      <div className="min-w-0 text-sm">{label}</div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="hidden sm:inline">В приложении</span><Switch checked={rt} onCheckedChange={onRt} /></div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="hidden sm:inline">Email</span><Switch checked={em} onCheckedChange={onEm} /></div>
    </div>
  );

  return (
    <div className="soft-scrollbar h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Уведомления владельца</h1>
          <p className="text-sm text-muted-foreground">Выберите, какие события показывать в приложении (realtime) и/или отправлять на email.</p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Email для уведомлений</CardTitle></CardHeader>
          <CardContent>
            <Label className="text-xs text-muted-foreground">Адрес</Label>
            <Input value={s.email_address ?? ""} onChange={(e) => set("email_address", e.target.value || null)} placeholder="owner@example.com" />
            <p className="text-xs text-muted-foreground mt-2">Email-рассылка требует настроенного email-домена проекта.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">События</CardTitle></CardHeader>
          <CardContent className="divide-y divide-border/40">
            <Row label="Смена статуса заказа" rt={s.realtime_status_changes} em={s.email_status_changes}
              onRt={(v) => set("realtime_status_changes", v)} onEm={(v) => set("email_status_changes", v)} />
            <Row label="Ответ работника в чате" rt={s.realtime_worker_replies} em={s.email_worker_replies}
              onRt={(v) => set("realtime_worker_replies", v)} onEm={(v) => set("email_worker_replies", v)} />
            <Row label="Новый отклик на заказ" rt={s.realtime_new_claims} em={s.email_new_claims}
              onRt={(v) => set("realtime_new_claims", v)} onEm={(v) => set("email_new_claims", v)} />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving ? "Сохраняем…" : "Сохранить"}</Button>
        </div>
      </div>
    </div>
  );
}
