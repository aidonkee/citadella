import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/use-auth";
import { createOrder } from "@/lib/orders.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Send } from "lucide-react";

export const Route = createFileRoute("/_authenticated/manager/new")({
  head: () => ({ meta: [{ title: "Новый заказ — OrderFlow" }] }),
  component: ManagerNew,
});

function ManagerNew() {
  const { isManager, isOwner, loading } = useAuth();
  const [f, setF] = useState({ number: "", nomenclature: "", finish_date: "", customer_order: "", comment: "" });
  const [saving, setSaving] = useState(false);

  if (loading) return <div className="p-8 text-muted-foreground">Загрузка…</div>;
  if (!isManager && !isOwner) return <div className="p-8 text-muted-foreground">Доступ только для менеджера.</div>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await createOrder({ data: { ...f, finish_date: f.finish_date || null, customer_order: f.customer_order || null, comment: f.comment || null, chat_id: null } as any });
      toast.success("Заказ отправлен владельцу");
      setF({ number: "", nomenclature: "", finish_date: "", customer_order: "", comment: "" });
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="soft-scrollbar h-full overflow-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Новый заказ</h1>
        <p className="text-sm text-muted-foreground">Заполните данные и нажмите «Отправить». Владелец распределит заказ по чатам.</p>
      </div>

      <Card className="border-border/40 bg-background/25 backdrop-blur">
        <CardHeader><CardTitle className="text-base">Данные заказа</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Номер</Label><Input required value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></div>
              <div><Label>Срок (Финиш)</Label><Input type="date" value={f.finish_date} onChange={(e) => setF({ ...f, finish_date: e.target.value })} /></div>
            </div>
            <div><Label>Номенклатура</Label><Textarea required value={f.nomenclature} onChange={(e) => setF({ ...f, nomenclature: e.target.value })} rows={3} /></div>
            <div><Label>Заказ покупателя</Label><Input value={f.customer_order} onChange={(e) => setF({ ...f, customer_order: e.target.value })} /></div>
            <div><Label>Комментарий</Label><Input value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} /></div>
            <Button type="submit" disabled={saving} className="w-full"><Send className="size-4 mr-2" />{saving ? "Отправка…" : "Отправить владельцу"}</Button>
          </form>
        </CardContent>
      </Card>

    </div>
  );
}
