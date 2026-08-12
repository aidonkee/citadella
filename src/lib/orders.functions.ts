import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { aiGenerateOrderCard, assertOwner, getRole, getTargetChats, processDmReply, processAiAssistantQuery, triggerAiPollHelper } from "./orders.server";
import { buildOrderMetadata } from "./order-metadata";

const OrderInput = z.object({
  number: z.string().min(1),
  order_date: z.string().nullable().optional(),
  finish_date: z.string().nullable().optional(),
  nomenclature: z.string().default(""),
  customer_order: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  chat_id: z.string().uuid().nullable().optional(),
  follow_up_interval_minutes: z.number().int().min(5).default(120),
});

export const createOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => OrderInput.parse(d))
  .handler(async ({ data, context }) => {
    const role = await getRole(context);
    if (role !== "owner" && role !== "manager") throw new Error("Forbidden");
    const isManager = role === "manager";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit, notifyOwners } = await import("@/lib/audit.server");
    const chat_id = isManager ? null : (data.chat_id || null);
    const needsDispatch = !chat_id;
    const { data: order, error } = await supabaseAdmin.from("orders").insert({
      number: data.number,
      order_date: data.order_date || null,
      finish_date: data.finish_date || null,
      nomenclature: data.nomenclature,
      customer_order: data.customer_order || null,
      comment: data.comment || null,
      chat_id,
      follow_up_interval_minutes: data.follow_up_interval_minutes,
      created_by: context.userId,
      is_dispatched: !needsDispatch,
      dispatched_at: needsDispatch ? null : new Date().toISOString(),
    }).select().single();
    if (error) throw new Error(error.message);

    let msg: any = null;
    if (chat_id) {
      const content = await aiGenerateOrderCard(data);
      const { data: insertedMsg, error: msgError } = await supabaseAdmin.from("messages").insert({
        chat_id, is_ai: true, content, order_id: order.id, kind: "order_card",
      }).select().single();
      if (msgError) throw new Error(msgError.message);
      msg = insertedMsg;
      await supabaseAdmin.from("orders").update({ ai_message_id: msg?.id }).eq("id", order.id);
      await logAudit({ actor_user_id: null, action: "message.ai_sent", entity_type: "message", entity_id: msg?.id ?? null, details: { chat_id, kind: "order_card", order_id: order.id } });
    }
    await logAudit({ actor_user_id: context.userId, action: isManager ? "order.submitted" : "order.created", entity_type: "order", entity_id: order.id, details: { number: order.number, chat_id, by_manager: isManager } });
    if (needsDispatch) {
      await notifyOwners({ title: isManager ? `📥 Новый заказ от менеджера: ${order.number}` : `📥 Новый заказ для распределения: ${order.number}`, body: data.nomenclature.slice(0, 160), link: `/admin/inbox`, kind: "new_claim" });
    }
    return order;
  });

export const dispatchOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    order_id: z.string().uuid(),
    chat_ids: z.array(z.string().uuid()).min(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");
    const { data: order, error: oe } = await supabaseAdmin.from("orders").select("*").eq("id", data.order_id).single();
    if (oe || !order) throw new Error("Заказ не найден");
    const orderInput = {
      number: order.number, order_date: order.order_date, finish_date: order.finish_date,
      nomenclature: order.nomenclature, customer_order: order.customer_order, comment: order.comment,
      chat_id: null, follow_up_interval_minutes: order.follow_up_interval_minutes,
    };
    const content = await aiGenerateOrderCard(orderInput);
    let firstMsgId: string | null = null;
    for (const cid of data.chat_ids) {
      const { data: m, error: msgError } = await supabaseAdmin.from("messages").insert({
        chat_id: cid, is_ai: true, content, order_id: order.id, kind: "order_card",
      }).select().single();
      if (msgError) throw new Error(msgError.message);
      if (!firstMsgId) firstMsgId = m?.id ?? null;
      await logAudit({ actor_user_id: null, action: "message.ai_sent", entity_type: "message", entity_id: m?.id ?? null, details: { chat_id: cid, kind: "order_card", order_id: order.id } });
    }
    const { error: updateError } = await supabaseAdmin.from("orders").update({
      is_dispatched: true,
      dispatched_at: new Date().toISOString(),
      dispatched_chat_ids: data.chat_ids,
      ai_message_id: firstMsgId,
    }).eq("id", order.id);
    if (updateError) throw new Error(updateError.message);

    // Create assignments for each chat
    const assignments = data.chat_ids.map(cid => ({
      order_id: order.id,
      chat_id: cid,
      status: "new" as const
    }));
    await supabaseAdmin.from("order_assignments").upsert(assignments, { onConflict: "order_id,chat_id" });

    await logAudit({ actor_user_id: context.userId, action: "order.dispatched", entity_type: "order", entity_id: order.id, details: { chat_ids: data.chat_ids, number: order.number } });
    return { ok: true, count: data.chat_ids.length };
  });


