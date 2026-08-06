import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendMessage, claimOrder, updateOrderStatus, confirmClaim, rejectClaim } from "@/lib/orders.functions";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { Bot, Send, CheckCircle2, X, Check, MessageSquare, BrainCircuit, Activity } from "lucide-react";
import { STATUS_COLOR, STATUS_LABEL, type OrderStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { VoiceMicButton } from "@/components/voice-mic-button";
import { parseOrderMetadata, buildOrderMetadata, type OrderPriority } from "@/lib/order-metadata";
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
  const { user, isOwner } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [chatNames, setChatNames] = useState<Record<string, string>>({});
  const [orders, setOrders] = useState<Record<string, { id: string; status: OrderStatus; number: string; responsible_user_id: string | null; comment: string | null; chat_id: string | null; dispatched_chat_ids: string[] | null }>>({});
  const [claims, setClaims] = useState<Record<string, { user_id: string; status: string }>>({});
  const [chatName, setChatName] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      const { data: allChats } = await supabase.from("chats").select("id, name");
      if (allChats) setChatNames(Object.fromEntries(allChats.map(c => [c.id, c.name])));

      const { data: chat } = await supabase.from("chats").select("name").eq("id", chatId).single();
      setChatName(chat?.name ?? "");
      const { data } = await supabase.from("messages").select("*").eq("chat_id", chatId).order("created_at");
      setMessages((data ?? []) as Msg[]);
      const userIds = [...new Set((data ?? []).map((m) => m.sender_user_id).filter(Boolean))] as string[];
      if (userIds.length) {
        const { data: ps } = await supabase.from("profiles").select("id, display_name").in("id", userIds);
        setProfiles(Object.fromEntries((ps ?? []).map((p) => [p.id, p.display_name])));
      }
      const orderIds = [...new Set((data ?? []).map((m) => m.order_id).filter(Boolean))] as string[];
      if (orderIds.length) {
        const { data: os } = await supabase.from("orders").select("id, status, number, responsible_user_id, comment, chat_id, dispatched_chat_ids").in("id", orderIds);
        setOrders(Object.fromEntries((os ?? []).map((o) => [o.id, o])));
        const { data: cs } = await supabase.from("order_claims").select("order_id, user_id, status").in("order_id", orderIds).neq("status", "rejected");
        setClaims(Object.fromEntries((cs ?? []).map((c) => [c.order_id, { user_id: c.user_id, status: c.status }])));
      }
    };
    load();
    const ch = supabase.channel(`chat-${chatId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_claims" }, load)
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
    try { await claimOrder({ data: { order_id: orderId } as any }); toast.success("Отклик отправлен — подтвердите или откажитесь"); }
    catch (err: any) { toast.error(err.message); }
  };

  const onConfirm = async (orderId: string) => {
    try { await confirmClaim({ data: { order_id: orderId } as any }); toast.success("Заказ подтверждён"); }
    catch (err: any) { toast.error(err.message); }
  };

  const onReject = async (orderId: string) => {
    const reason = window.prompt("Причина отказа (необязательно):") ?? undefined;
    try { await rejectClaim({ data: { order_id: orderId, reason } as any }); toast.success("Отклик отозван"); }
    catch (err: any) { toast.error(err.message); }
  };

  const onToggleSector = async (orderId: string, isCompleted: boolean) => {
    try { 
      await toggleOrderSectorStatus({ data: { order_id: orderId, chat_id: chatId, is_completed: isCompleted } as any }); 
      toast.success(isCompleted ? "Сектор завершил работу" : "Сектор вернул заказ в работу");
    }
    catch (err: any) { toast.error(err.message); }
  };

  const onPriorityChange = async (orderId: string, priority: OrderPriority) => {
    try {
      const order = orders[orderId];
      if (!order) return;
      const meta = parseOrderMetadata(order.comment);
      const newComment = buildOrderMetadata({ ...meta, priority }, order.comment);
      await updateOrderDetails({ data: { order_id: orderId, comment: newComment } as any });
      toast.success("Приоритет обновлен");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const activeOrders = Object.values(orders).filter(o => o.status !== "completed");

  return (
    <div className="flex h-full min-w-0">
      <div className="hidden md:block"><ChatsSidebar activeId={chatId} /></div>
      <div className="flex-1 flex flex-col min-w-0">
        <div className="border-b border-border/40 bg-background/35 px-3 sm:px-5 py-2 sm:py-3 flex items-center gap-2 backdrop-blur-xl">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden"><MessageSquare className="size-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72"><ChatsSidebar activeId={chatId} /></SheetContent>
          </Sheet>
          <div className="font-semibold truncate">{chatName}</div>
        </div>

        {activeOrders.length > 0 && (
          <div className="bg-card border-b border-border/50 px-4 py-3 shadow-sm z-10">
            <div className="text-[10px] uppercase font-bold text-muted-foreground mb-2.5 tracking-wider flex items-center gap-1.5">
              <Activity className="size-3 text-primary" /> Закрепленные заказы ({activeOrders.length})
            </div>
            <div className="flex flex-wrap gap-2.5">
              {activeOrders.map(o => {
                const meta = parseOrderMetadata(o.comment);
                return (
                  <div key={o.id} className="flex items-center gap-2.5 bg-background border border-border/60 rounded-md px-2.5 py-1.5 shadow-sm text-xs transition-colors hover:border-primary/40">
                    <span className="font-mono font-bold text-foreground">{o.number}</span>
                    <Badge variant="outline" className={STATUS_COLOR[o.status] + " scale-90 -ml-1 border-transparent"}>{STATUS_LABEL[o.status]}</Badge>
                    
                    <Select value={meta.priority} onValueChange={(val) => onPriorityChange(o.id, val as OrderPriority)}>
                      <SelectTrigger className="h-6 w-24 text-[10px] bg-muted/50 border-border/50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Срочно">Срочно</SelectItem>
                        <SelectItem value="Высокий">Высокий</SelectItem>
                        <SelectItem value="Средний">Средний</SelectItem>
                        <SelectItem value="Обычный">Обычный</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div ref={scroller} className="soft-scrollbar flex-1 overflow-y-auto p-3 sm:p-5 space-y-3">
          {messages.map((m) => {
            const order = m.order_id ? orders[m.order_id] : null;
            const mine = m.sender_user_id === user?.id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-1 duration-200`}>
                <div className={`max-w-[88%] sm:max-w-[70%] rounded-2xl px-3.5 sm:px-4 py-2.5 sm:py-3 shadow-lg transition-all ${
                  m.is_ai ? "border border-primary/30 bg-gradient-to-r from-primary/15 via-background/60 to-accent/10 backdrop-blur-2xl text-foreground shadow-primary/10" :
                  mine ? "bg-primary text-primary-foreground font-medium rounded-br-sm shadow-primary/20" : "border border-border/40 bg-card/85 backdrop-blur-xl"
                }`}>
                  <div className={`flex items-center gap-1.5 text-[11px] font-bold tracking-wide mb-1 ${m.is_ai ? "text-primary" : mine ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                    {m.is_ai ? <><BrainCircuit className="size-3.5 animate-pulse" />Nerva AI</> : <span>{m.sender_user_id ? profiles[m.sender_user_id] ?? "…" : "—"}</span>}
                    <span className="opacity-60 font-normal">· {new Date(m.created_at).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className="prose prose-sm dark:prose-invert max-w-none text-xs sm:text-sm leading-relaxed whitespace-pre-wrap">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                  {m.kind === "order_card" && order && (() => {
                    const claim = claims[m.order_id!];
                    const myPending = claim?.status === "pending" && claim.user_id === user?.id;
                    const otherPending = claim?.status === "pending" && claim.user_id !== user?.id;
                    const meta = parseOrderMetadata(order.comment);
                    const sectors = meta.completed_sectors || {};
                    const thisSectorDone = sectors[chatId] === true;
                    const assignedChats = Array.from(new Set([...(order.dispatched_chat_ids || []), order.chat_id].filter((id): id is string => typeof id === "string" && id.length > 0)));
                    
                    return (
                      <div className="mt-3 flex flex-col gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={STATUS_COLOR[order.status]}>{STATUS_LABEL[order.status]}</Badge>
                          {claim?.status === "pending" && (
                            <Badge variant="outline" className="text-amber-400 border-amber-500/40">Ожидает подтверждения</Badge>
                          )}
                          {order.status === "new" && !claim && !isOwner && (
                            <Button size="sm" onClick={() => onClaim(m.order_id!)}>Откликнуться</Button>
                          )}
                          {myPending && (
                            <>
                              <Button size="sm" onClick={() => onConfirm(m.order_id!)}>
                                <Check className="size-4 mr-1" />Подтвердить
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => onReject(m.order_id!)}>
                                <X className="size-4 mr-1" />Отказаться
                              </Button>
                            </>
                          )}
                          {otherPending && !isOwner && (
                            <span className="text-xs text-muted-foreground">Откликнулся другой сотрудник</span>
                          )}
                          {order.responsible_user_id === user?.id && order.status !== "completed" && !thisSectorDone && (
                            <Button size="sm" variant="secondary" onClick={() => onToggleSector(m.order_id!, true)}>
                              <CheckCircle2 className="size-4 mr-1" />Сектор завершил работу
                            </Button>
                          )}
                          {order.responsible_user_id === user?.id && thisSectorDone && order.status !== "completed" && (
                            <Button size="sm" variant="outline" onClick={() => onToggleSector(m.order_id!, false)}>
                              <X className="size-4 mr-1" />Отменить завершение сектора
                            </Button>
                          )}
                        </div>
                        {assignedChats.length > 0 && (
                          <div className="w-full mt-1.5 flex flex-wrap gap-1.5 p-2 bg-muted/20 rounded-md border border-border/30">
                            <div className="w-full text-[10px] text-muted-foreground font-semibold mb-0.5">ПРОГРЕСС ПО СЕКТОРАМ:</div>
                            {assignedChats.map(cid => (
                              <Badge key={cid} variant={sectors[cid] ? "default" : "outline"} className={`text-[10px] ${sectors[cid] ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : "text-muted-foreground"}`}>
                                {chatNames[cid] || "Сектор"} {sectors[cid] ? "✅" : "⏳"}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
          {messages.length === 0 && <div className="text-center text-muted-foreground py-12">Сообщений пока нет</div>}
        </div>
        <form onSubmit={onSend} className="border-t border-primary/20 bg-background/60 p-3 sm:p-4 flex items-center gap-2.5 backdrop-blur-2xl">
          <VoiceMicButton size="md" onText={(t) => setText((prev) => (prev ? prev + " " + t : t))} disabled={sending} title="Нажмите для голосового ввода в чат" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Напишите сообщение или упомяните @Nerva..." autoFocus className="h-10 rounded-xl border-primary/30 bg-background/70" />
          <Button type="submit" disabled={sending || !text.trim()} className="h-10 px-4 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-md shadow-primary/20"><Send className="size-4" /></Button>
        </form>
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
    <aside className="glass-nav soft-scrollbar w-72 md:w-64 h-full border-r border-border/40 bg-sidebar/60 overflow-y-auto">
      <div className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Чаты</div>
      <div className="space-y-0.5 px-2">
        {chats.map((c) => (
          <Link key={c.id} to="/chats/$chatId" params={{ chatId: c.id }}
            className={`block px-3 py-2 rounded-xl text-sm truncate transition ${activeId === c.id ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"}`}>
            {c.name}
          </Link>
        ))}
        {chats.length === 0 && <div className="px-3 py-4 text-xs text-muted-foreground">Чатов пока нет</div>}
      </div>
    </aside>
  );
}
