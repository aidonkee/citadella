import { useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { transcribeAudio } from "@/lib/stt.functions";

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => {
      const s = r.result as string;
      const idx = s.indexOf(",");
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

interface VoiceMicButtonProps {
  onText: (text: string) => void;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  title?: string;
}

export function VoiceMicButton({
  onText,
  className = "",
  disabled = false,
  size = "md",
  title = "Нажмите для голосового ввода",
}: VoiceMicButtonProps) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);

  const startRecording = async () => {
    if (disabled || busy || recording) return;

    // 1. Web Speech API (Chrome / Edge)
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        const rec = new SpeechRecognition();
        rec.lang = "ru-RU";
        rec.continuous = false;
        rec.interimResults = false;

        rec.onstart = () => {
          setRecording(true);
          toast.info("Слушаю вас... Нажмите ещё раз для отправки.");
        };

        rec.onresult = (e: any) => {
          let text = "";
          for (let i = e.resultIndex; i < e.results.length; ++i) {
            text += e.results[i][0].transcript;
          }
          if (text.trim()) {
            onText(text.trim());
            toast.success("Речь распознана!");
          }
        };

        rec.onerror = (e: any) => {
          console.warn("Web Speech API error:", e.error);
          setRecording(false);
          if (e.error !== "no-speech" && e.error !== "aborted") {
            startMediaRecorderFallback();
          }
        };

        rec.onend = () => {
          setRecording(false);
        };

        recognitionRef.current = rec;
        rec.start();
        return;
      } catch (err) {
        console.warn("Web Speech API init failed, using MediaRecorder", err);
      }
    }

    // 2. MediaRecorder + Gemini STT Fallback
    await startMediaRecorderFallback();
  };

  const startMediaRecorderFallback = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mime = "";
      if (MediaRecorder.isTypeSupported("audio/webm")) mime = "audio/webm";
      else if (MediaRecorder.isTypeSupported("audio/mp4")) mime = "audio/mp4";
      else if (MediaRecorder.isTypeSupported("audio/ogg")) mime = "audio/ogg";

      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blobType = mr.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: blobType });
        
        if (blob.size < 500) {
          toast.error("Слишком короткая запись голоса");
          setRecording(false);
          return;
        }

        setBusy(true);
        setRecording(false);
        try {
          const b64 = await blobToBase64(blob);
          const { text } = await transcribeAudio({ data: { audio_base64: b64, mime: blobType } as any });
          if (text && text.trim()) {
            onText(text.trim());
            toast.success("Голос успешно распознан!");
          } else {
            toast.error("Речь не распознана. Попробуйте сказать громче.");
          }
        } catch (e: any) {
          console.error("STT Error:", e);
          toast.error("Ошибка сервера при распознавании речи.");
        } finally {
          setBusy(false);
        }
      };

      mediaRef.current = mr;
      mr.start();
      setRecording(true);
      toast.info("Запись голоса... Нажмите кнопку ещё раз, чтобы закончить.");
    } catch (e: any) {
      console.error("getUserMedia error:", e);
      toast.error("Микрофон недоступен. Разрешите доступ к микрофону в браузере.");
      setRecording(false);
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      try {
        mediaRef.current.stop();
      } catch {}
    }
    setRecording(false);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (disabled || busy) return;

    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const sizeClasses = {
    sm: "size-8 text-xs",
    md: "size-10 text-sm",
    lg: "size-12 text-base",
  }[size];

  const iconSizes = {
    sm: "size-4",
    md: "size-5",
    lg: "size-6",
  }[size];

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || busy}
      title={busy ? "Распознавание..." : recording ? "Нажмите для отправки" : title}
      className={`relative rounded-full flex items-center justify-center transition-all shrink-0 active:scale-95 ${sizeClasses} ${
        recording
          ? "bg-red-600 shadow-[0_0_20px_rgba(220,38,38,0.5)] text-white scale-105 border-4 border-red-200"
          : busy
          ? "bg-slate-100 text-slate-400 opacity-80"
          : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 hover:shadow-sm"
      } ${className}`}
    >
      {busy ? (
        <Loader2 className={`${iconSizes} animate-spin`} />
      ) : recording ? (
        <Square className={`${iconSizes} text-white fill-current animate-pulse`} />
      ) : (
        <Mic className={`${iconSizes}`} />
      )}
      {recording && (
        <span className="absolute -top-1 -right-1 flex size-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex rounded-full size-3 bg-red-500" />
        </span>
      )}
    </button>
  );
}