export const bulkCreateOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    chat_id: z.string().uuid(),
    follow_up_interval_minutes: z.number().int().min(5).default(120),
    orders: z.array(OrderInput.omit({ chat_id: true, follow_up_interval_minutes: true })),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context);
    let count = 0;
    for (const o of data.orders) {
      await createOrder({ data: { ...o, chat_id: data.chat_id, follow_up_interval_minutes: data.follow_up_interval_minutes } as any });
      count++;
    }
    return { count };
  });

export const claimOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ order_id: z.string().uuid(), chat_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit, notifyOwners } = await import("@/lib/audit.server");
    
    // Check if order in this chat is already assigned
    const { data: existingAssignment } = await supabaseAdmin
      .from("order_assignments")
      .select("responsible_user_id, status")
      .eq("order_id", data.order_id)
      .eq("chat_id", data.chat_id)
      .maybeSingle();

    if (existingAssignment?.responsible_user_id) {
      throw new Error("Заказ в этом цехе уже взят в работу");
    }

    // Immediately record claim as confirmed
    await supabaseAdmin.from("order_claims").upsert({
      order_id: data.order_id,
      chat_id: data.chat_id,
      user_id: context.userId,
      status: "confirmed",
    }, { onConflict: "order_id,chat_id" });

    const { data: order } = await supabaseAdmin.from("orders").select("*").eq("id", data.order_id).single();
    if (!order) throw new Error("Заказ не найден");
    const next = new Date(Date.now() + order.follow_up_interval_minutes * 60 * 1000).toISOString();

    // Immediately assign responsible user and set status to in_progress
    await supabaseAdmin.from("order_assignments").upsert({
      order_id: data.order_id,
      chat_id: data.chat_id,
      responsible_user_id: context.userId,
      status: "in_progress",
    }, { onConflict: "order_id,chat_id" });

    await supabaseAdmin.from("orders").update({
      last_update_at: new Date().toISOString(),
      next_follow_up_at: next,
    }).eq("id", data.order_id);

    const { data: profile } = await supabaseAdmin.from("profiles").select("display_name").eq("id", context.userId).single();
    const workerName = profile?.display_name ?? "Сотрудник";

    const { data: sysmsg, error: msgError } = await supabaseAdmin.from("messages").insert({
      chat_id: data.chat_id, is_ai: true, kind: "system", order_id: order.id,
      content: `✅ Заказ **${order.number}** взял в работу **${workerName}**`,
    }).select().single();
    if (msgError) throw new Error(msgError.message);
    await logAudit({ actor_user_id: null, action: "message.ai_sent", entity_type: "message", entity_id: sysmsg?.id ?? null, details: { chat_id: data.chat_id, kind: "system", order_id: order.id } });

    const { data: dm } = await supabaseAdmin.from("chats").select("id").eq("is_dm", true).eq("dm_user_id", context.userId).maybeSingle();
    if (dm) {
      const { data: followupMsg } = await supabaseAdmin.from("messages").insert({
        chat_id: dm.id, is_ai: true, kind: "followup", order_id: order.id,
        content: `Привет! Ты взял в работу заказ **${order.number}** (${order.nomenclature}). Напиши коротко — на какой стадии? Я буду уточнять каждые ${order.follow_up_interval_minutes} мин.`,
      }).select().single();
      await logAudit({ actor_user_id: null, action: "message.ai_sent", entity_type: "message", entity_id: followupMsg?.id ?? null, details: { chat_id: dm.id, kind: "followup", order_id: order.id } });
    }

    await logAudit({ actor_user_id: context.userId, action: "claim.confirmed", entity_type: "order", entity_id: order.id, details: { number: order.number, chat_id: data.chat_id } });
    await notifyOwners({ title: "Заказ взят в работу", body: `${workerName} взял в работу заказ ${order.number}`, link: `/chats/${data.chat_id}` , kind: "status_change" });
    return { ok: true };
  });

