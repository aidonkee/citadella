import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  isRecording: boolean;
  isProcessing: boolean;
  onPressStart: () => void;
  onPressEnd: () => void;
  onVolumeChange?: (level: number) => void;
  disabled?: boolean;
  size?: "md" | "lg";
};

export function GeminiVoiceOrb({
  isRecording,
  isProcessing,
  onPressStart,
  onPressEnd,
  onVolumeChange,
  disabled = false,
  size = "md",
}: Props) {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isRecording) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setLevel(0);
      onVolumeChange?.(0);
      return;
    }
    let amplitude = 0.4;
    const tick = () => {
      amplitude = Math.min(1, Math.max(0.1, amplitude + (Math.random() - 0.45) * 0.08));
      setLevel(amplitude);
      onVolumeChange?.(amplitude);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isRecording, onVolumeChange]);

  const dim = size === "lg" ? "h-20 w-20" : "h-14 w-14";
  const ring = size === "lg" ? "h-32 w-32" : "h-24 w-24";

  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <div className={cn("relative flex items-center justify-center", ring)}>
        {/* Recording ring */}
        {isRecording && (
          <span
            className={cn("absolute inset-0 rounded-full border-2 border-emerald-400 transition-transform duration-150", isRecording && "animate-pulse")}
            style={{ transform: `scale(${0.75 + level * 0.25})` }}
          />
        )}

        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            if (!disabled && !isRecording) onPressStart();
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            if (isRecording) onPressEnd();
          }}
          onPointerLeave={() => {
            if (isRecording) onPressEnd();
          }}
          onContextMenu={(e) => e.preventDefault()}
          disabled={disabled}
          aria-label={isRecording ? "Остановить запись" : "Начать запись"}
          className={cn(
            "relative flex items-center justify-center rounded-full transition-all duration-200 touch-none select-none",
            dim,
            isRecording
              ? "bg-destructive text-white shadow-lg"
              : isProcessing
                ? "bg-muted text-muted-foreground"
                : "bg-primary text-primary-foreground shadow-lg hover:bg-primary/95 active:scale-95",
            disabled && "opacity-60",
          )}
        >
          {isProcessing ? <Loader2 className="size-6 animate-spin" /> : isRecording ? <Square className="size-6" /> : <Mic className="size-6" />}
        </button>
      </div>
    </div>
  );
}
