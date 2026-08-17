import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  component: AuditPage,
});

type Row = {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: any;
  created_at: string;
};

const ACTION_LABEL: Record<string, string> = {
  "chat.created": "Создан чат",
  "chat.members_set": "Изменён доступ к чату",
  "chat.deleted": "Удалён чат",
  "order.created": "Создан заказ",
  "order.status_changed": "Сменён статус заказа",
  "claim.pending": "Отклик на заказ",
  "claim.confirmed": "Заказ подтверждён",
  "claim.rejected": "Заказ отклонён",
  "message.sent": "Сообщение пользователя",
  "message.ai_sent": "Сообщение ИИ",
  "user.created": "Создан сотрудник",
};

function AuditPage() {
  const { isOwner, loading } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOwner) return;
    const load = async () => {
      const { data } = await supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(300);
      const list = (data ?? []) as Row[];
      setRows(list);
      const ids = [...new Set(list.map((r) => r.actor_user_id).filter(Boolean))] as string[];
      if (ids.length) {
        const { data: ps } = await supabase.from("profiles").select("id, display_name").in("id", ids);
        setNames(Object.fromEntries((ps ?? []).map((p) => [p.id, p.display_name])));
      }
    };
    load();
    const ch = supabase.channel("audit-log")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_log" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isOwner]);

  if (loading) return <div className="p-6 text-muted-foreground">Загрузка…</div>;
  if (!isOwner) return <div className="p-6 text-muted-foreground">Доступно только владельцу предприятия.</div>;

  return (
    <div className="soft-scrollbar h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-semibold mb-1">Журнал аудита</h1>
        <p className="text-sm text-muted-foreground mb-5">Все действия владельца, сотрудников и ИИ-ассистента.</p>
        <div className="glass-panel soft-scrollbar rounded-2xl border border-border/40 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 w-44">Когда</th>
                <th className="text-left px-3 py-2 w-44">Кто</th>
                <th className="text-left px-3 py-2 w-56">Действие</th>
                <th className="text-left px-3 py-2">Детали</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/40 align-top transition hover:bg-muted/25">
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString("ru")}</td>
                  <td className="px-3 py-2">{r.actor_user_id ? (names[r.actor_user_id] ?? "—") : <span className="text-primary">ИИ</span>}</td>
                  <td className="px-3 py-2">{ACTION_LABEL[r.action] ?? r.action}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground"><code className="break-all">{JSON.stringify(r.details)}</code></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">Событий пока нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
