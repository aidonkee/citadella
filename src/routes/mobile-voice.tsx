import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrainCircuit, LogOut, Lock, UserRound, Send, Sparkles, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { askNervaDirect } from "@/lib/orders.functions";
import { NervaNeuralBg } from "@/components/NervaNeuralBg";
import { GeminiVoiceOrb } from "@/components/GeminiVoiceOrb";

const LOGIN_DOMAIN = "orderflow.local";

export const Route = createFileRoute("/mobile-voice")({
  head: () => ({ meta: [{ title: "Nerva APK Voice Agent — 3D Globe & Chat" }] }),
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

  // Форма входа в APK
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

  const handlePressStart = () => {
    if (isRecording || isProcessing) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Голосовой ввод недоступен в текущем WebView. Используйте текстовый ввод или голосовой набор клавиатуры.");
      return;
    }

    const rec = new SpeechRecognition();
    rec.lang = "ru-RU";
    rec.continuous = false;
    rec.interimResults = true;
    transcriptRef.current = "";

    rec.onstart = () => {
      setIsRecording(true);
      setTranscript("Слушаю ваш голос...");
    };

    rec.onresult = (event: any) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        text += event.results[i][0].transcript;
      }
      transcriptRef.current = text;
      setTranscript(text);
    };

    rec.onerror = (e: any) => {
      setIsRecording(false);
      if (e.error !== "no-speech") {
        console.warn("SpeechRecognition error:", e.error);
        toast.error(`Ошибка микрофона (${e.error}). Пожалуйста, введите запрос в поле ниже.`);
      }
    };

    rec.onend = async () => {
      setIsRecording(false);
      const finalCommand = transcriptRef.current?.trim();
      if (!finalCommand) {
        setTranscript("");
        return;
      }
      await processCommand(finalCommand);
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      // Игнорируем ошибки двойного запуска
    }
  };

  const handlePressEnd = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Игнорируем
      }
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
      const errText = `[NERVA // ERROR]: ${err.message || "Сбой связи с сервером Nerva AI"}`;
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
      <div className="min-h-[100dvh] w-full bg-background flex items-center justify-center font-mono text-primary font-bold">
        ИНИЦИАЛИЗАЦИЯ NERVA APK...
      </div>
    );
  }

  // ЭКРАН ВХОДА ДЛЯ APK (если не авторизован)
  if (!user) {
    return (
      <div className="relative min-h-[100dvh] w-full bg-background text-foreground font-mono select-none overflow-hidden flex flex-col justify-center items-center p-6">
        <NervaNeuralBg />
        
        <div className="relative z-10 w-full max-w-sm bg-card/90 p-6 backdrop-blur-md shadow-2xl rounded-none border border-primary/40">
          <div className="flex items-center gap-2 pb-4 border-b border-primary/30 mb-5 text-primary font-black uppercase tracking-widest text-sm">
            <span className="flex size-7 items-center justify-center bg-primary text-primary-foreground font-mono rounded-none">
              <BrainCircuit className="size-4 animate-pulse" />
            </span>
            NERVA // ВХОД В APK
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1 text-left">
              <label className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                Логин или Email
              </label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9 rounded-none border-primary/30 font-mono text-xs focus:border-primary"
                  placeholder="admin"
                  required
                  value={loginInput}
                  onChange={(e) => setLoginInput(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1 text-left">
              <label className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                Пароль
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9 rounded-none border-primary/30 font-mono text-xs focus:border-primary"
                  type="password"
                  placeholder="••••••••"
                  required
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loggingIn}
              className="w-full rounded-none font-mono font-black uppercase tracking-widest text-xs h-10 bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg"
            >
              {loggingIn ? "АВТОРИЗАЦИЯ..." : "ВОЙТИ В СИСТЕМУ"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // ОСНОВНОЙ ЭКРАН APK С 3D ГЛОБУСОМ
  return (
    <div className="relative min-h-[100dvh] w-full bg-background text-foreground font-sans select-none overflow-hidden flex flex-col p-4 sm:p-6">
      <NervaNeuralBg />

      {/* АНИМИРОВАННЫЙ ГРАДИЕНТНЫЙ ФОН ПРИ ГОВОРЕНИИ */}
      <div
        className={`absolute inset-0 pointer-events-none transition-all duration-300 z-0 bg-gradient-to-tr from-cyan-500 via-indigo-600 via-purple-600 to-pink-500 ${
          isRecording ? "opacity-75 scale-105 animate-pulse" : "opacity-0 scale-100"
        }`}
        style={{
          opacity: isRecording ? 0.45 + volume * 0.55 : 0,
        }}
      />

      {/* Верхняя панель */}
      <div className="relative z-10 flex items-center justify-between pb-4 bg-transparent">
        <div className="flex items-center gap-2 font-semibold text-lg text-primary">
          <BrainCircuit className="size-5 text-indigo-500" />
          Голосовой Ассистент
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
            className="rounded-full text-sm font-medium h-9 px-4 hover:bg-destructive hover:text-destructive-foreground transition-colors"
          >
            <LogOut className="size-4 mr-2" /> Выход
          </Button>
        </div>
      </div>

      {/* Центральная зона: 3D-сфера (Глобус) */}
      <div className="relative z-10 flex flex-col items-center justify-center w-full max-w-md mx-auto flex-1 text-center mt-8">
        {isRecording && (
          <div className="text-xl sm:text-2xl font-medium text-indigo-500 animate-pulse mb-6">
            Слушаю...
          </div>
        )}

        <GeminiVoiceOrb
          isRecording={isRecording}
          isProcessing={isProcessing}
          onPressStart={handlePressStart}
          onPressEnd={handlePressEnd}
          onVolumeChange={(v) => setVolume(v)}
          disabled={isProcessing}
        />

        {transcript && isRecording && (
          <div className="px-6 py-3 mt-8 bg-card/60 backdrop-blur-lg border border-border/50 text-foreground text-lg rounded-2xl font-medium shadow-sm animate-pulse max-w-sm w-full">
            {transcript}
          </div>
        )}
      </div>

      {/* Простой и чистый список сообщений снизу */}
      <div className="relative z-10 mt-6 flex flex-col w-full max-w-md mx-auto bg-card/50 backdrop-blur-xl border border-border/40 rounded-3xl shadow-lg overflow-hidden h-[45dvh]">
        <div className="bg-muted/30 px-5 py-3 border-b border-border/50 flex items-center justify-between text-sm font-semibold text-muted-foreground">
          <span className="flex items-center gap-2">
            <Radio className="size-4 text-green-500 animate-pulse" /> Активные задачи
          </span>
        </div>

        <div className="flex-1 p-3 space-y-3 overflow-y-auto soft-scrollbar max-h-[36vh] text-xs">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground/70 py-8 uppercase font-mono text-[11px]">
              История пуста. Говорите или пишите любые вопросы и поручения агенту в свободной форме.
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.is_ai ? "items-start" : "items-end"} space-y-1`}
            >
              <div
                className={`max-w-[88%] p-2.5 rounded-none border ${
                  m.is_ai
                    ? "bg-card border-primary/40 text-foreground shadow-md"
                    : "bg-primary/15 border-primary text-primary font-semibold shadow-sm"
                }`}
              >
                <div className="flex items-center justify-between gap-3 text-[9px] uppercase font-bold opacity-70 mb-1 border-b border-current/20 pb-0.5">
                  <span>{m.is_ai ? "🧠 NERVA AI" : "👤 ВЫ"}</span>
                  <span>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
              </div>
            </div>
          ))}

          {isProcessing && (
            <div className="flex items-center gap-2 p-2.5 bg-card border border-cyan-400/50 text-cyan-300 text-xs animate-pulse">
              <Sparkles className="size-4 animate-spin text-cyan-400" />
              <span>Nerva анализирует запрос и выполняет задачу...</span>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* Форма текстового или клавиатурно-голосового ввода */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            processCommand(manualInput);
          }}
          className="p-2 bg-background/90 border-t border-border flex items-center gap-2"
        >
          <Input
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="Свободный запрос (вопрос, заказ, опрос)..."
            disabled={isProcessing}
            className="rounded-none h-9 text-xs font-mono bg-card border-border focus:border-primary text-foreground placeholder:text-muted-foreground flex-1"
          />
          <Button
            type="submit"
            disabled={!manualInput.trim() || isProcessing}
            size="sm"
            className="rounded-none h-9 px-4 bg-primary hover:bg-primary/90 text-primary-foreground font-black uppercase text-xs"
          >
            <Send className="size-4 mr-1" /> ОтправитЬ
          </Button>
        </form>
      </div>

      {/* Подвал */}
      <div className="relative z-10 text-center text-[10px] text-muted-foreground/60 uppercase tracking-widest pb-1">
        СЕКТОР: {user.email} // ЕДИНЫЙ АВТОНОМНЫЙ АГЕНТ
      </div>
    </div>
  );
}
