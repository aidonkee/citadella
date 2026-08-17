import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendMessage } from "@/lib/orders.functions";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { BrainCircuit, Send } from "lucide-react";
import { VoiceMicButton, blobToBase64 } from "@/components/voice-mic-button";
import { transcribeAudio } from "@/lib/stt.functions";
import { GeminiVoiceOrb } from "@/components/GeminiVoiceOrb";

import { stripRawJsonMetadata } from "@/lib/order-metadata";

export const Route = createFileRoute("/_authenticated/dm")({
  head: () => ({ meta: [{ title: "Командный центр Nerva — Nerva" }] }),
  component: DM,
});

type Msg = { id: string; content: string; is_ai: boolean; sender_user_id: string | null; created_at: string };

const QUICK_CHIPS = [
  "📦 Какие заказы сейчас в работе?",
  "⏱ Когда срок сдачи ближайших заказов?",
  "📋 Как обновить статус заказа?",
  "🛠 Как оформить задержку или брак?",
];

function DM() {
  const { user } = useAuth();
  const [dmId, setDmId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [isRecordingOrb, setIsRecordingOrb] = useState(false);
  const [activeOrder, setActiveOrder] = useState<{ number: string; nomenclature: string; status: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    const init = async () => {
      const { data: dm } = await supabase.from("chats").select("id").eq("is_dm", true).eq("dm_user_id", user.id).maybeSingle();
      if (dm) setDmId(dm.id);

      // Загрузка текущей активной задачи
      const fetchActiveOrder = async () => {
        const { data: orders } = await supabase
          .from("orders")
          .select("number, nomenclature, status")
          .eq("responsible_user_id", user.id)
          .in("status", ["in_progress", "stalled", "new"])
          .order("created_at", { ascending: false })
          .limit(1);
        
        if (orders && orders.length > 0) {
          setActiveOrder(orders[0]);
        } else {
          setActiveOrder(null);
        }
      };
      fetchActiveOrder();

      // Подписка на обновления заказов пользователя
      const oChannel = supabase.channel(`active-order-${user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `responsible_user_id=eq.${user.id}` }, fetchActiveOrder)
        .subscribe();

      return () => { supabase.removeChannel(oChannel); };
    };
    init();
  }, [user]);

  useEffect(() => {
    if (!dmId) return;
    const load = async () => {
      const { data } = await supabase.from("messages").select("*").eq("chat_id", dmId).order("created_at");
      setMessages((data ?? []) as Msg[]);
    };
    load();
    const ch = supabase.channel(`dm-${dmId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${dmId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [dmId]);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const sendText = async (msgContent: string) => {
    if (!msgContent.trim() || !dmId || sending) return;
    setSending(true);
    try {
      await sendMessage({ data: { chat_id: dmId, content: msgContent.trim() } as any });
      setText("");
    } catch (err: any) {
      toast.error(err.message || "Ошибка отправки");
    } finally {
      setSending(false);
    }
  };

  const onSend = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendText(text);
  };

  const handleVoiceText = (transcribed: string) => {
    setText((prev) => prev ? prev + " " + transcribed : transcribed);
  };

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const handleOrbStart = async () => {
    if (sending || isRecordingOrb) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size < 1000) {
          toast.error("Слишком короткая запись голоса");
          return;
        }
        setSending(true);
        try {
          const b64 = await blobToBase64(blob);
          const { text: resultText } = await transcribeAudio({ data: { audio_base64: b64, mime: blob.type } as any });
          if (resultText && resultText.trim()) {
            setText((prev) => prev ? prev + " " + resultText.trim() : resultText.trim());
          } else {
            toast.error("Речь не распознана. Попробуйте еще раз.");
          }
        } catch (e: any) {
          toast.error("Ошибка расшифровки аудио. Серверу нужен API ключ.");
        } finally {
          setSending(false);
        }
      };
      
      mediaRef.current = mr;
      mr.start();
      setIsRecordingOrb(true);
    } catch (e) {
      toast.error("Микрофон недоступен. Проверьте разрешения устройства.");
      setIsRecordingOrb(false);
    }
  };

  const handleOrbEnd = () => {
    setIsRecordingOrb(false);
    if (mediaRef.current && mediaRef.current.state === "recording") {
      mediaRef.current.stop();
    }
  };

  return (
    <div className="flex h-full flex-col bg-transparent relative overflow-hidden font-sans">
      {/* Header */}
      <div className="border-b border-border/60 bg-background/80 px-4 py-3 flex items-center justify-between relative z-10">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-primary" />
            <span className="font-semibold text-lg tracking-tight text-foreground">ИИ Ассистент</span>
          </div>
          <div className="text-sm text-muted-foreground mt-0.5">Говорите или пишите запросы в свободной форме</div>
        </div>
      </div>

      {/* Active Task Banner */}
      {activeOrder && (
        <div className="bg-primary/10 border-b border-primary/20 px-4 py-2.5 flex items-center justify-between relative z-10 shadow-sm">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold text-primary tracking-wider">Текущая задача</span>
            <span className="text-sm font-semibold text-foreground">
              {activeOrder.nomenclature} <span className="text-muted-foreground">#{activeOrder.number}</span>
            </span>
          </div>
          <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-500/20">
            В работе
          </div>
        </div>
      )}

      {/* 3D Сфера */}
      <div className="flex flex-col items-center justify-center py-6 bg-card/40 border-b border-border/40 backdrop-blur-md">
        <GeminiVoiceOrb
          isRecording={isRecordingOrb}
          isProcessing={sending}
          onPressStart={handleOrbStart}
          onPressEnd={handleOrbEnd}
          disabled={sending}
        />
        <div className="text-sm font-medium text-muted-foreground mt-4 animate-pulse">
          {isRecordingOrb ? "Слушаю вас..." : sending ? "Обработка..." : "Зажмите сферу, чтобы говорить"}
        </div>
      </div>

      {/* Messages */}
      <div ref={scroller} className="soft-scrollbar flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 max-w-4xl w-full mx-auto relative z-10">
        {messages.map((m) => {
          const mine = !m.is_ai;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[88%] sm:max-w-[80%] rounded-2xl px-5 py-3.5 shadow-sm border ${
                m.is_ai
                  ? "border-border/60 bg-card/90 text-foreground rounded-tl-sm"
                  : "bg-primary border-primary text-primary-foreground font-medium rounded-tr-sm"
              }`}>
                <div className={`text-xs font-semibold tracking-wide mb-1 flex items-center gap-1.5 ${m.is_ai ? "text-primary" : "text-primary-foreground/80"}`}>
                  <span>{m.is_ai ? "Nerva AI" : "Вы"}</span>
                  <span className="opacity-60 font-normal text-[10px]">· {new Date(m.created_at).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap"><ReactMarkdown>{stripRawJsonMetadata(m.content)}</ReactMarkdown></div>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center max-w-md mx-auto space-y-3">
            <div className="text-muted-foreground text-sm leading-relaxed">
              Я ваш интеллектуальный помощник. Я понимаю речь и текст. Спросите меня о статусах заказов, попросите создать задачу или отметьте этап как выполненный.
            </div>
          </div>
        )}
      </div>

      {/* Form Bar */}
      <div className="border-t border-border/60 bg-background/90 p-3 sm:p-4 relative z-10">
        <div className="max-w-4xl mx-auto space-y-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 soft-scrollbar">
            {QUICK_CHIPS.map((chip, i) => (
              <button
                key={i}
                type="button"
                disabled={sending}
                onClick={() => sendText(chip)}
                className="shrink-0 text-xs px-3 py-1.5 rounded-full border border-border bg-card hover:bg-primary/10 text-foreground transition-colors"
              >
                {chip}
              </button>
            ))}
          </div>

          <form onSubmit={onSend} className="flex items-center gap-2.5">
            <VoiceMicButton
              size="lg"
              onText={handleVoiceText}
              disabled={sending}
              title="Нажмите для диктовки"
            />
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Введите сообщение..."
              disabled={sending}
              className="h-12 text-sm bg-card/60 border-border focus-visible:ring-primary rounded-xl"
            />
            <Button
              type="submit"
              disabled={sending || !text.trim()}
              className="h-12 w-12 p-0 rounded-xl shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-all"
            >
              <Send className="w-5 h-5 ml-1" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
