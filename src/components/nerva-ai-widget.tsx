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
    <div className="hidden md:flex fixed bottom-6 right-6 z-50 flex-col items-end gap-3 font-sans select-none">
      {open && (
        <div className="w-96 rounded-2xl border border-border bg-card shadow-2xl p-4 flex flex-col gap-3 max-h-[620px] transition-all animate-in fade-in zoom-in-95 duration-200">
          {/* Executive Header */}
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">Nerva Assistant</span>
                  <span className="size-1.5 rounded-full bg-emerald-500" title="В сети" />
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
                className={`flex size-9 items-center justify-center rounded-lg transition-all ${
                  isRecording
                    ? "bg-destructive text-white"
                    : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
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
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary/60 border border-border text-foreground"
                  }`}
                >
                  {cleanContent(m.content)}
                </div>
                {m.updatedOrder && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Заказ №{m.updatedOrder} обновлён
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse pl-2 py-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
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
              className="h-9 text-xs bg-secondary/30 border-border rounded-lg"
            />
            <Button
              size="icon"
              className="w-9 h-9 rounded-lg shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs transition-all"
              onClick={() => handleSend()}
              disabled={loading || !query.trim()}
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Desktop trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 rounded-full bg-primary text-primary-foreground px-4 py-2.5 shadow-lg hover:bg-primary/95 transition-all"
      >
        <Sparkles className="w-4 h-4" />
        <span className="font-medium text-xs tracking-tight">Nerva Assistant</span>
      </button>
    </div>
  );
}