export const confirmClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ order_id: z.string().uuid(), chat_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit, notifyOwners } = await import("@/lib/audit.server");
    const { getRole } = await import("./orders.server");
    
    const { data: claim } = await supabaseAdmin
      .from("order_claims").select("*")
      .eq("order_id", data.order_id).eq("chat_id", data.chat_id)
      .eq("status", "pending").maybeSingle();
      
    if (!claim) throw new Error("Нет ожидающего отклика");

    const role = await getRole(context);
    const isOwnerOrManager = role === "owner" || role === "manager";
    const isClaimer = claim.user_id === context.userId;

    if (!isOwnerOrManager && !isClaimer) {
      throw new Error("Только автор отклика или Руководитель могут подтвердить отклик");
    }

    await supabaseAdmin.from("order_claims").update({ status: "confirmed" }).eq("id", claim.id);
    const { data: order } = await supabaseAdmin.from("orders").select("*").eq("id", data.order_id).single();
    if (!order) throw new Error("Заказ не найден");
    const next = new Date(Date.now() + order.follow_up_interval_minutes * 60 * 1000).toISOString();
    
    await supabaseAdmin.from("order_assignments").update({
      responsible_user_id: claim.user_id,
      status: "in_progress",
    }).eq("order_id", data.order_id).eq("chat_id", data.chat_id);

    await supabaseAdmin.from("orders").update({
      last_update_at: new Date().toISOString(),
      next_follow_up_at: next,
    }).eq("id", data.order_id);

    const { data: profile } = await supabaseAdmin.from("profiles").select("display_name").eq("id", claim.user_id).single();
    const workerName = profile?.display_name ?? "Сотрудник";
    const confirmedByText = isOwnerOrManager && !isClaimer ? " (утверждено руководителем)" : "";

    const { data: sysmsg, error: msgError } = await supabaseAdmin.from("messages").insert({
      chat_id: data.chat_id, is_ai: true, kind: "system", order_id: order.id,
      content: `✅ Заказ **${order.number}** взял в работу **${workerName}**${confirmedByText}`,
    }).select().single();
    if (msgError) throw new Error(msgError.message);
    await logAudit({ actor_user_id: null, action: "message.ai_sent", entity_type: "message", entity_id: sysmsg?.id ?? null, details: { chat_id: data.chat_id, kind: "system", order_id: order.id } });

    const { data: dm } = await supabaseAdmin.from("chats").select("id").eq("is_dm", true).eq("dm_user_id", claim.user_id).maybeSingle();
    if (dm) {
      const { data: followupMsg } = await supabaseAdmin.from("messages").insert({
        chat_id: dm.id, is_ai: true, kind: "followup", order_id: order.id,
        content: `Привет! Заказ **${order.number}** (${order.nomenclature}) подтверждён и передан тебе в работу. Напиши коротко — на какой стадии? Я буду уточнять каждые ${order.follow_up_interval_minutes} мин.`,
      }).select().single();
      await logAudit({ actor_user_id: null, action: "message.ai_sent", entity_type: "message", entity_id: followupMsg?.id ?? null, details: { chat_id: dm.id, kind: "followup", order_id: order.id } });
    }
    await logAudit({ actor_user_id: context.userId, action: "claim.confirmed", entity_type: "order", entity_id: order.id, details: { number: order.number, chat_id: data.chat_id, worker_id: claim.user_id } });
    await notifyOwners({ title: "Заказ принят в работу", body: `${workerName} подтвердил заказ ${order.number} в одном из цехов`, link: `/chats/${data.chat_id}` , kind: "status_change" });
    return { ok: true };
  });

