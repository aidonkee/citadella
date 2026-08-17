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
  const [departmentChats, setDepartmentChats] = useState<{ id: string; name: string }[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<"matrix" | "kanban">("matrix");
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
      const { data: cs } = await supabase.from("chats").select("id, name, is_dm").order("name");
      setChats(Object.fromEntries((cs ?? []).map((c) => [c.id, c.name])));
      setDepartmentChats((cs ?? []).filter(c => !c.is_dm));

      const { data: oa } = await supabase.from("order_assignments").select("*");
      setAssignments(oa ?? []);
    };
    load();
    const ch = supabase.channel("dashboard-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_assignments" }, load)
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
      <div className="border border-slate-200 bg-white p-4 sm:p-6 shadow-sm rounded-xl relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-4">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 font-sans">Управление заказами</h1>
            </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0 w-full md:w-auto">
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
            className="h-10 sm:h-11 px-4 sm:px-5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium shadow-none w-full sm:w-auto border border-blue-200 transition-colors"
          >
            {importing ? "Загрузка..." : "Импорт"}
          </Button>
          <Button
            onClick={() => exportOrdersToExcel(orders, profiles)}
            className="h-10 sm:h-11 px-4 sm:px-5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-bold shadow-sm w-full sm:w-auto transition-colors"
          >
            Экспорт в Excel
          </Button>
          <Button
            onClick={runAiPoll}
            disabled={polling}
            className="h-10 sm:h-11 px-4 sm:px-5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm w-full sm:w-auto transition-colors"
          >
            {polling ? "Опрос в процессе..." : "Опрос заказов"}
          </Button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4 relative z-10">
        <Metric label="Всего" value={counts.total} />
        <Metric label="В работе" value={counts.in_progress} tone="blue" />
        <Metric label="Проблемы" value={counts.stalled} tone="red" />
        <Metric label="Готово" value={counts.completed} tone="green" />
        <Metric label="Новые" value={counts.new} tone="amber" />
        <Metric label="Просрочено" value={counts.overdue} tone="rose" />
      </div>

      {/* Orders View Card */}
      <Card className="border border-slate-200 bg-white shadow-sm overflow-hidden relative z-10 rounded-xl">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base font-semibold text-slate-800 tracking-tight">
              Панель производства
            </CardTitle>
            <span className="text-xs text-slate-500 font-medium bg-slate-100 px-2.5 py-0.5 rounded-full">
              Заказов: {orders.length}
            </span>
          </div>

          <div className="flex items-center gap-1 bg-slate-200/60 p-1 rounded-lg border border-slate-200/80 w-full sm:w-auto">
            <button
              onClick={() => setViewMode("matrix")}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                viewMode === "matrix"
                  ? "bg-white text-slate-900 shadow-xs border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Матрица по цехам
            </button>
            <button
              onClick={() => setViewMode("kanban")}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                viewMode === "kanban"
                  ? "bg-white text-slate-900 shadow-xs border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Канбан этапов
            </button>
          </div>
        </CardHeader>

        <CardContent className="p-0 bg-white">
          {viewMode === "matrix" ? (
            <div className="overflow-x-auto min-h-[450px]">
              <Table>
                <TableHeader className="bg-slate-50 border-b border-slate-200">
                  <TableRow>
                    <TableHead className="font-bold text-slate-800 text-xs uppercase tracking-wider py-3.5 px-4 whitespace-nowrap">№ Заказа</TableHead>
                    <TableHead className="font-bold text-slate-800 text-xs uppercase tracking-wider py-3.5 px-4 min-w-[200px]">Номенклатура</TableHead>
                    <TableHead className="font-bold text-slate-800 text-xs uppercase tracking-wider py-3.5 px-4 whitespace-nowrap">Срок</TableHead>
                    <TableHead className="font-bold text-slate-800 text-xs uppercase tracking-wider py-3.5 px-4 whitespace-nowrap">Общий статус</TableHead>
                    {departmentChats.map(c => (
                      <TableHead key={c.id} className="font-bold text-slate-800 text-xs uppercase tracking-wider py-3.5 px-4 text-center whitespace-nowrap min-w-[130px]">
                        {c.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map(o => {
                    const meta = parseOrderMetadata(o);
                    return (
                      <TableRow key={o.id} className="hover:bg-slate-50/80 border-b border-slate-100 transition-colors">
                        <TableCell className="font-bold text-slate-900 text-sm py-3 px-4 whitespace-nowrap">
                          <button 
                            onClick={() => setEditingOrder(o)}
                            className="hover:text-blue-600 hover:underline font-mono text-base"
                          >
                            #{o.number}
                          </button>
                        </TableCell>
                        <TableCell className="text-slate-800 text-xs font-semibold py-3 px-4 max-w-[280px]">
                          <div className="line-clamp-2" title={o.nomenclature}>
                            {o.nomenclature}
                          </div>
                          {meta.priority && meta.priority !== "Обычный" && (
                            <span className="inline-block mt-1 text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200">
                              {meta.priority}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-slate-600 text-xs py-3 px-4 whitespace-nowrap font-medium">
                          {o.finish_date ? new Date(o.finish_date).toLocaleDateString("ru-RU") : "—"}
                        </TableCell>
                        <TableCell className="py-3 px-4 whitespace-nowrap">
                          <span className={`px-2.5 py-1 rounded-md text-xs font-bold border ${STATUS_COLOR[o.status]}`}>
                            {STATUS_LABEL[o.status]}
                          </span>
                        </TableCell>

                        {departmentChats.map(c => {
                          let a = assignments.find(x => x.order_id === o.id && x.chat_id === c.id);
                          const isDispatched = Boolean(
                            a ||
                            (Array.isArray(o.dispatched_chat_ids) && o.dispatched_chat_ids.includes(c.id)) ||
                            o.chat_id === c.id
                          );

                          if (!isDispatched) {
                            return (
                              <TableCell key={c.id} className="text-center py-3 px-4 whitespace-nowrap">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-50 text-slate-400 border border-slate-200/50">
                                  ⚪ Не назначался
                                </span>
                              </TableCell>
                            );
                          }

                          if (!a) {
                            a = { status: "new", responsible_user_id: null };
                          }
                          if (a.status === "completed") {
                            return (
                              <TableCell key={c.id} className="text-center py-3 px-4 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                                  🟢 Сделано
                                </span>
                              </TableCell>
                            );
                          }
                          if (a.status === "new" && !a.responsible_user_id) {
                            return (
                              <TableCell key={c.id} className="text-center py-3 px-4 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 shadow-2xs">
                                  🟡 Ожидает отклика
                                </span>
                              </TableCell>
                            );
                          }
                          const workerName = a.responsible_user_id ? profiles[a.responsible_user_id] : null;
                          return (
                            <TableCell key={c.id} className="text-center py-3 px-4 whitespace-nowrap">
                              <div className="inline-flex flex-col items-center">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs">
                                  🔴 В работе
                                </span>
                                {workerName && (
                                  <span className="text-[10px] text-slate-600 font-semibold mt-0.5">
                                    {workerName}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                  {orders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4 + departmentChats.length} className="text-center py-8 text-slate-400 text-sm">
                        Заказы отсутствуют
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-4 sm:p-6 bg-slate-50/30 overflow-x-auto min-h-[500px]">
              <div className="flex flex-row gap-4 h-full min-w-max">
                {["Новый", "Производство", "Логистика", "Готово"].map(stage => {
                  const stageOrders = orders.filter(o => parseOrderMetadata(o).stage === stage);
                  
                  return (
                    <div key={stage} className="w-[85vw] sm:w-[320px] shrink-0 flex flex-col h-full bg-slate-100/60 rounded-xl border border-slate-200/60 overflow-hidden">
                      {/* Column Header */}
                      <div className="p-3 border-b border-slate-200/60 bg-white flex items-center justify-between sticky top-0 z-10">
                        <h3 className="font-bold text-slate-800 text-sm tracking-tight">{stage}</h3>
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-xs font-semibold">{stageOrders.length}</span>
                      </div>

                      {/* Column Content */}
                      <div className="p-3 flex-1 overflow-y-auto space-y-3 min-h-[200px]">
                        {stageOrders.map(o => {
                          const meta = parseOrderMetadata(o);
                          const priorityStyle = {
                            "Срочно": "bg-red-50 text-red-700 border-red-200",
                            "Высокий": "bg-orange-50 text-orange-700 border-orange-200",
                            "Средний": "bg-blue-50 text-blue-700 border-blue-200",
                            "Обычный": "bg-slate-50 text-slate-600 border-slate-200"
                          }[meta.priority] || "bg-slate-50 text-slate-600 border-slate-200";

                          return (
                            <div 
                              key={o.id} 
                              className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition-all flex flex-col group relative"
                            >
                              <div className="flex justify-between items-start mb-2 gap-2 cursor-pointer" onClick={() => setEditingOrder(o)}>
                                <div className="flex items-center gap-2">
                                  <span className="font-black text-slate-900 text-base sm:text-lg tracking-tight">#{o.number}</span>
                                </div>
                                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-md border ${priorityStyle}`}>
                                  {meta.priority}
                                </span>
                              </div>
                              
                              <div className="text-slate-800 text-sm font-semibold leading-snug mb-3 cursor-pointer" onClick={() => setEditingOrder(o)}>
                                {o.nomenclature}
                              </div>
                              
                              {meta.comment && (
                                <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-md p-2 mb-3 leading-relaxed cursor-pointer" onClick={() => setEditingOrder(o)}>
                                  {meta.comment}
                                </div>
                              )}

                              <div className="flex justify-between items-end mt-auto pt-3 border-t border-slate-100">
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Сотрудник</span>
                                  <span className="text-xs text-slate-600 font-medium truncate max-w-[100px]">
                                    {o.responsible_user_id ? (profiles[o.responsible_user_id] ?? "Сотрудник") : "—"}
                                  </span>
                                </div>
                                
                                <select
                                  value={meta.stage}
                                  onChange={async (e) => {
                                    const newStage = e.target.value;
                                    const newComment = buildOrderMetadata({ ...meta, stage: newStage as any }, o.comment);
                                    toast.success(`Заказ #${o.number} перемещается...`);
                                    try {
                                      await updateOrderDetails({
                                        data: { order_id: o.id, comment: newComment }
                                      });
                                    } catch (err: any) {
                                      toast.error(err.message);
                                    }
                                  }}
                                  className="text-xs bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-medium py-1.5 px-2 rounded-md transition-colors cursor-pointer outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                  <option value="Новый">Новый ➜</option>
                                  <option value="Производство">Производство ➜</option>
                                  <option value="Логистика">Логистика ➜</option>
                                  <option value="Готово">Готово ➜</option>
                                </select>
                              </div>
                            </div>
                          )
                        })}
                        {stageOrders.length === 0 && (
                          <div className="text-center p-4 text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-lg">
                            Нет заказов
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
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
    blue: { text: "text-blue-700", border: "border-blue-200", bg: "bg-blue-50" },
    amber: { text: "text-amber-700", border: "border-amber-200", bg: "bg-amber-50" },
    red: { text: "text-red-700", border: "border-red-200", bg: "bg-red-50" },
    green: { text: "text-emerald-700", border: "border-emerald-200", bg: "bg-emerald-50" },
    rose: { text: "text-rose-700", border: "border-rose-200", bg: "bg-rose-50" },
  };
  const t = tone ? toneMap[tone] : { text: "text-slate-800", border: "border-slate-200", bg: "bg-white" };

  return (
    <Card className={`border ${t.border} rounded-xl shadow-sm overflow-hidden ${t.bg}`}>
      <CardContent className="p-4 flex flex-col justify-between">
        <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">{label}</div>
        <div className={`text-2xl sm:text-3xl font-black mt-2 font-sans ${t.text}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
