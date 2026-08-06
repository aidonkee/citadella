import { useState, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { BrainCircuit, Loader2, MessageSquare, Send, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { askNervaDirect } from "@/lib/orders.functions";
import { transcribeAudio } from "@/lib/stt.functions";
import { GeminiVoiceOrb } from "@/components/GeminiVoiceOrb";
import { blobToBase64 } from "@/components/voice-mic-button";

export function NervaAiWidget() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: "user" | "ai"; content: string; updatedOrder?: string }>>([
    {
      role: "ai",
      content: "[NERVA // SYS]: Приветствую! Я автономный ИИ-агент Nerva.\n\nГоворите или пишите любые вопросы по предприятию, создавайте заказы, обновляйте статусы в свободной форме.",
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
          content: res?.reply || "[NERVA]: Запрос выполнен. Состояние системы обновлено.",
          updatedOrder: res?.updatedOrder,
        },
      ]);
      if (res?.updatedOrder) {
        toast.success(`[NERVA]: Обновлен заказ №${res.updatedOrder} на дашборде`);
        router.invalidate();
      }
    } catch (err: any) {
      toast.error("Ошибка связи с Nerva: " + (err?.message || "Сбой"));
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          content: "[NERVA // ERROR]: Ошибка связи с сервером. Введите команду повторно.",
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
            setQuery((prev) => prev ? prev + " " + resultText.trim() : resultText.trim());
          } else {
            toast.error("Речь не распознана.");
          }
        } catch (e: any) {
          toast.error("Ошибка расшифровки аудио. Серверу нужен API ключ.");
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

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 font-sans select-none">
      {open && (
        <div className="w-80 sm:w-[26rem] rounded-2xl border border-border/60 bg-card/95 shadow-2xl p-4 flex flex-col gap-3 backdrop-blur-xl max-h-[600px]">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <BrainCircuit className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="font-semibold text-sm text-foreground">ИИ Ассистент</div>
                <div className="text-[11px] text-muted-foreground font-medium">Nerva AI</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary"
                onClick={() => {
                  setOpen(false);
                  router.navigate({ to: "/dm" });
                }}
                title="Развернуть"
              >
                <MessageSquare className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary"
                onClick={() => setOpen(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* 3D Сфера (Глобус) */}
          <div className="flex flex-col items-center justify-center py-2">
            <GeminiVoiceOrb
              isRecording={isRecording}
              isProcessing={loading}
              onPressStart={handlePressStart}
              onPressEnd={handlePressEnd}
              disabled={loading}
            />
          </div>

          {/* Messages body */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-2 py-1 soft-scrollbar min-h-[160px] max-h-[260px] text-sm">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`rounded-2xl px-4 py-2.5 max-w-[90%] shadow-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-secondary/50 border border-border/50 text-foreground rounded-bl-sm"
                  }`}
                >
                  {m.content.replace("[NERVA // SYS]: ", "").replace("[NERVA]: ", "").replace("[NERVA // ERROR]: ", "")}
                </div>
                {m.updatedOrder && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Заказ №{m.updatedOrder} обновлён
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-primary animate-pulse pl-2 py-1">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Обработка...</span>
              </div>
            )}
          </div>

          {/* Input Bar */}
          <div className="flex items-center gap-2 pt-3 border-t border-border/40">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder="Спросите или поручите..."
              disabled={loading}
              className="h-10 text-sm bg-secondary/30 border-border focus-visible:ring-primary rounded-xl"
            />
            <Button
              size="icon"
              className="w-10 h-10 rounded-xl shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-all"
              onClick={() => handleSend()}
              disabled={loading || !query.trim()}
            >
              <Send className="w-4 h-4 ml-0.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Floating Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="group relative flex items-center gap-3 rounded-full border border-primary/20 bg-card hover:bg-card/90 px-4 py-3 text-foreground shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-primary/10"
      >
        <span className="absolute -top-0.5 -right-0.5 flex w-3 h-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex rounded-full w-3 h-3 bg-primary" />
        </span>
        <div className="flex w-7 h-7 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-hover:rotate-12">
          <BrainCircuit className="w-4 h-4" />
        </div>
        <span className="font-semibold text-sm tracking-tight pr-1">ИИ Ассистент</span>
      </button>
    </div>
  );
}
