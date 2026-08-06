import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { STATUS_COLOR, STATUS_LABEL, type OrderStatus } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BrainCircuit, Sparkles, RefreshCw, Activity, CheckCircle2, AlertTriangle, Clock, Zap } from "lucide-react";
import { triggerAiPoll, deleteOrder, updateOrderDetails, importOrders } from "@/lib/orders.functions";
import { toast } from "sonner";
import { parseOrderMetadata, buildOrderMetadata } from "@/lib/order-metadata";
import { exportOrdersToExcel } from "@/lib/excel-export";
import * as XLSX from "xlsx";
import React from "react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Дашборд Nerva — Нервная система компании" }] }),
  component: Dashboard,
});

type Order = {
  id: string; number: string; nomenclature: string; status: OrderStatus;
  finish_date: string | null; responsible_user_id: string | null;
  chat_id: string | null; last_update_at: string | null; created_at: string; comment: string | null;
};

function parseRussianDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const str = String(d).trim();
  if (!str) return null;
  
  // ISO format
  if (str.match(/^\d{4}-\d{2}-\d{2}/)) return str;
  
  // Excel serial number
  if (!isNaN(Number(str))) {
    const excelDate = new Date((Number(str) - 25569) * 86400 * 1000);
    if (!isNaN(excelDate.getTime())) {
      return excelDate.toISOString().split('T')[0];
    }
  }
  
  // DD.MM or DD.MM.YYYY
  const parts = str.split(/[./-]/);
  if (parts.length >= 2) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    let year = parts[2];
    if (!year) year = String(new Date().getFullYear());
    if (year.length === 2) year = "20" + year; // handle 23.07.24
    
    if (Number(day) > 0 && Number(day) <= 31 && Number(month) > 0 && Number(month) <= 12) {
      return `${year}-${month}-${day}`;
    }
  }
  
  return null;
}

