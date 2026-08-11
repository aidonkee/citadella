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
  title = "Нажмите или зажмите для голосового ввода",
}: VoiceMicButtonProps) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);

  const startRecording = async () => {
    if (disabled || busy || recording) return;

    // 1. ПРИОРИТЕТ: Использование встроенного Web Speech API (SpeechRecognition) для мгновенного распознавания речи в WebView / браузере
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        const rec = new SpeechRecognition();
        rec.lang = "ru-RU";
        rec.continuous = false;
        rec.interimResults = false;

        rec.onstart = () => {
          setRecording(true);
          toast.info("Слушаю вас...");
        };

        rec.onresult = (e: any) => {
          let text = "";
          for (let i = e.resultIndex; i < e.results.length; ++i) {
            text += e.results[i][0].transcript;
          }
          if (text.trim()) {
            onText(text.trim());
          }
        };

        rec.onerror = (e: any) => {
          setRecording(false);
          if (e.error !== "no-speech") {
            // Если SpeechRecognition не сработал или дал сбой — плавный фоллбэк на MediaRecorder
            startMediaRecorderFallback();
          }
        };

        rec.onend = () => {
          setRecording(false);
        };

        recognitionRef.current = rec;
        rec.start();
        return;
      } catch {
        // Если SpeechRecognition заблокирован или вызвал ошибку инициализации — переходим к MediaRecorder
      }
    }

    // 2. ФОЛЛБЭК: Запись через MediaRecorder и отправка на сервер
    await startMediaRecorderFallback();
  };

  const startMediaRecorderFallback = async () => {
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
        if (blob.size < 1000) {
          toast.error("Слишком короткая запись голоса");
          setRecording(false);
          return;
        }
        setBusy(true);
        setRecording(false);
        try {
          const b64 = await blobToBase64(blob);
          const { text } = await transcribeAudio({ data: { audio_base64: b64, mime: blob.type } as any });
          if (text && text.trim()) {
            onText(text.trim());
          } else {
            toast.error("Речь не распознана. Введите текст вручную или попробуйте снова.");
          }
        } catch (e: any) {
          toast.error("Сбой распознавания речи. Попробуйте снова или введите текст.");
        } finally {
          setBusy(false);
        }
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
      toast.info("Запись голоса началась...");
    } catch (e: any) {
      toast.error("Микрофон недоступен. Проверьте разрешения в браузере или введите текст вручную.");
      setRecording(false);
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current && recording) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    if (mediaRef.current && recording) {
      mediaRef.current.stop();
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (!disabled && !recording && !busy) {
      startRecording();
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.preventDefault();
    if (recording) {
      stopRecording();
    }
  };

  // Prevent default context menu on long press (mobile)
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
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
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onContextMenu={handleContextMenu}
      disabled={disabled || busy}
      title={busy ? "Распознавание речи..." : recording ? "Отпустите, чтобы завершить запись" : title}
      className={`relative rounded-full flex items-center justify-center transition-all shrink-0 ${sizeClasses} ${
        recording
          ? "bg-blue-600 shadow-[0_0_20px_rgba(37,99,235,0.4)] text-white scale-105 border-4 border-blue-200"
          : busy
          ? "bg-slate-100 text-slate-400 opacity-80"
          : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 hover:shadow-sm"
      } ${className}`}
    >
      {busy ? (
        <Loader2 className={`${iconSizes} animate-spin`} />
      ) : recording ? (
        <Square className={`${iconSizes} text-primary fill-current animate-bounce`} />
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