export const rejectClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ order_id: z.string().uuid(), chat_id: z.string().uuid(), reason: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit, notifyOwners } = await import("@/lib/audit.server");
    const { getRole } = await import("./orders.server");

    const { data: claim } = await supabaseAdmin
      .from("order_claims").select("*")
      .eq("order_id", data.order_id).eq("chat_id", data.chat_id)
      .eq("status", "pending").maybeSingle();
      
    if (!claim) throw new Error("Нет ожидающего отклика");

    const role = await getRole(context);
    const isOwnerOrManager = role === "owner" || role === "manager";
    const isClaimer = claim.user_id === context.userId;

    if (!isOwnerOrManager && !isClaimer) {
      throw new Error("Только автор отклика или Руководитель могут отклонить отклик");
    }

    await supabaseAdmin.from("order_claims").update({ status: "rejected" }).eq("id", claim.id);
    const { data: order } = await supabaseAdmin.from("orders").select("*").eq("id", data.order_id).single();
    const { data: profile } = await supabaseAdmin.from("profiles").select("display_name").eq("id", claim.user_id).single();
    const workerName = profile?.display_name ?? "Сотрудник";

    const actorText = isClaimer ? `**${workerName}** отозвал свой отклик` : `Руководитель отклонил отклик **${workerName}**`;

    const { data: sysmsg, error: msgError } = await supabaseAdmin.from("messages").insert({
      chat_id: data.chat_id, is_ai: true, kind: "system", order_id: data.order_id,
      content: `↩️ ${actorText} на заказ **${order?.number ?? ""}**${data.reason ? ` — ${data.reason}` : ""}. Заказ снова свободен.`,
    }).select().single();
    if (msgError) throw new Error(msgError.message);
    await logAudit({ actor_user_id: null, action: "message.ai_sent", entity_type: "message", entity_id: sysmsg?.id ?? null, details: { chat_id: data.chat_id, kind: "system", order_id: data.order_id } });

    await logAudit({ actor_user_id: context.userId, action: "claim.rejected", entity_type: "order", entity_id: data.order_id, details: { reason: data.reason ?? null, number: order?.number, chat_id: data.chat_id } });
    await notifyOwners({ title: "Отклик отклонён", body: `Отклик на заказ ${order?.number ?? ""} отклонён`, link: `/chats/${data.chat_id}` , kind: "new_claim" });
    return { ok: true };
  });


export const updateOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    order_id: z.string().uuid(),
    chat_id: z.string().uuid(),
    status: z.enum(["new", "in_progress", "stalled", "completed", "overdue"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit, notifyOwners } = await import("@/lib/audit.server");
    
    const { data: assignment } = await supabaseAdmin.from("order_assignments").select("status").eq("order_id", data.order_id).eq("chat_id", data.chat_id).single();
    const prevStatus = assignment?.status;

    const { error } = await supabaseAdmin.from("order_assignments").update({
      status: data.status,
    }).eq("order_id", data.order_id).eq("chat_id", data.chat_id);
    if (error) throw new Error(error.message);

    const { data: prev } = await supabaseAdmin.from("orders").select("number").eq("id", data.order_id).single();

    await logAudit({ actor_user_id: context.userId, action: "order.status_changed", entity_type: "order", entity_id: data.order_id, details: { from: prevStatus, to: data.status, number: prev?.number, chat_id: data.chat_id } });
    await notifyOwners({ title: `Статус заказа ${prev?.number ?? ""}`, body: `${prevStatus ?? "—"} → ${data.status}`, link: `/chats/${data.chat_id}`, kind: "status_change" });
    return { ok: true };
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    chat_id: z.string().uuid(),
    content: z.string().min(1).max(4000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit, notifyOwners } = await import("@/lib/audit.server");
    const { data: msg, error } = await supabaseAdmin.from("messages").insert({
      chat_id: data.chat_id,
      sender_user_id: context.userId,
      content: data.content,
      kind: "text",
    }).select().single();
    if (error) throw new Error(error.message);

    await logAudit({ actor_user_id: context.userId, action: "message.sent", entity_type: "message", entity_id: msg?.id ?? null, details: { chat_id: data.chat_id } });

    const { data: chat } = await supabaseAdmin.from("chats").select("*").eq("id", data.chat_id).single();
    // Notify owners when a worker replies in a shared chat
    const { data: senderRole } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", context.userId).maybeSingle();
    if (senderRole?.role !== "owner") {
      const { data: profile } = await supabaseAdmin.from("profiles").select("display_name").eq("id", context.userId).single();
      await notifyOwners({
        kind: "worker_reply",
        title: chat?.is_dm ? "Сообщение от сотрудника (ЛС)" : `Ответ в чате «${chat?.name ?? ""}»`,
        body: `${profile?.display_name ?? "Сотрудник"}: ${data.content.slice(0, 140)}`,
        link: chat?.is_dm ? undefined : `/chats/${data.chat_id}`,
      });
    }

    if ((chat?.is_dm && chat.dm_user_id === context.userId) || /@nerva|@нерва|@ии|@ai/i.test(data.content)) {
      const { processAiAssistantQuery } = await import("./orders.server");
      await processAiAssistantQuery(context.userId, data.content, data.chat_id);
    }
    return msg;
  });

