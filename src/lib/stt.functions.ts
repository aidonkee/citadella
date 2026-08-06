import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    audio_base64: z.string().min(10),
    mime: z.string().default("audio/webm"),
  }).parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI не настроен");
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
      headers: { "Lovable-API-Key": key },
      body: fd,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`STT ${res.status}: ${t.slice(0, 200)}`);
    }
    const j = await res.json();
    return { text: (j.text ?? "") as string };
  });
