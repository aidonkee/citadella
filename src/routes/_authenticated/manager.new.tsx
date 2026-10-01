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
    <div className="soft-scrollbar h-full overflow-y-auto bg-background p-4 sm:p-6 space-y-4 sm:space-y-5 pb-24 md:pb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Новый заказ</h1>
        <p className="text-sm text-muted-foreground font-medium">Заполните данные и нажмите «Отправить». Владелец распределит заказ по чатам.</p>
      </div>

      <Card className="border border-border bg-white shadow-sm rounded-xl overflow-hidden max-w-3xl">
        <CardHeader className="border-b border-border bg-muted/50 px-6 py-4">
          <CardTitle className="text-base font-bold text-foreground tracking-tight">
            Данные заказа
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-sm font-medium">Номер заказа</Label>
                <Input 
                  required 
                  placeholder="Например: 44 или НФ-0044" 
                  value={f.number} 
                  onChange={(e) => setF({ ...f, number: e.target.value })} 
                  className="h-11 text-base rounded-lg border border-border bg-card px-3"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">Срок (Финиш)</Label>
                <Input 
                  type="date" 
                  value={f.finish_date} 
                  onChange={(e) => setF({ ...f, finish_date: e.target.value })} 
                  className="h-11 text-base rounded-lg border border-border bg-card px-3"
                />
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">Номенклатура (Изделие, размеры, детали)</Label>
              <Textarea 
                required 
                placeholder="Описание номенклатуры заказа..." 
                value={f.nomenclature} 
                onChange={(e) => setF({ ...f, nomenclature: e.target.value })} 
                rows={3} 
                className="text-base rounded-lg border border-border bg-card px-3 py-2.5 min-h-[96px]"
              />
            </div>

            <div>
              <Label className="text-sm font-medium">Заказ покупателя (необязательно)</Label>
              <Input 
                placeholder="Привязать номер заказа клиента..." 
                value={f.customer_order} 
                onChange={(e) => setF({ ...f, customer_order: e.target.value })} 
                className="h-11 text-base rounded-lg border border-border bg-card px-3"
              />
            </div>

            <div>
              <Label className="text-sm font-medium">Комментарий (необязательно)</Label>
              <Input 
                placeholder="Дополнительные указания или спецификации..." 
                value={f.comment} 
                onChange={(e) => setF({ ...f, comment: e.target.value })} 
                className="h-11 text-base rounded-lg border border-border bg-card px-3"
              />
            </div>

            <Button type="submit" disabled={saving} className="w-full h-12 text-base font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-colors mt-2">
              <Send className="size-4 mr-2" />
              {saving ? "Отправка…" : "Отправить владельцу"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