export const triggerAiPoll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { triggerAiPollHelper } = await import("./orders.server");
    return await triggerAiPollHelper(context.userId);
  });

export const askNervaDirect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    content: z.string().min(1).max(4000),
    chat_id: z.string().uuid().optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { processAiAssistantQuery } = await import("./orders.server");
    return await processAiAssistantQuery(context.userId, data.content, data.chat_id);
  });

export const toggleOrderSectorStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    order_id: z.string().uuid(),
    chat_id: z.string().uuid(),
    is_completed: z.boolean(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getTargetChats } = await import("./orders.server");
    const { parseOrderMetadata, buildOrderMetadata } = await import("./order-metadata");
    const { logAudit, notifyOwners } = await import("@/lib/audit.server");
    
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", data.order_id)
      .single();
      
    if (orderError || !order) throw new Error(orderError?.message || "Order not found");
    
    const targetChats = getTargetChats(order);
    if (!targetChats.includes(data.chat_id)) {
      throw new Error("Chat is not assigned to this order");
    }
    
    const meta = parseOrderMetadata(order.comment);
    const sectors = meta.completed_sectors || {};
    sectors[data.chat_id] = data.is_completed;
    
    const allCompleted = targetChats.every(cid => sectors[cid] === true);
    
    let newStatus = order.status;
    if (allCompleted) {
      newStatus = "completed";
    } else if (order.status === "completed" && !allCompleted) {
      newStatus = "in_progress";
    }
    
    const newComment = buildOrderMetadata({ ...meta, completed_sectors: sectors }, order.comment);
    
    const updates: any = {
      comment: newComment,
      status: newStatus,
      last_update_at: new Date().toISOString()
    };
    
    const { error: updateError } = await supabaseAdmin
      .from("orders")
      .update(updates)
      .eq("id", data.order_id);
      
    if (updateError) throw new Error(updateError.message);
    
    const { data: profile } = await supabaseAdmin.from("profiles").select("display_name").eq("id", context.userId).single();
    const actionText = data.is_completed ? "завершил свою часть работы над заказом" : "вернул заказ в работу (в этом секторе)";
    
    await supabaseAdmin.from("messages").insert({
      chat_id: data.chat_id,
      is_ai: true,
      kind: "system",
      order_id: order.id,
      content: `🔄 **${profile?.display_name || "Сотрудник"}** ${actionText}`
    });
    
    if (newStatus === "completed" && order.status !== "completed") {
      await notifyOwners({ title: "Заказ полностью выполнен", body: `Заказ ${order.number} завершен всеми секторами`, link: `/dashboard`, kind: "status_change" });
    }
    
    await logAudit({ actor_user_id: context.userId, action: "order.sector_toggled", entity_type: "order", entity_id: data.order_id, details: { chat_id: data.chat_id, is_completed: data.is_completed, new_status: newStatus } });
    
    return { ok: true, status: newStatus };
  });

