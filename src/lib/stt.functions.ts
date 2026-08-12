import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    audio_base64: z.string().min(10),
    mime: z.string().default("audio/webm"),
  }).parse(d))
  .handler(async ({ data }) => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY || process.env.ORDER_AI_KEY;

    if (!lovableKey && !openaiKey && !geminiKey) {
      throw new Error("AI не настроен");
    }

    // 1. Lovable AI Gateway (if configured)
    if (lovableKey) {
      const bin = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
      const ext = data.mime.includes("mp4") ? "mp4"
        : data.mime.includes("mpeg") ? "mp3"
        : data.mime.includes("wav") ? "wav"
        : "webm";
      const fd = new FormData();
      fd.append("model", "openai/gpt-4o-mini-transcribe");
      fd.append("file", new Blob([bin], { type: data.mime }), `voice.${ext}`);
      const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Lovable-API-Key": lovableKey },
        body: fd,
      });
      if (res.ok) {
        const j = await res.json();
        return { text: (j.text ?? "") as string };
      }
    }

    // 2. Direct OpenAI API (if configured)
    if (openaiKey) {
      const bin = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
      const ext = data.mime.includes("mp4") ? "mp4"
        : data.mime.includes("mpeg") ? "mp3"
        : data.mime.includes("wav") ? "wav"
        : "webm";
      const fd = new FormData();
      fd.append("model", "whisper-1");
      fd.append("file", new Blob([bin], { type: data.mime }), `voice.${ext}`);
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${openaiKey}` },
        body: fd,
      });
      if (res.ok) {
        const j = await res.json();
        return { text: (j.text ?? "") as string };
      }
    }

    // 3. Direct Gemini REST API (if GEMINI_API_KEY configured)
    if (geminiKey) {
      let mimeType = data.mime.split(";")[0].trim();
      if (!mimeType || mimeType === "unknown") mimeType = "audio/webm";
      
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: mimeType, data: data.audio_base64 } },
              { text: "Расшифруй эту аудиозапись. Верни ТОЛЬКО текст того, что сказано голосом, без кавычек, комментариев и префиксов. Если слова разобрать невозможно или на записи тишина, верни пустую строку." }
            ]
          }]
        })
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("Gemini STT error:", res.status, errText);
        throw new Error(`Gemini STT error ${res.status}: ${errText.slice(0, 200)}`);
      }

      const json = await res.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      return { text: rawText.trim() };
    }

    throw new Error("AI не настроен");
  });
