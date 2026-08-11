import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertOwner(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase
    .from("user_roles").select("role").eq("user_id", ctx.userId).eq("role", "owner").maybeSingle();
  if (!data) throw new Error("Forbidden: owner only");
}

export const createChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    name: z.string().min(1),
    member_ids: z.array(z.string().uuid()).default([]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");
    const { data: chat, error } = await supabaseAdmin.from("chats").insert({ name: data.name, is_dm: false }).select().single();
    if (error) throw new Error(error.message);
    const members = [...new Set([context.userId, ...data.member_ids])];
    await supabaseAdmin.from("chat_members").insert(members.map((user_id) => ({ chat_id: chat.id, user_id })));
    await logAudit({ actor_user_id: context.userId, action: "chat.created", entity_type: "chat", entity_id: chat.id, details: { name: data.name, members } });
    return chat;
  });

export const setChatMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    chat_id: z.string().uuid(),
    member_ids: z.array(z.string().uuid()),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");
    await supabaseAdmin.from("chat_members").delete().eq("chat_id", data.chat_id);
    const members = [...new Set([context.userId, ...data.member_ids])];
    await supabaseAdmin.from("chat_members").insert(members.map((user_id) => ({ chat_id: data.chat_id, user_id })));
    await logAudit({ actor_user_id: context.userId, action: "chat.members_set", entity_type: "chat", entity_id: data.chat_id, details: { members } });
    return { ok: true };
  });

export const deleteChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ chat_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");
    const { error } = await supabaseAdmin.from("chats").delete().eq("id", data.chat_id);
    if (error) throw new Error(error.message);
    await logAudit({ actor_user_id: context.userId, action: "chat.deleted", entity_type: "chat", entity_id: data.chat_id });
    return { ok: true };
  });
