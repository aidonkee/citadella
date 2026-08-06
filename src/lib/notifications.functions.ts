import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getNotificationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("notification_settings").select("*").eq("user_id", context.userId).maybeSingle();
    return data ?? {
      user_id: context.userId,
      realtime_status_changes: true,
      realtime_worker_replies: true,
      realtime_new_claims: true,
      email_status_changes: false,
      email_worker_replies: false,
      email_new_claims: false,
      email_address: null,
    };
  });

export const saveNotificationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    realtime_status_changes: z.boolean(),
    realtime_worker_replies: z.boolean(),
    realtime_new_claims: z.boolean(),
    email_status_changes: z.boolean(),
    email_worker_replies: z.boolean(),
    email_new_claims: z.boolean(),
    email_address: z.string().email().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("notification_settings").upsert({
      user_id: context.userId,
      ...data,
      email_address: data.email_address ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