function Dashboard() {
  const { isOwner, loading } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [chats, setChats] = useState<Record<string, string>>({});
  const [polling, setPolling] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheet = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheet];
      const json = XLSX.utils.sheet_to_json(worksheet) as any[];
      
      const payload = json.map(row => ({
        number: String(row["Номер заказа"] || ""),
        nomenclature: String(row["Номенклатура"] || ""),
        order_date: parseRussianDate(row["Дата"]),
        finish_date: null,
        customer_order: row["Заказ покупателя"] ? String(row["Заказ покупателя"]) : null,
        comment: row["Комментарий"] ? String(row["Комментарий"]) : null,
        stage: row["ЭТАП"] ? String(row["ЭТАП"]) : null,
        priority: row["ПРИОРИТЕТ"] ? String(row["ПРИОРИТЕТ"]) : null,
      })).filter(o => o.number && o.nomenclature);

      if (payload.length === 0) {
        toast.error("Не удалось найти заказы в файле (проверьте заголовки колонок 'Номер заказа' и 'Номенклатура')");
        return;
      }

      const res = await importOrders({ data: payload });
      toast.success(`Импорт завершен: добавлено ${res.imported}, пропущено (дубликаты) ${res.skipped}`);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      toast.error(`Ошибка импорта: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
      setOrders((data ?? []) as Order[]);
      const { data: ps } = await supabase.from("profiles").select("id, display_name");
      setProfiles(Object.fromEntries((ps ?? []).map((p) => [p.id, p.display_name])));
      const { data: cs } = await supabase.from("chats").select("id, name");
      setChats(Object.fromEntries((cs ?? []).map((c) => [c.id, c.name])));
    };
    load();
    const ch = supabase.channel("dashboard-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  if (loading) return <div className="p-8 text-muted-foreground animate-pulse">Загрузка нервной системы Nerva…</div>;
  if (!isOwner) return <div className="p-8 text-muted-foreground">Доступно только владельцу предприятия.</div>;

  const counts = {
    total: orders.length,
    new: orders.filter((o) => o.status === "new").length,
    in_progress: orders.filter((o) => o.status === "in_progress").length,
    stalled: orders.filter((o) => o.status === "stalled").length,
    completed: orders.filter((o) => o.status === "completed").length,
    overdue: orders.filter((o) => o.status === "overdue").length,
  };

  const runAiPoll = async () => {
    setPolling(true);
    try {
      const res = await triggerAiPoll();
      toast.success(`[NERVA]: Сигнал отправлен! Опрошено активных заказов: ${res?.count ?? 0}`);
    } catch (e: any) {
      toast.error("Ошибка опроса Nerva: " + (e.message || "Сбой"));
    } finally {
      setPolling(false);
    }
  };

  return (
    <div className="soft-scrollbar h-full overflow-auto p-4 sm:p-6 space-y-6 bg-transparent relative overflow-x-hidden font-sans">
      {/* Nerva Neural Header & Control Panel */}
      <div className="border border-border/80 bg-card/90 p-5 sm:p-6 shadow-2xl relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-none">
        <div className="flex items-start sm:items-center gap-4">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground uppercase font-sans">УПРАВЛЕНИЕ ЗАКАЗАМИ</h1>
            </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <input 
            type="file" 
            accept=".xlsx, .xls" 
            ref={fileInputRef} 
            className="hidden" 
            onChange={handleFileUpload} 
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="h-11 px-5 rounded-none bg-blue-600 hover:bg-blue-700 text-white font-mono font-bold uppercase tracking-wider shadow-none"
          >
            {importing ? "[ ЗАГРУЗКА... ]" : "[ ИМПОРТ ]"}
          </Button>
          <Button
            onClick={() => exportOrdersToExcel(orders, profiles)}
            className="h-11 px-5 rounded-none bg-green-600 hover:bg-green-700 text-white font-mono font-bold uppercase tracking-wider shadow-none"
          >
            [ ЭКСПОРТ ]
          </Button>
          <Button
            onClick={runAiPoll}
            disabled={polling}
            className="h-11 px-5 rounded-none bg-primary hover:bg-primary/90 text-primary-foreground font-mono font-bold uppercase tracking-wider shadow-none"
          >
            {polling ? "[ ОПРОС В ПРОЦЕССЕ... ]" : "[ ЗАПУСТИТЬ ОПРОС ВСЕХ ЗАКАЗОВ ]"}
          </Button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4 relative z-10 font-mono">
        <Metric label="ВСЕГО ЗАКАЗОВ" value={counts.total} />
        <Metric label="В РАБОТЕ" value={counts.in_progress} tone="blue" />
        <Metric label="ПРОБЛЕМЫ" value={counts.stalled} tone="red" />
        <Metric label="ГОТОВО" value={counts.completed} tone="green" />
        <Metric label="НОВЫЕ" value={counts.new} tone="amber" />
        <Metric label="ПРОСРОЧЕНО" value={counts.overdue} tone="rose" />
      </div>

      {/* Orders Table */}
      <Card className="border border-border/80 bg-card/90 shadow-xl overflow-hidden relative z-10 rounded-none">
        <CardHeader className="border-b border-border/60 bg-background/50 px-5 py-4 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold font-sans uppercase tracking-tight">
              <span>ПАНЕЛЬ КОНТРОЛЯ ЗАКАЗОВ В РЕАЛЬНОМ ВРЕМЕНИ</span>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="font-mono text-xs">
            <TableHeader className="bg-background/40">
              <TableRow className="border-b border-border/60 hover:bg-transparent">
                <TableHead className="font-bold text-foreground py-3.5 pl-5 uppercase">№ ЗАКАЗА</TableHead>
                <TableHead className="font-bold text-foreground uppercase">ЭТАП / ПРИОРИТЕТ</TableHead>
                <TableHead className="font-bold text-foreground uppercase">НОМЕНКЛАТУРА</TableHead>
                <TableHead className="font-bold text-foreground uppercase">ЧАТ / ЦЕХ</TableHead>
                <TableHead className="font-bold text-foreground uppercase">ОТВЕТСТВЕННЫЙ</TableHead>
                <TableHead className="font-bold text-foreground uppercase">СРОК СДАЧИ</TableHead>
                <TableHead className="font-bold text-foreground uppercase">ПОСЛЕДНИЙ СИГНАЛ</TableHead>
                <TableHead className="font-bold text-foreground pr-5 uppercase">СТАТУС NERVA</TableHead>
                <TableHead className="font-bold text-foreground pr-5 uppercase text-right">ДЕЙСТВИЯ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => {
                const meta = parseOrderMetadata(o.comment);
                return (
                <TableRow key={o.id} className="border-b border-border/40 hover:bg-primary/5">
                  <TableCell className="font-mono font-bold text-xs pl-5 text-primary">{o.number}</TableCell>
                  <TableCell className="text-xs">
                    <span className="font-bold text-cyan-400 block">{meta.stage.toUpperCase()}</span>
                    <span className="text-muted-foreground text-[10px] uppercase">{meta.priority}</span>
                  </TableCell>
                  <TableCell className="max-w-xs truncate font-sans font-semibold" title={meta.comment ? "Коммент: " + meta.comment : ""}>{o.nomenclature}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{o.chat_id ? chats[o.chat_id] || "Чат цеха" : "—"}</TableCell>
                  <TableCell className="text-xs font-medium">{o.responsible_user_id ? profiles[o.responsible_user_id] ?? "Сотрудник" : <span className="text-muted-foreground italic">Не назначен</span>}</TableCell>
                  <TableCell className="text-xs">{o.finish_date ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{o.last_update_at ? new Date(o.last_update_at).toLocaleString("ru", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</TableCell>
                  <TableCell className="pr-5">
                    <span className={`${STATUS_COLOR[o.status]} border border-current px-2.5 py-0.5 font-bold uppercase text-[10px] tracking-wider rounded-none inline-block`}>
                      {STATUS_LABEL[o.status]}
                    </span>
                  </TableCell>
                  <TableCell className="pr-5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingOrder(o)}
                        className="h-7 px-2 rounded-none text-[10px] font-mono border-primary/50 hover:bg-primary hover:text-primary-foreground uppercase"
                      >
                        [ ИЗМЕНИТЬ ]
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          if (!confirm(`Вы уверены, что хотите удалить заказ №${o.number}?`)) return;
                          try {
                            await deleteOrder({ data: { order_id: o.id } });
                            toast.success(`Заказ №${o.number} удалён из системы`);
                          } catch (err: any) {
                            toast.error("Ошибка удаления: " + err.message);
                          }
                        }}
                        className="h-7 px-2 rounded-none text-[10px] font-mono border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground uppercase"
                      >
                        [ УДАЛИТЬ ]
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )})}
              {orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-12 font-mono uppercase">
                    ЗАКАЗОВ ПОКА НЕТ. СИСТЕМА ОЖИДАЕТ ВВОДА НОВЫХ ПОЗИЦИЙ.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Модальное окно редактирования заказа */}
      {editingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono">
          <div className="bg-card border border-border w-full max-w-lg p-6 space-y-4 shadow-2xl rounded-none">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h2 className="text-lg font-bold uppercase tracking-wider text-foreground">
                [ РЕДАКТИРОВАНИЕ ЗАКАЗА №{editingOrder.number} ]
              </h2>
              <button onClick={() => setEditingOrder(null)} className="text-muted-foreground hover:text-foreground font-bold">
                ✕
              </button>
            </div>
            
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[10px] uppercase text-muted-foreground mb-1">Номер заказа</label>
                <input
                  type="text"
                  defaultValue={editingOrder.number}
                  id="edit-order-number"
                  className="w-full bg-background border border-border px-3 py-2 text-foreground font-mono focus:outline-none focus:border-primary rounded-none"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-muted-foreground mb-1">Номенклатура</label>
                <input
                  type="text"
                  defaultValue={editingOrder.nomenclature}
                  id="edit-order-nom"
                  className="w-full bg-background border border-border px-3 py-2 text-foreground font-mono focus:outline-none focus:border-primary rounded-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase text-muted-foreground mb-1">Этап</label>
                  <select
                    defaultValue={parseOrderMetadata(editingOrder.comment).stage}
                    id="edit-order-stage"
                    className="w-full bg-background border border-border px-3 py-2 text-foreground font-mono focus:outline-none focus:border-primary rounded-none"
                  >
                    <option value="Новый">Новый</option>
                    <option value="Производство">Производство</option>
                    <option value="Логистика">Логистика</option>
                    <option value="Готово">Готово</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-muted-foreground mb-1">Приоритет</label>
                  <select
                    defaultValue={parseOrderMetadata(editingOrder.comment).priority}
                    id="edit-order-priority"
                    className="w-full bg-background border border-border px-3 py-2 text-foreground font-mono focus:outline-none focus:border-primary rounded-none"
                  >
                    <option value="Обычный">Обычный</option>
                    <option value="Средний">Средний</option>
                    <option value="Высокий">Высокий</option>
                    <option value="Срочно">Срочно</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase text-muted-foreground mb-1">Доп. Комментарий</label>
                <input
                  type="text"
                  defaultValue={parseOrderMetadata(editingOrder.comment).comment}
                  id="edit-order-comment"
                  className="w-full bg-background border border-border px-3 py-2 text-foreground font-mono focus:outline-none focus:border-primary rounded-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase text-muted-foreground mb-1">Статус</label>
                  <select
                    defaultValue={editingOrder.status}
                    id="edit-order-status"
                    className="w-full bg-background border border-border px-3 py-2 text-foreground font-mono focus:outline-none focus:border-primary rounded-none"
                  >
                    <option value="new">НОВЫЙ (NEW)</option>
                    <option value="in_progress">В РАБОТЕ (IN PROGRESS)</option>
                    <option value="stalled">ПРОБЛЕМА (STALLED)</option>
                    <option value="completed">ГОТОВО (COMPLETED)</option>
                    <option value="overdue">ПРОСРОЧЕН (OVERDUE)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-muted-foreground mb-1">Срок сдачи (YYYY-MM-DD)</label>
                  <input
                    type="date"
                    defaultValue={editingOrder.finish_date || ""}
                    id="edit-order-date"
                    className="w-full bg-background border border-border px-3 py-2 text-foreground font-mono focus:outline-none focus:border-primary rounded-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase text-muted-foreground mb-1">Ответственный сотрудник</label>
                <select
                  defaultValue={editingOrder.responsible_user_id || ""}
                  id="edit-order-resp"
                  className="w-full bg-background border border-border px-3 py-2 text-foreground font-mono focus:outline-none focus:border-primary rounded-none"
                >
                  <option value="">— Не назначен —</option>
                  {Object.entries(profiles).map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/60">
              <Button
                variant="outline"
                onClick={() => setEditingOrder(null)}
                className="rounded-none text-xs uppercase h-9 px-4 border-border hover:bg-muted"
              >
                ОТМЕНА
              </Button>
              <Button
                onClick={async () => {

                  const numEl = document.getElementById("edit-order-number") as HTMLInputElement;
                  const nomEl = document.getElementById("edit-order-nom") as HTMLInputElement;
                  const statusEl = document.getElementById("edit-order-status") as HTMLSelectElement;
                  const dateEl = document.getElementById("edit-order-date") as HTMLInputElement;
                  const respEl = document.getElementById("edit-order-resp") as HTMLSelectElement;
                  
                  const stageEl = document.getElementById("edit-order-stage") as HTMLSelectElement;
                  const priorityEl = document.getElementById("edit-order-priority") as HTMLSelectElement;
                  const commentEl = document.getElementById("edit-order-comment") as HTMLInputElement;
                  
                  const newCommentStr = buildOrderMetadata({
                    stage: stageEl.value as any,
                    priority: priorityEl.value as any,
                    comment: commentEl.value.trim()
                  }, editingOrder.comment);

                  try {
                    await updateOrderDetails({
                      data: {
                        order_id: editingOrder.id,
                        number: numEl.value.trim() || editingOrder.number,
                        nomenclature: nomEl.value.trim() || editingOrder.nomenclature,
                        status: statusEl.value as any,
                        finish_date: dateEl.value ? dateEl.value : null,
                        responsible_user_id: respEl.value ? respEl.value : null,
                        comment: newCommentStr
                      }

                    });
                    toast.success(`Заказ №${numEl.value} успешно обновлён!`);
                    setEditingOrder(null);
                  } catch (err: any) {
                    toast.error("Ошибка сохранения: " + err.message);
                  }
                }}
                className="rounded-none text-xs uppercase h-9 px-5 bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
              >
                [ СОХРАНИТЬ ]
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "blue" | "amber" | "red" | "green" | "rose" }) {
  const toneMap = {
    blue: { text: "text-blue-400", border: "border-blue-500/40 bg-blue-500/5" },
    amber: { text: "text-amber-400", border: "border-amber-500/40 bg-amber-500/5" },
    red: { text: "text-red-400", border: "border-red-500/40 bg-red-500/5" },
    green: { text: "text-emerald-400", border: "border-emerald-500/40 bg-emerald-500/5" },
    rose: { text: "text-rose-400", border: "border-rose-500/40 bg-rose-500/5" },
  };
  const t = tone ? toneMap[tone] : { text: "text-primary", border: "border-primary/40 bg-primary/5" };

  return (
    <Card className={`border ${t.border} rounded-none shadow-none overflow-hidden bg-card/80`}>
      <CardContent className="p-4 flex flex-col justify-between">
        <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">{label}</div>
        <div className={`text-2xl sm:text-3xl font-black mt-2 font-mono ${t.text}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
