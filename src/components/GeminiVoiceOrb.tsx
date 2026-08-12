import React, { useEffect, useRef, useState } from "react";

interface GeminiVoiceOrbProps {
  isRecording: boolean;
  isProcessing: boolean;
  onPressStart: () => void;
  onPressEnd: () => void;
  onVolumeChange?: (vol: number) => void;
  disabled?: boolean;
}

export const GeminiVoiceOrb: React.FC<GeminiVoiceOrbProps> = ({
  isRecording,
  isProcessing,
  onPressStart,
  onPressEnd,
  onVolumeChange,
  disabled = false,
}) => {
  const [audioVolume, setAudioVolume] = useState<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  
  // Canvas для 3D-сферы (вращающийся глобус с 3D проекцией)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sphereRotationRef = useRef<number>(0);

  useEffect(() => {
    if (isRecording) {
      startAudioMonitoring();
    } else {
      stopAudioMonitoring();
    }
    return () => {
      stopAudioMonitoring();
    };
  }, [isRecording]);

  // Высокоточная 3D проекция сферы на HTML5 Canvas без квадратных границ
  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render3DSphere = () => {
      // Скорость вращения градиентов внутри сферы
      const speed = isRecording ? 0.08 + audioVolume * 0.15 : isProcessing ? 0.05 : 0.015;
      sphereRotationRef.current += speed;
      const rot = sphereRotationRef.current;

      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      // Внешний радиус ауры и внутренний шара
      const rAura = Math.min(w, h) / 2;
      const r = rAura * 0.85; 

      ctx.clearRect(0, 0, w, h);

      // 1. Внешняя пульсирующая аура (строго круг)
      const auraPulse = isRecording ? audioVolume * 15 : 0;
      const auraGrad = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, rAura + auraPulse);
      
      if (isRecording) {
        auraGrad.addColorStop(0, "rgba(0, 229, 255, 0.4)");
        auraGrad.addColorStop(0.5, "rgba(236, 72, 153, 0.2)");
        auraGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      } else if (isProcessing) {
        auraGrad.addColorStop(0, "rgba(124, 77, 255, 0.35)");
        auraGrad.addColorStop(0.7, "rgba(57, 73, 171, 0.15)");
        auraGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      } else {
        auraGrad.addColorStop(0, "rgba(0, 176, 255, 0.2)");
        auraGrad.addColorStop(0.8, "rgba(13, 71, 161, 0.05)");
        auraGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      }

      ctx.beginPath();
      ctx.arc(cx, cy, rAura + auraPulse, 0, Math.PI * 2);
      ctx.fillStyle = auraGrad;
      ctx.fill();

      // 2. Внутренняя гладкая градиентная сфера
      // Динамическое смещение центра блика (вращается)
      const shineX = cx + Math.cos(rot) * (r * 0.3);
      const shineY = cy + Math.sin(rot * 0.8) * (r * 0.3);

      const sphereGrad = ctx.createRadialGradient(shineX, shineY, r * 0.1, cx, cy, r);
      
      if (isRecording) {
        sphereGrad.addColorStop(0, "#E0F7FA"); // Яркий блик
        sphereGrad.addColorStop(0.2, "#00E5FF");
        sphereGrad.addColorStop(0.5, "#D500F9");
        sphereGrad.addColorStop(0.8, "#311B92");
        sphereGrad.addColorStop(1, "#0A001A");
      } else if (isProcessing) {
        sphereGrad.addColorStop(0, "#F3E5F5");
        sphereGrad.addColorStop(0.3, "#AA00FF");
        sphereGrad.addColorStop(0.6, "#6200EA");
        sphereGrad.addColorStop(1, "#0D0A20");
      } else {
        sphereGrad.addColorStop(0, "#E1F5FE");
        sphereGrad.addColorStop(0.3, "#00B0FF");
        sphereGrad.addColorStop(0.6, "#1976D2");
        sphereGrad.addColorStop(0.9, "#0D47A1");
        sphereGrad.addColorStop(1, "#051024");
      }

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = sphereGrad;
      ctx.fill();

      // 3. Дополнительный внутренний объем (тень по краям)
      const innerShadow = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r);
      innerShadow.addColorStop(0, "rgba(0,0,0,0)");
      innerShadow.addColorStop(1, "rgba(0,0,0,0.6)");
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = innerShadow;
      ctx.fill();

      // 4. Тонкое светящееся кольцо на границе сферы для подчеркивания формы шара
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = isRecording ? "rgba(0, 229, 255, 0.4)" : "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      animId = requestAnimationFrame(render3DSphere);
    };

    render3DSphere();
    return () => cancelAnimationFrame(animId);
  }, [isRecording, isProcessing, audioVolume]);

  const startAudioMonitoring = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        const normalized = Math.min(1, Math.max(0, average / 100));
        setAudioVolume(normalized);
        if (onVolumeChange) onVolumeChange(normalized);
        animFrameRef.current = requestAnimationFrame(updateVolume);
      };

      updateVolume();
    } catch (err) {
      console.warn("Аудиоанализатор недоступен:", err);
    }
  };

  const stopAudioMonitoring = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setAudioVolume(0);
    if (onVolumeChange) onVolumeChange(0);
  };

  const dynamicScale = isRecording ? 1 + audioVolume * 0.25 : isProcessing ? 1.05 : 1;

  const handleOrbClick = (e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return;
    if (isRecording) {
      onPressEnd();
    } else {
      onPressStart();
    }
  };


  return (
    <div className="relative flex flex-col items-center justify-center my-6 select-none">
      {/* Контейнер сферы со строго круглой формой (без квадратов и углов) */}
      <div
        onClick={handleOrbClick}
        className={`relative flex items-center justify-center rounded-full transition-all duration-200 transform active:scale-95 cursor-pointer select-none ${
          disabled ? "opacity-50 cursor-not-allowed" : ""
        }`}
        style={{
          transform: `scale(${dynamicScale})`,
          width: "210px",
          height: "210px",
          borderRadius: "9999px",
        }}
      >
        <canvas
          ref={canvasRef}
          width={300}
          height={300}
          className="w-full h-full pointer-events-none block rounded-full"
          style={{ borderRadius: "9999px" }}
        />
      </div>
    </div>
  );
};
