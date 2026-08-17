import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { createOrder } from "@/lib/orders.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { STATUS_COLOR, STATUS_LABEL, type OrderStatus } from "@/lib/types";
import { Upload, Plus } from "lucide-react";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_authenticated/admin/orders")({
  head: () => ({ meta: [{ title: "Заказы — OrderFlow" }] }),
  component: OrdersAdmin,
});

type Order = {
  id: string; number: string; nomenclature: string; status: OrderStatus;
  finish_date: string | null; chat_id: string | null; created_at: string;
  customer_order: string | null; comment: string | null;
};

function OrdersAdmin() {
  const { isOwner, loading } = useAuth();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [chats, setChats] = useState<{ id: string; name: string }[]>([]);
  const [assignments, setAssignments] = useState<{ order_id: string; chat_id: string; status: string; responsible_user_id: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    setOrders((data ?? []) as Order[]);
    const { data: cs } = await supabase.from("chats").select("id, name").eq("is_dm", false);
    setChats(cs ?? []);
    const { data: oa, error: oaErr } = await supabase.from("order_assignments").select("order_id, chat_id, status, responsible_user_id");
    if (oaErr) {
      // До миграции: сектора = dispatched_chat_ids / chat_id заказа
      setAssignments(((data ?? []) as any[]).flatMap((o: any) => {
        const sectors = [...(Array.isArray(o.dispatched_chat_ids) ? o.dispatched_chat_ids : []), ...(o.chat_id ? [o.chat_id] : [])];
        return Array.from(new Set(sectors.filter(Boolean))).map((cid) => ({
          order_id: o.id, chat_id: cid as string,
          status: o.responsible_user_id ? "in_progress" : o.status, responsible_user_id: o.responsible_user_id,
        }));
      }));
    } else {
      setAssignments(oa ?? []);
    }
  };
  useEffect(() => { load(); }, []);

  const onImport = async (file: File) => {
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: "" });
      let ok = 0;
      for (const r of rows) {
        const number = String(r["Номер"] ?? r["номер"] ?? r["Number"] ?? "").trim();
        const nomenclature = String(r["Номенклатура"] ?? r["номенклатура"] ?? "").trim();
        if (!number || !nomenclature) continue;
        const finishRaw = r["Финиш"] ?? r["финиш"] ?? r["Finish"] ?? "";
        const finish = parseDate(finishRaw);
        const customer_order = String(r["Заказ покупателя"] ?? "").trim() || null;
        const comment = String(r["Комментарий"] ?? "").trim() || null;
        try {
          await createOrder({ data: { number, nomenclature, finish_date: finish, customer_order, comment, chat_id: null } as any });
          ok++;
        } catch {}
      }
      toast.success(`Импортировано: ${ok} из ${rows.length}`);
      await load();
    } catch (e: any) { toast.error(e.message); }
    finally { setImporting(false); }
  };

  if (loading) return <div className="p-8 text-muted-foreground">Загрузка…</div>;
  if (!isOwner) return <div className="p-8 text-muted-foreground">Только для владельца.</div>;

  return (
    <div className="soft-scrollbar h-full overflow-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Заказы</h1>
          <p className="text-sm text-muted-foreground">Создайте заказ вручную или загрузите Excel</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ""; }} />
          <Button variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}>
            <Upload className="size-4 mr-2" />{importing ? "Импорт…" : "Импорт Excel"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4 mr-2" />Новый заказ</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Новый заказ</DialogTitle></DialogHeader>
              <NewOrderForm chats={chats} onDone={() => { setOpen(false); load(); }} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="border-border/40">
        <CardHeader><CardTitle className="text-base">Список заказов</CardTitle></CardHeader>
        <CardContent className="px-2 sm:px-6">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Номер</TableHead><TableHead>Номенклатура</TableHead>
              <TableHead>Срок</TableHead><TableHead>Сектора</TableHead><TableHead>Статус</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {orders.map((o) => {
                const oa = assignments.filter(a => a.order_id === o.id && a.status !== "cancelled");
                return (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{o.number}</TableCell>
                    <TableCell className="max-w-md truncate">{o.nomenclature}</TableCell>
                    <TableCell>{o.finish_date ?? "—"}</TableCell>
                    <TableCell>
                      {oa.length === 0 ? (
                        <span className="text-muted-foreground text-xs">не распределён</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {oa.map(a => (
                            <span key={a.chat_id} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                              a.status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                              a.status === "in_progress" ? "bg-blue-50 text-blue-700 border-blue-200" :
                              a.status === "stalled" || a.status === "blocked" ? "bg-red-50 text-red-700 border-red-200" :
                              "bg-amber-50 text-amber-700 border-amber-200"
                            }`}>
                              {chats.find(c => c.id === a.chat_id)?.name ?? "цех"}
                            </span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_COLOR[o.status]}>{STATUS_LABEL[o.status]}</Badge></TableCell>
                  </TableRow>
                );
              })}
              {orders.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Заказов пока нет</TableCell></TableRow>}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function NewOrderForm({ chats, onDone }: { chats: { id: string; name: string }[]; onDone: () => void }) {
  const [form, setForm] = useState({ number: "", nomenclature: "", finish_date: "", chat_id: "", customer_order: "", comment: "" });
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await createOrder({ data: { ...form, finish_date: form.finish_date || null, chat_id: form.chat_id || null, customer_order: form.customer_order || null, comment: form.comment || null } as any });
      toast.success("Заказ создан, ИИ сформировал карточку"); onDone();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Номер</Label><Input required value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></div>
        <div><Label>Срок (Финиш)</Label><Input type="date" value={form.finish_date} onChange={(e) => setForm({ ...form, finish_date: e.target.value })} /></div>
      </div>
      <div><Label>Номенклатура</Label><Textarea required value={form.nomenclature} onChange={(e) => setForm({ ...form, nomenclature: e.target.value })} /></div>
      <div><Label>Заказ покупателя</Label><Input value={form.customer_order} onChange={(e) => setForm({ ...form, customer_order: e.target.value })} /></div>
      <div><Label>Комментарий</Label><Input value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></div>
      <div><Label>Чат для распределения</Label>
        <Select value={form.chat_id} onValueChange={(v) => setForm({ ...form, chat_id: v })}>
          <SelectTrigger><SelectValue placeholder="Не назначен" /></SelectTrigger>
          <SelectContent>{chats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={saving} className="w-full">{saving ? "Создание…" : "Создать"}</Button>
    </form>
  );
}

function parseDate(v: any): string | null {
  if (!v) return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s); return isNaN(+d) ? null : d.toISOString().slice(0, 10);
}
