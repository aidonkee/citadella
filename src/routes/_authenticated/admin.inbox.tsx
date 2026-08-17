import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { dispatchOrder } from "@/lib/orders.functions";
import { transcribeAudio } from "@/lib/stt.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { parseOrderMetadata } from "@/lib/order-metadata";
import { Mic, Send, Inbox, Loader2, Square } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/inbox")({
  head: () => ({ meta: [{ title: "Входящие заказы — OrderFlow" }] }),
  component: InboxPage,
});

type Order = { id: string; number: string; nomenclature: string; finish_date: string | null; customer_order: string | null; comment: string | null; created_at: string; created_by: string | null };
type Chat = { id: string; name: string };

function InboxPage() {
  const { isOwner, isManager, role, loading } = useAuth();
  const canAccess = isOwner || isManager || role === null;
  const [orders, setOrders] = useState<Order[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [selectedChats, setSelectedChats] = useState<Set<string>>(new Set());
  const [dispatching, setDispatching] = useState(false);
  const [creatorNames, setCreatorNames] = useState<Record<string, string>>({});

  const load = async () => {
    const { data: os } = await supabase.from("orders")
      .select("id, number, nomenclature, finish_date, customer_order, comment, created_at, created_by")
      .eq("is_dispatched", false).order("created_at", { ascending: false });
    setOrders((os ?? []) as Order[]);
    const ids = Array.from(new Set((os ?? []).map((o: any) => o.created_by).filter(Boolean)));
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("id, display_name").in("id", ids);
      const m: Record<string, string> = {};
      for (const p of ps ?? []) m[p.id] = p.display_name;
      setCreatorNames(m);
    }
    const { data: cs } = await supabase.from("chats").select("id, name").eq("is_dm", false).order("created_at");
    setChats(cs ?? []);
  };
  useEffect(() => { load(); }, []);

  // realtime for new pending orders
  useEffect(() => {
    const ch = supabase.channel("inbox-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const active = useMemo(() => orders.find((o) => o.id === selectedOrder) ?? null, [orders, selectedOrder]);

  const toggle = (id: string) => {
    const n = new Set(selectedChats);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelectedChats(n);
  };

  const send = async () => {
    if (!active || selectedChats.size === 0) return;
    setDispatching(true);
    try {
      await dispatchOrder({ data: { order_id: active.id, chat_ids: Array.from(selectedChats) } as any });
      toast.success(`Отправлено в ${selectedChats.size} чат(а)`);
      setSelectedOrder(null); setSelectedChats(new Set()); load();
    } catch (e: any) { toast.error(e.message); }
    finally { setDispatching(false); }
  };

  const onVoiceMatch = (text: string) => {
    if (!text) return;
    const t = text.toLowerCase();
    
    // Try matching spoken order number from queue
    const digitsMatch = t.match(/\b\d+\b/);
    let matchedOrder = orders.find(o => t.includes(o.number.toLowerCase()));
    if (!matchedOrder && digitsMatch) {
      matchedOrder = orders.find(o => o.number.includes(digitsMatch[0]));
    }
    
    if (matchedOrder) {
      setSelectedOrder(matchedOrder.id);
    }

    const matchedChats = new Set<string>();
    for (const c of chats) {
      const name = c.name.toLowerCase();
      const tokens = name.split(/[\s,._\-№#()]+/).filter((w) => w.length >= 2);
      if (tokens.some((w) => t.includes(w)) || t.includes(name)) matchedChats.add(c.id);
    }
    setSelectedChats(matchedChats);

    toast.success(`Распознано: "${text}"`, {
      description: `${matchedOrder ? `Заказ №${matchedOrder.number}. ` : ""}Выбрано чатов: ${matchedChats.size}`
    });
  };

  if (loading) return <div className="p-8 text-slate-500 animate-pulse">Загрузка входящих заказов…</div>;
  if (!canAccess) return <div className="p-8 text-slate-500">Доступ только для владельца и администрации.</div>;

  return (
    <div className="soft-scrollbar h-full overflow-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Inbox className="size-6" />Входящие заказы</h1>
        <p className="text-sm text-muted-foreground">Заказы от менеджеров, ожидающие распределения по чатам</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border border-slate-200 bg-white shadow-sm rounded-xl overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-5 py-3.5">
            <CardTitle className="text-base font-bold text-slate-900 tracking-tight">Очередь ({orders.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4">
            {orders.map((o) => (
              <button key={o.id} onClick={() => { setSelectedOrder(o.id); setSelectedChats(new Set()); }}
                className={`w-full text-left border rounded-xl px-4 py-3 transition ${selectedOrder === o.id ? "border-slate-900 bg-slate-900 text-white shadow-sm" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-sm font-bold tracking-tight">#{o.number}</div>
                  <div className={`text-xs ${selectedOrder === o.id ? "text-slate-300" : "text-slate-500"}`}>{new Date(o.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
                </div>
                <div className={`text-sm mt-1 line-clamp-2 font-medium ${selectedOrder === o.id ? "text-white" : "text-slate-800"}`}>{o.nomenclature}</div>
                <div className={`text-xs mt-1 font-medium ${selectedOrder === o.id ? "text-slate-300" : "text-slate-500"}`}>
                  от {o.created_by ? (creatorNames[o.created_by] ?? "…") : "—"}
                  {o.finish_date ? ` · срок ${o.finish_date}` : ""}
                </div>
              </button>
            ))}
            {orders.length === 0 && <div className="text-sm text-slate-500 text-center py-8">🎉 Все заказы распределены</div>}
          </CardContent>
        </Card>

        <Card className="border border-slate-200 bg-white shadow-sm rounded-xl overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-5 py-3.5">
            <CardTitle className="text-base font-bold text-slate-900 tracking-tight">Распределение по цехам</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            {!active && <div className="text-sm text-slate-500 text-center py-8">Выберите заказ слева</div>}
            {active && (
              <>
                <div className="border border-slate-200 rounded-xl p-3.5 bg-slate-50 text-slate-900 space-y-1">
                  <div className="font-mono text-base font-bold text-slate-900">#{active.number}</div>
                  <div className="text-sm font-medium text-slate-800">{active.nomenclature}</div>
                  {active.customer_order && <div className="text-xs text-slate-600">📑 {active.customer_order}</div>}
                  {parseOrderMetadata(active.comment).comment && <div className="text-xs text-slate-600">💬 {parseOrderMetadata(active.comment).comment}</div>}
                </div>

                <VoiceButton onText={onVoiceMatch} />

                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {chats.map((c) => (
                    <label key={c.id} className={`flex items-center gap-3 border rounded-xl px-3.5 py-2.5 cursor-pointer transition ${selectedChats.has(c.id) ? "border-emerald-600 bg-emerald-50 text-emerald-900 font-bold" : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"}`}>
                      <Checkbox checked={selectedChats.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                      <div className="text-sm font-medium">{c.name}</div>
                    </label>
                  ))}
                  {chats.length === 0 && <div className="text-sm text-slate-500 text-center py-4">Нет чатов. <Link to="/admin/users" className="text-blue-600 underline">Создать</Link></div>}
                </div>

                <Button onClick={send} disabled={dispatching || selectedChats.size === 0} className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg shadow-sm">
                  {dispatching ? <><Loader2 className="size-4 mr-2 animate-spin" />Отправка…</> : <><Send className="size-4 mr-2" />Отправить в {selectedChats.size} чат(а)</>}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function VoiceButton({ onText }: { onText: (text: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size < 1500) { toast.error("Слишком короткая запись"); return; }
        setBusy(true);
        try {
          const b64 = await blobToBase64(blob);
          const { text } = await transcribeAudio({ data: { audio_base64: b64, mime: blob.type } as any });
          onText(text);
        } catch (e: any) { toast.error("Ошибка распознавания: " + e.message); }
        finally { setBusy(false); }
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (e: any) {
      toast.error("Нет доступа к микрофону");
    }
  };
  const stop = () => { mediaRef.current?.stop(); setRecording(false); };

  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <button
        type="button"
        onMouseDown={start} onMouseUp={stop} onMouseLeave={() => recording && stop()}
        onTouchStart={(e) => { e.preventDefault(); start(); }} onTouchEnd={(e) => { e.preventDefault(); stop(); }}
        disabled={busy}
        className={`relative size-16 rounded-full border-2 transition-all flex items-center justify-center ${recording ? "border-red-500 bg-red-500/20 scale-110 animate-pulse" : "border-primary bg-primary/15 hover:bg-primary/25"} ${busy ? "opacity-60" : ""}`}
      >
        {busy ? <Loader2 className="size-7 animate-spin" /> : recording ? <Square className="size-6 text-red-500" /> : <Mic className="size-7 text-primary" />}
      </button>
      <div className="text-xs text-muted-foreground text-center">
        {busy ? "Распознаю…" : recording ? "Говорите… отпустите чтобы закончить" : "Зажмите и назовите чаты (напр. «цех один и цех два»)"}
      </div>
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => {
      const s = r.result as string;
      resolve(s.split(",")[1] ?? "");
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