export const deleteOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ order_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await getRole(context);
    if (role !== "owner" && role !== "manager") throw new Error("Forbidden: Только владелец или менеджер могут удалять заказы");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");
    
    const { data: prev } = await supabaseAdmin.from("orders").select("number").eq("id", data.order_id).single();
    const { error } = await supabaseAdmin.from("orders").delete().eq("id", data.order_id);
    if (error) throw new Error(error.message);
    
    await logAudit({ actor_user_id: context.userId, action: "order.deleted", entity_type: "order", entity_id: data.order_id, details: { number: prev?.number } });
    return { ok: true };
  });

export const updateOrderDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    order_id: z.string().uuid(),
    number: z.string().min(1).optional(),
    nomenclature: z.string().optional(),
    status: z.enum(["new", "in_progress", "stalled", "completed", "overdue"]).optional(),
    finish_date: z.string().nullable().optional(),
    comment: z.string().nullable().optional(),
    responsible_user_id: z.string().uuid().nullable().optional(),
    chat_id: z.string().uuid().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await getRole(context);
    if (role !== "owner" && role !== "manager") throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");
    
    const updates: any = { last_update_at: new Date().toISOString() };
    if (data.number !== undefined) updates.number = data.number;
    if (data.nomenclature !== undefined) updates.nomenclature = data.nomenclature;
    if (data.status !== undefined) updates.status = data.status;
    if (data.finish_date !== undefined) updates.finish_date = data.finish_date;
    if (data.comment !== undefined) updates.comment = data.comment;
    if (data.responsible_user_id !== undefined) updates.responsible_user_id = data.responsible_user_id;
    if (data.chat_id !== undefined) updates.chat_id = data.chat_id;

    const { error } = await supabaseAdmin.from("orders").update(updates).eq("id", data.order_id);
    if (error) throw new Error(error.message);
    
    await logAudit({ actor_user_id: context.userId, action: "order.updated", entity_type: "order", entity_id: data.order_id, details: updates });
    return { ok: true };
  });

const ExcelOrderInput = z.object({
  number: z.string(),
  order_date: z.string().nullable().optional(),
  finish_date: z.string().nullable().optional(),
  nomenclature: z.string().default(""),
  customer_order: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  stage: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
});

export const importOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.array(ExcelOrderInput).parse(d))
  .handler(async ({ data, context }) => {
    const role = await getRole(context);
    if (role !== "owner" && role !== "manager") throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");
    
    // get existing orders to avoid duplicates
    const { data: existing } = await supabaseAdmin.from("orders").select("number");
    const existingSet = new Set(existing?.map(e => e.number) || []);
    
    const toInsert = data.filter(o => !existingSet.has(o.number)).map(o => {
      let stage = "Новый";
      if (o.stage === "Производство") stage = "Производство";
      if (o.stage === "Логистика") stage = "Логистика";
      if (o.stage === "Готово") stage = "Готово";
      
      let priority = "Обычный";
      if (o.priority === "Срочно") priority = "Срочно";
      if (o.priority === "Высокий" || o.priority === "Критично") priority = "Высокий";
      if (o.priority === "Средний") priority = "Средний";
      
      const comment = buildOrderMetadata({ stage: stage as any, priority: priority as any, comment: o.comment || "" }, null);
      
      return {
        number: o.number,
        order_date: o.order_date || null,
        finish_date: o.finish_date || null,
        nomenclature: o.nomenclature,
        customer_order: o.customer_order || null,
        comment,
        created_by: context.userId,
        is_dispatched: false,
      };
    });
    
    if (toInsert.length > 0) {
      const { error } = await supabaseAdmin.from("orders").insert(toInsert);
      if (error) throw new Error(error.message);
      
      await logAudit({ 
        actor_user_id: context.userId, 
        action: "order.imported", 
        entity_type: "order", 
        entity_id: null, 
        details: { count: toInsert.length } 
      });
    }
    
    return { ok: true, imported: toInsert.length, skipped: data.length - toInsert.length };
  });
