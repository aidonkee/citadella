import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendMessage, claimOrder, updateOrderStatus, confirmClaim, rejectClaim } from "@/lib/orders.functions";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { Bot, Send, CheckCircle2, X, Check, MessageSquare, BrainCircuit, Activity, Layers } from "lucide-react";
import { STATUS_COLOR, STATUS_LABEL, type OrderStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { VoiceMicButton } from "@/components/voice-mic-button";
import { parseOrderMetadata, buildOrderMetadata, stripRawJsonMetadata, type OrderPriority } from "@/lib/order-metadata";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateOrderDetails, toggleOrderSectorStatus } from "@/lib/orders.functions";

export const Route = createFileRoute("/_authenticated/chats/$chatId")({
  component: ChatPage,
});

type Msg = {
  id: string; chat_id: string; content: string; is_ai: boolean;
  sender_user_id: string | null; kind: string; order_id: string | null;
  created_at: string;
};

function ChatPage() {
  const { chatId } = useParams({ from: "/_authenticated/chats/$chatId" });
  const { user, isOwner, isManager } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [chatNames, setChatNames] = useState<Record<string, string>>({});
  const [orders, setOrders] = useState<Record<string, { id: string; status: OrderStatus; number: string; responsible_user_id: string | null; comment: string | null; chat_id: string | null; dispatched_chat_ids: string[] | null }>>({});
  const [claims, setClaims] = useState<Record<string, { user_id: string; status: string }>>({});
  const [chatName, setChatName] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  // load() extracted to component scope so event handlers can call it
  const load = async () => {
    const { data: allChats } = await supabase.from("chats").select("id, name");
    if (allChats) setChatNames(Object.fromEntries(allChats.map(c => [c.id, c.name])));

    const { data: chat } = await supabase.from("chats").select("name").eq("id", chatId).single();
    setChatName(chat?.name ?? "");
    const { data } = await supabase.from("messages").select("*").eq("chat_id", chatId).order("created_at");
    setMessages((data ?? []) as Msg[]);

    const messageUserIds = (data ?? []).map((m) => m.sender_user_id).filter(Boolean) as string[];
    const orderIds = [...new Set((data ?? []).map((m) => m.order_id).filter(Boolean))] as string[];

    let claimUserIds: string[] = [];
    if (orderIds.length) {
      const { data: os } = await supabase.from("orders").select("id, status, number, responsible_user_id, comment, chat_id, dispatched_chat_ids").in("id", orderIds);

      // Load assignments for THIS chat specifically
      const { data: assignments } = await supabase.from("order_assignments").select("order_id, status, responsible_user_id").in("order_id", orderIds).eq("chat_id", chatId);
      const assignMap = new Map((assignments ?? []).map(a => [a.order_id, a]));

      setOrders(Object.fromEntries((os ?? []).map((o) => {
        const assign = assignMap.get(o.id);
        return [o.id, {
          ...o,
          // Use per-chat assignment status, not global order status
          status: assign ? assign.status : o.status,
          responsible_user_id: assign?.responsible_user_id ?? null,
        }];
      })));

      const { data: cs } = await supabase.from("order_claims").select("order_id, user_id, status").in("order_id", orderIds).eq("chat_id", chatId).neq("status", "rejected");
      setClaims(Object.fromEntries((cs ?? []).map((c) => [c.order_id, { user_id: c.user_id, status: c.status }])));
      claimUserIds = (cs ?? []).map(c => c.user_id).filter(Boolean);
    }

    const assignUserIds = (orderIds.length ? (await supabase.from("order_assignments").select("responsible_user_id").in("order_id", orderIds)).data ?? [] : []).map(a => a.responsible_user_id).filter(Boolean) as string[];
    const allUserIds = [...new Set([...messageUserIds, ...claimUserIds, ...assignUserIds])];
    if (allUserIds.length) {
      const { data: ps } = await supabase.from("profiles").select("id, display_name").in("id", allUserIds);
      setProfiles(Object.fromEntries((ps ?? []).map((p) => [p.id, p.display_name])));
    }
  };

  useEffect(() => {
    load();
    const ch = supabase.channel(`chat-${chatId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_claims", filter: `chat_id=eq.${chatId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_assignments", filter: `chat_id=eq.${chatId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [chatId]);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [messages]);

  const onSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try { await sendMessage({ data: { chat_id: chatId, content: text.trim() } as any }); setText(""); }
    catch (err: any) { toast.error(err.message); }
    finally { setSending(false); }
  };

  const onClaim = async (orderId: string) => {
    try {
      // Optimistic UI — instantly show "В работе" before server responds
      setOrders((prev) => ({
        ...prev,
        [orderId]: {
          ...prev[orderId],
          status: "in_progress" as OrderStatus,
          responsible_user_id: user?.id ?? null,
        },
      }));
      await claimOrder({ data: { order_id: orderId, chat_id: chatId } as any });
      toast.success("Заказ взят в работу");
      await load();
    } catch (err: any) {
      toast.error(err.message);
      await load(); // revert optimistic update
    }
  };

  const onConfirm = async (orderId: string) => {
    try {
      await confirmClaim({ data: { order_id: orderId, chat_id: chatId } as any });
      toast.success("Заказ подтверждён и взят в работу");
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const onReject = async (orderId: string) => {
    const reason = window.prompt("Причина отказа (необязательно):") ?? undefined;
    try {
      await rejectClaim({ data: { order_id: orderId, chat_id: chatId, reason } as any });
      toast.success("Отклик отклонён");
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const onToggleSector = async (orderId: string, isCompleted: boolean) => {
    try {
      await toggleOrderSectorStatus({ data: { order_id: orderId, chat_id: chatId, is_completed: isCompleted } as any });
      toast.success(isCompleted ? "Сектор завершил работу" : "Сектор вернул заказ в работу");
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] min-w-0 overflow-hidden">
      <div className="hidden md:block"><ChatsSidebar activeId={chatId} /></div>
      <div className="flex-1 flex flex-col min-w-0 p-2 sm:p-4 bg-slate-100/40">
        <Card className="flex-1 flex flex-col overflow-hidden border-slate-200/80 shadow-md bg-white">
          <CardHeader className="py-3 sm:py-4 px-4 border-b border-slate-100 bg-slate-50/50 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="md:hidden"><MessageSquare className="size-5" /></Button>
                </SheetTrigger>
                <SheetContent side="left" className="p-0 w-72"><ChatsSidebar activeId={chatId} /></SheetContent>
              </Sheet>
              <CardTitle className="text-base sm:text-lg font-bold text-slate-800 tracking-tight">{chatName || "Чат"}</CardTitle>
            </div>
            <Link to="/dashboard" className="text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
              <Activity className="size-3.5" /> Дашборд
            </Link>
          </CardHeader>

        {Object.keys(orders).length > 0 && (
          <div className="px-4 py-2 bg-slate-100/70 border-b border-slate-200/60 flex flex-wrap gap-2 text-xs">
            <span className="font-semibold text-slate-500 flex items-center gap-1"><Layers className="size-3" /> Заказы в чате:</span>
            {Object.values(orders).map(o => {
              const meta = parseOrderMetadata(o.comment);
              return (
                <div key={o.id} className="flex items-center gap-1.5 bg-white px-2 py-1 rounded border border-slate-200 shadow-2xs">
                  <span className="font-bold text-slate-800">#{o.number}</span>
                  <Badge variant="outline" className={`text-[10px] px-1 py-0 ${STATUS_COLOR[o.status]}`}>{STATUS_LABEL[o.status]}</Badge>
                </div>
              );
            })}
          </div>
        )}

        <div ref={scroller} className="soft-scrollbar flex-1 overflow-y-auto p-3 sm:p-5 space-y-3">
          {messages.map((m) => {
            const order = m.order_id ? orders[m.order_id] : null;
            const mine = m.sender_user_id === user?.id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-1 duration-200`}>
                <div className={`max-w-[88%] sm:max-w-[70%] rounded-2xl px-3.5 sm:px-4 py-2.5 sm:py-3 shadow-sm transition-all ${
                  m.is_ai ? "border border-slate-200 bg-slate-50 text-slate-900 rounded-bl-sm" :
                  mine ? "bg-slate-900 text-white font-medium rounded-br-sm" : "border border-slate-200 bg-white text-slate-900 rounded-bl-sm"
                }`}>
                  <div className={`flex items-center gap-1.5 text-[11px] font-bold tracking-wide mb-1 ${m.is_ai ? "text-blue-600" : mine ? "text-slate-300" : "text-slate-500"}`}>
                    {m.is_ai ? <><BrainCircuit className="size-3.5" />Nerva AI</> : <span>{m.sender_user_id ? profiles[m.sender_user_id] ?? "…" : "—"}</span>}
                    <span className="opacity-60 font-normal">· {new Date(m.created_at).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className="prose prose-sm dark:prose-invert max-w-none text-xs sm:text-sm leading-relaxed whitespace-pre-wrap">
                    <ReactMarkdown>{stripRawJsonMetadata(m.content)}</ReactMarkdown>
                  </div>
                  {m.kind === "order_card" && order && (() => {
                    // Per-chat assignment status (not global order status)
                    const isAssignedInThisChat = Boolean(order.responsible_user_id);
                    const workerName = order.responsible_user_id ? (profiles[order.responsible_user_id] ?? "Сотрудник") : "";
                    const isCompleted = order.status === "completed";

                    return (
                      <div className="mt-3 flex flex-col gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Show per-chat assignment status */}
                          {isCompleted ? (
                            <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50 font-bold">
                              ✅ Завершено
                            </Badge>
                          ) : isAssignedInThisChat ? (
                            <>
                              <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 font-bold">
                                🔵 В работе: {workerName}
                              </Badge>
                              {order.responsible_user_id === user?.id && (
                                <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-300 hover:bg-emerald-50" onClick={() => onToggleSector(m.order_id!, true)}>
                                  <CheckCircle2 className="size-4 mr-1" />Завершить
                                </Button>
                              )}
                            </>
                          ) : (
                            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white font-bold" onClick={() => onClaim(m.order_id!)}>
                              <Check className="size-4 mr-1" />Взять в работу
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
          {messages.length === 0 && <div className="text-center text-muted-foreground py-12">Сообщений пока нет</div>}
        </div>
        <form onSubmit={onSend} className="border-t border-slate-200 bg-white p-3 sm:p-4 flex items-center gap-3">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Сообщение или команда..." autoFocus className="h-12 sm:h-14 text-base rounded-2xl border-slate-200 bg-slate-50 focus-visible:ring-1 focus-visible:ring-blue-500 shadow-inner" />

          {text.trim() ? (
            <Button type="submit" disabled={sending} className="h-12 sm:h-14 w-12 sm:w-14 shrink-0 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-md transition-all">
              <Send className="size-5 sm:size-6 ml-1" />
            </Button>
          ) : (
            <div className="shrink-0">
              <VoiceMicButton size="lg" className="h-12 w-12 sm:h-14 sm:w-14" onText={(t) => setText((prev) => (prev ? prev + " " + t : t))} disabled={sending} title="Удерживайте для голосового ввода" />
            </div>
          )}
        </form>
      </Card>
    </div>
  </div>
  );
}

export function ChatsSidebar({ activeId }: { activeId?: string }) {
  const [chats, setChats] = useState<{ id: string; name: string; is_dm: boolean }[]>([]);
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("chats").select("id, name, is_dm").eq("is_dm", false).order("created_at");
      setChats(data ?? []);
    };
    load();
    const ch = supabase.channel("chat-list").on("postgres_changes", { event: "*", schema: "public", table: "chats" }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);
  return (
    <aside className="w-72 md:w-64 h-full border-r border-slate-200 bg-slate-50 overflow-y-auto">
      <div className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Чаты</div>
      <div className="space-y-0.5 px-2">
        {chats.map((c) => (
          <Link key={c.id} to="/chats/$chatId" params={{ chatId: c.id }}
            className={`block px-3 py-2 rounded-xl text-sm truncate transition ${activeId === c.id ? "bg-blue-100 text-blue-900 font-medium" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
            {c.name}
          </Link>
        ))}
        {chats.length === 0 && <div className="px-3 py-4 text-xs text-muted-foreground">Чатов пока нет</div>}
      </div>
    </aside>
  );
}
