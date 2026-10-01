import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrainCircuit, LogOut, Lock, UserRound, Send, Loader2, Radio } from "lucide-react";
import { toast } from "sonner";
import { askNervaDirect } from "@/lib/orders.functions";
import { transcribeAudio } from "@/lib/stt.functions";
import { blobToBase64 } from "@/components/voice-mic-button";
import { GeminiVoiceOrb } from "@/components/GeminiVoiceOrb";

const LOGIN_DOMAIN = "nerva.ai";

export const Route = createFileRoute("/mobile-voice")({
  head: () => ({ meta: [{ title: "Nerva — Голосовой ассистент" }] }),
  component: MobileVoiceAgent,
});

type ChatMessage = {
  id: string;
  is_ai: boolean;
  content: string;
  created_at: string;
};

export function MobileVoiceAgent() {
  const [user, setUser] = useState<any>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  // Форма входа
  const [loginInput, setLoginInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  // Голосовой ввод и состояние ИИ
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [volume, setVolume] = useState<number>(0);

  // Лента чата (единая с основным сайтом)
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data?.user || null);
      setLoadingSession(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      setLoadingSession(false);
    });

    return () => {
      sub?.subscription.unsubscribe();
    };
  }, []);

  // Загрузка личного DM-чата с Nerva AI при авторизации и подписка на Realtime
  useEffect(() => {
    if (!user) return;

    const loadOrInitChat = async () => {
      let { data: dm } = await supabase
        .from("chats")
        .select("id")
        .eq("is_dm", true)
        .eq("dm_user_id", user.id)
        .maybeSingle();

      if (!dm) {
        const { data: newDm } = await supabase
          .from("chats")
          .insert({
            name: `Nerva AI (${user.email?.split("@")[0] || "Пользователь"})`,
            is_dm: true,
            dm_user_id: user.id,
          })
          .select()
          .single();
        if (newDm) dm = newDm;
      }

      if (dm) {
        setChatId(dm.id);
        const { data: msgs } = await supabase
          .from("messages")
          .select("id, is_ai, content, created_at")
          .eq("chat_id", dm.id)
          .order("created_at", { ascending: true })
          .limit(50);

        setMessages((msgs ?? []) as ChatMessage[]);
      }
    };

    loadOrInitChat();
  }, [user]);

  // Realtime подписка на новые сообщения в чате
  useEffect(() => {
    if (!chatId) return;

    const channel = supabase
      .channel(`mobile-dm-${chatId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    const trimmed = loginInput.trim().toLowerCase();
    const email = trimmed.includes("@") ? trimmed : `${trimmed}@${LOGIN_DOMAIN}`;

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: passwordInput,
      });
      if (error || !data.session) {
        toast.error("Неверный логин или пароль");
      } else {
        toast.success("Вход выполнен");
        setUser(data.user);
      }
    } catch {
      toast.error("Ошибка соединения");
    } finally {
      setLoggingIn(false);
    }
  };

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const handlePressStart = async () => {
    if (isRecording || isProcessing) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size < 800) {
          toast.error("Запись слишком короткая");
          setIsRecording(false);
          setTranscript("");
          return;
        }

        setIsRecording(false);
        setIsProcessing(true);
        setTranscript("Распознавание речи...");

        try {
          const b64 = await blobToBase64(blob);
          const { text: resultText } = await transcribeAudio({ data: { audio_base64: b64, mime: blob.type } as any });
          if (resultText && resultText.trim()) {
            setTranscript(resultText.trim());
            await processCommand(resultText.trim());
          } else {
            toast.error("Речь не распознана. Попробуйте еще раз.");
            setTranscript("");
            setIsProcessing(false);
          }
        } catch (e: any) {
          toast.error("Сбой расшифровки аудио. Введите текст вручную.");
          setTranscript("");
          setIsProcessing(false);
        }
      };

      mediaRef.current = mr;
      mr.start();
      setIsRecording(true);
      setTranscript("Слушаю ваш голос...");
    } catch (e) {
      toast.error("Микрофон недоступен. Проверьте разрешения устройства.");
      setIsRecording(false);
    }
  };

  const handlePressEnd = () => {
    if (mediaRef.current && mediaRef.current.state === "recording") {
      mediaRef.current.stop();
    }
  };

  const processCommand = async (commandText: string) => {
    if (!user) {
      toast.error("Требуется авторизация");
      return;
    }
    if (!commandText.trim()) return;

    setIsProcessing(true);
    setTranscript(commandText);

    const tempUserId = "temp-" + Date.now();
    setMessages((prev) => [
      ...prev,
      { id: tempUserId, is_ai: false, content: commandText, created_at: new Date().toISOString() },
    ]);

    try {
      const res = await askNervaDirect({
        data: {
          content: commandText,
          chat_id: chatId,
        },
      });

      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== tempUserId);
        return [
          ...filtered,
          { id: "ai-" + Date.now(), is_ai: false, content: commandText, created_at: new Date().toISOString() },
          { id: "res-" + Date.now(), is_ai: true, content: res.reply, created_at: new Date().toISOString() },
        ];
      });

      setTranscript("");
    } catch (err: any) {
      const errText = `Ошибка связи с сервером: ${err.message || "сбой"}`;
      toast.error(errText);
      setMessages((prev) => [
        ...prev,
        { id: "err-" + Date.now(), is_ai: true, content: errText, created_at: new Date().toISOString() },
      ]);
    } finally {
      setIsProcessing(false);
      setManualInput("");
    }
  };

  if (loadingSession) {
    return (
      <div className="min-h-[100dvh] w-full bg-background flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  // ЭКРАН ВХОДА
  if (!user) {
    return (
      <div className="min-h-[100dvh] w-full bg-background flex flex-col justify-center items-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-1.5">
            <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <BrainCircuit className="size-6" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Nerva — голосовой ассистент</h1>
            <p className="text-sm text-muted-foreground">Войдите, чтобы продолжить</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4 bg-card border border-border rounded-2xl p-5 shadow-sm">
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Логин или Email</label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9 h-11"
                  placeholder="admin"
                  required
                  value={loginInput}
                  onChange={(e) => setLoginInput(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Пароль</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9 h-11"
                  type="password"
                  placeholder="••••••••"
                  required
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                />
              </div>
            </div>

            <Button type="submit" disabled={loggingIn} className="w-full h-11">
              {loggingIn ? "Вход..." : "Войти"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // ОСНОВНОЙ ЭКРАН
  return (
    <div className="min-h-[100dvh] w-full bg-background text-foreground flex flex-col">
      {/* Верхняя панель */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2.5">
          <BrainCircuit className="size-5 text-primary" />
          <span className="font-semibold text-[15px] tracking-tight">Голосовой ассистент</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
          className="h-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        >
          <LogOut className="size-4" /> Выход
        </Button>
      </div>

      {/* Центральная зона: микрофон */}
      <div className="flex flex-col items-center justify-center py-10 px-4">
        {isRecording && (
          <div className="text-base font-medium text-foreground mb-6">
            Слушаю...
          </div>
        )}
        {isProcessing && (
          <div className="text-base font-medium text-muted-foreground mb-6">
            Обработка...
          </div>
        )}

        <GeminiVoiceOrb
          size="lg"
          isRecording={isRecording}
          isProcessing={isProcessing}
          onPressStart={handlePressStart}
          onPressEnd={handlePressEnd}
          onVolumeChange={(v) => setVolume(v)}
          disabled={isProcessing}
        />

        <div className="mt-4 text-sm text-muted-foreground">
          {isRecording ? "Отпустите, чтобы отправить" : isProcessing ? "" : "Зажмите кнопку, чтобы говорить"}
        </div>

        {transcript && isRecording && (
          <div className="px-4 py-2.5 mt-6 bg-card border border-border text-foreground text-sm rounded-xl max-w-sm w-full text-center">
            {transcript}
          </div>
        )}
      </div>

      {/* Лента сообщений */}
      <div className="flex-1 flex flex-col w-full max-w-md mx-auto px-4 pb-4">
        <div className="flex flex-col bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex-1 min-h-[40dvh]">
        <div className="bg-muted/60 px-4 py-2.5 border-b border-border flex items-center justify-between text-[13px] font-medium text-muted-foreground">
          <span className="flex items-center gap-2">
            <Radio className="size-4 text-emerald-600" /> Переписка с ассистентом
          </span>
        </div>

        <div className="flex-1 p-3 space-y-3 overflow-y-auto soft-scrollbar max-h-[40dvh]">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-8 text-sm leading-relaxed">
              История пуста. Говорите или пишите любые вопросы и поручения агенту в свободной форме.
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`flex flex-col ${m.is_ai ? "items-start" : "items-end"}`}>
              <div className={`max-w-[88%] p-3 rounded-xl border ${
                m.is_ai
                  ? "bg-card border-border text-foreground"
                  : "bg-primary border-primary text-primary-foreground"
              }`}>
                <div className={`text-[10px] font-semibold uppercase tracking-wide mb-1 ${m.is_ai ? "text-primary" : "text-primary-foreground/80"}`}>
                  {m.is_ai ? "Nerva AI" : "Вы"}
                  <span className="opacity-60 font-normal ml-1.5">{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div className="whitespace-pre-wrap leading-relaxed text-sm">{m.content}</div>
              </div>
            </div>
          ))}

          {isProcessing && (
            <div className="flex items-center gap-2 p-3 bg-muted/60 border border-border rounded-xl text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span>Nerva анализирует запрос...</span>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* Форма ввода */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            processCommand(manualInput);
          }}
          className="p-2.5 bg-card border-t border-border flex items-center gap-2"
        >
          <Input
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="Вопрос, заказ, опрос..."
            disabled={isProcessing}
            className="h-11 text-sm bg-background border-border flex-1"
          />
          <Button
            type="submit"
            disabled={!manualInput.trim() || isProcessing}
            size="icon"
            className="h-11 w-11 shrink-0"
            aria-label="Отправить"
          >
            <Send className="size-4" />
          </Button>
        </form>
      </div>
    </div>
    </div>
  );
}
