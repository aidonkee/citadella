import { useState, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { MessageSquare, Send, X, CheckCircle2, Mic, Square, Sparkles, Command, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { askNervaDirect } from "@/lib/orders.functions";
import { transcribeAudio } from "@/lib/stt.functions";
import { blobToBase64 } from "@/components/voice-mic-button";

export function NervaAiWidget() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: "user" | "ai"; content: string; updatedOrder?: string }>>([
    {
      role: "ai",
      content: "Здравствуйте! Я ассистент Nerva.\n\nЗадавайте вопросы по заказам, управлению предприятием или отдавайте команды голосом.",
    },
  ]);
  const router = useRouter();

  const handleSend = async (textToSend?: string) => {
    const text = textToSend ?? query;
    if (!text || !text.trim() || loading) return;

    const userMsg = text.trim();
    setQuery("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      const res = await askNervaDirect({ data: { content: userMsg } });
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          content: res?.reply || "Запрос выполнен. Данные обновлены.",
          updatedOrder: res?.updatedOrder,
        },
      ]);
      if (res?.updatedOrder) {
        toast.success(`Обновлен заказ №${res.updatedOrder}`);
        router.invalidate();
      }
    } catch (err: any) {
      toast.error("Ошибка связи с Nerva: " + (err?.message || "Сбой"));
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          content: "Не удалось связаться с сервером. Попробуйте ещё раз.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const handlePressStart = async () => {
    if (loading || isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size < 1000) {
          toast.error("Слишком короткая запись");
          return;
        }
        setLoading(true);
        try {
          const b64 = await blobToBase64(blob);
          const { text: resultText } = await transcribeAudio({ data: { audio_base64: b64, mime: blob.type } as any });
          if (resultText && resultText.trim()) {
            await handleSend(resultText.trim());
          } else {
            toast.error("Речь не распознана.");
          }
        } catch (e: any) {
          toast.error("Сбой расшифровки аудио.");
        } finally {
          setLoading(false);
        }
      };
      
      mediaRef.current = mr;
      mr.start();
      setIsRecording(true);
    } catch (e) {
      toast.error("Микрофон недоступен. Проверьте разрешения устройства.");
      setIsRecording(false);
    }
  };

  const handlePressEnd = () => {
    setIsRecording(false);
    if (mediaRef.current && mediaRef.current.state === "recording") {
      mediaRef.current.stop();
    }
  };

  const cleanContent = (str: string) => {
    return str
      .replace(/^\[NERVA \/\/ SYS\]:\s*/i, "")
      .replace(/^\[NERVA\]:\s*/i, "")
      .replace(/^\[NERVA \/\/ ERROR\]:\s*/i, "");
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 font-sans select-none">
      {open && (
        <div className="w-80 sm:w-[26rem] rounded-2xl border border-border bg-card shadow-2xl p-4 flex flex-col gap-3 backdrop-blur-2xl max-h-[620px] transition-all animate-in fade-in zoom-in-95 duration-200">
          {/* Executive Header */}
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-slate-900 text-white dark:bg-emerald-500/15 dark:text-emerald-400 flex items-center justify-center border border-border">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">Nerva Assistant</span>
                  <span className="size-2 rounded-full bg-emerald-500" title="В сети" />
                </div>
                <div className="text-[11px] text-muted-foreground">Интеллектуальный помощник</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary"
                onClick={() => {
                  setOpen(false);
                  router.navigate({ to: "/dm" });
                }}
                title="Развернуть полный чат"
              >
                <MessageSquare className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary"
                onClick={() => setOpen(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Voice Command Bar */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/40 border border-border/80">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onMouseDown={handlePressStart}
                onMouseUp={handlePressEnd}
                onTouchStart={handlePressStart}
                onTouchEnd={handlePressEnd}
                disabled={loading}
                className={`flex size-9 items-center justify-center rounded-xl transition-all ${
                  isRecording
                    ? "bg-rose-500 text-white animate-pulse shadow-md scale-105"
                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20"
                }`}
              >
                {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground truncate">
                  {isRecording ? "Идёт запись голоса..." : "Голосовой ввод"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {isRecording ? "Отпустите для отправки" : "Удерживайте микрофон для записи"}
                </p>
              </div>
            </div>
            {isRecording && (
              <div className="flex items-center gap-1">
                <span className="w-1 h-4 bg-rose-500 rounded-full animate-bounce" />
                <span className="w-1 h-6 bg-rose-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                <span className="w-1 h-3 bg-rose-500 rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            )}
          </div>

          {/* Messages Timeline */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 py-1 soft-scrollbar min-h-[160px] max-h-[260px] text-xs">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`rounded-xl px-3.5 py-2.5 max-w-[92%] leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-slate-900 text-white dark:bg-emerald-500/20 dark:text-emerald-100 dark:border dark:border-emerald-500/30 rounded-br-xs"
                      : "bg-secondary/60 border border-border text-foreground rounded-bl-xs"
                  }`}
                >
                  {cleanContent(m.content)}
                </div>
                {m.updatedOrder && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Заказ №{m.updatedOrder} обновлён
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse pl-2 py-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
                <span>Nerva обрабатывает запрос...</span>
              </div>
            )}
          </div>

          {/* Text Input Bar */}
          <div className="flex items-center gap-2 pt-2 border-t border-border/60">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder="Спросить или дать поручение..."
              disabled={loading}
              className="h-9 text-xs bg-secondary/30 border-border focus-visible:ring-emerald-500 rounded-lg"
            />
            <Button
              size="icon"
              className="w-9 h-9 rounded-lg shrink-0 bg-slate-900 hover:bg-slate-800 text-white dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-slate-950 shadow-xs transition-all"
              onClick={() => handleSend()}
              disabled={loading || !query.trim()}
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Floating Executive Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="group relative flex items-center gap-2.5 rounded-full border border-border bg-card hover:bg-card/90 px-4 py-2.5 text-foreground shadow-lg transition-all duration-200 hover:shadow-xl"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <Sparkles className="w-4 h-4 text-emerald-500 transition-transform group-hover:scale-110" />
        <span className="font-medium text-xs tracking-tight">Nerva Assistant</span>
        <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-mono">
          ⌘K
        </span>
      </button>
    </div>
  );
}

