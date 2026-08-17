import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { aiGenerateOrderCard, assertOwner, getRole, getTargetChats, processDmReply, processAiAssistantQuery, triggerAiPollHelper } from "./orders.server";
import { buildOrderMetadata } from "./order-metadata";
import {
  claimAssignment,
  dispatchOrderToChats,
  reassignAssignmentResponsible,
  setAssignmentStatus,
  syncOrderStatusWithAssignments,
  getChatName,
  getProfileName,
} from "./assignments.server";

// Реэкспорт для обратной совместимости существующих импортов.
export { syncOrderStatusWithAssignments };

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

const AssignmentStatusEnum = z.enum(["new", "in_progress", "stalled", "blocked", "completed", "cancelled", "overdue"]);

async function isChatMember(supabaseAdmin: any, chatId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("chat_members")
    .select("user_id")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

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

    // Заказ, сразу назначенный в один чат (legacy-режим создания owner'ом)
    if (chat_id) {
      const content = await aiGenerateOrderCard(data);
      await dispatchOrderToChats(supabaseAdmin, { order, chatIds: [chat_id], cardContent: content });
      await logAudit({ actor_user_id: null, action: "message.ai_sent", entity_type: "message", entity_id: order.ai_message_id ?? null, details: { chat_id, kind: "order_card", order_id: order.id } });
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
    const role = await getRole(context);
    if (role !== "owner" && role !== "manager") throw new Error("Forbidden: только владелец или менеджер могут распределять заказы");
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

    // Сливаемся с существующими секторами: новые добавляются, старые сохраняются
    const result = await dispatchOrderToChats(supabaseAdmin, { order, chatIds: data.chat_ids, cardContent: content });
    for (const cid of result.added) {
      await logAudit({ actor_user_id: null, action: "message.ai_sent", entity_type: "message", entity_id: null, details: { chat_id: cid, kind: "order_card", order_id: order.id } });
    }

    await logAudit({ actor_user_id: context.userId, action: "order.dispatched", entity_type: "order", entity_id: order.id, details: { chat_ids: data.chat_ids, added: result.added, number: order.number } });
    return { ok: true, count: data.chat_ids.length, added: result.added.length, total: result.total };
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

// "Взять в работу" — принятие СВОЕГО assignment'а сектором.
// Никакого глобального lock на заказ: другие сектора по-прежнему могут взять заказ.
export const claimOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ order_id: z.string().uuid(), chat_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit, notifyOwners } = await import("@/lib/audit.server");
    const role = await getRole(context);

    // Работник (и пользователь без роли) может брать заказ только в СВОЁМ секторе (чате, где он участник)
    if (role !== "owner" && role !== "manager") {
      const member = await isChatMember(supabaseAdmin, data.chat_id, context.userId);
      if (!member) throw new Error("Вы не являетесь участником этого цеха и не можете взять этот заказ");
    }

    const result = await claimAssignment(supabaseAdmin, {
      orderId: data.order_id,
      chatId: data.chat_id,
      userId: context.userId,
    });
    if (result.alreadyMine) return { ok: true };
    const order = result.order;

    await logAudit({ actor_user_id: context.userId, action: "claim.confirmed", entity_type: "order", entity_id: order.id, details: { number: order.number, chat_id: data.chat_id, chat_name: result.chatName } });
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

    // Автор отклика подтверждает сам себя — только в своём цехе
    if (isClaimer && !isOwnerOrManager) {
      const member = await isChatMember(supabaseAdmin, data.chat_id, claim.user_id);
      if (!member) throw new Error("Вы не являетесь участником этого цеха — подтвердить отклик нельзя");
    }

    await supabaseAdmin.from("order_claims").update({ status: "confirmed" }).eq("id", claim.id);

    const result = await claimAssignment(supabaseAdmin, {
      orderId: data.order_id,
      chatId: data.chat_id,
      userId: claim.user_id,
      confirmedByManager: isOwnerOrManager && !isClaimer,
    });
    const order = result.order;

    await logAudit({ actor_user_id: context.userId, action: "claim.confirmed", entity_type: "order", entity_id: order.id, details: { number: order.number, chat_id: data.chat_id, worker_id: claim.user_id } });
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
    const workerName = (await getProfileName(supabaseAdmin, claim.user_id)) ?? "Сотрудник";

    const actorText = isClaimer ? `**${workerName}** отозвал свой отклик` : `Руководитель отклонил отклик **${workerName}**`;

    const { data: sysmsg, error: msgError } = await supabaseAdmin.from("messages").insert({
      chat_id: data.chat_id, is_ai: true, kind: "system", order_id: data.order_id,
      content: `↩️ ${actorText} на заказ **${order?.number ?? ""}**${data.reason ? ` — ${data.reason}` : ""}. Заказ в этом секторе снова свободен.`,
    }).select().single();
    if (msgError) throw new Error(msgError.message);
    await logAudit({ actor_user_id: null, action: "message.ai_sent", entity_type: "message", entity_id: sysmsg?.id ?? null, details: { chat_id: data.chat_id, kind: "system", order_id: data.order_id } });

    await logAudit({ actor_user_id: context.userId, action: "claim.rejected", entity_type: "order", entity_id: data.order_id, details: { reason: data.reason ?? null, number: order?.number, chat_id: data.chat_id } });
    await notifyOwners({ title: "Отклик отклонён", body: `Отклик на заказ ${order?.number ?? ""} отклонён`, link: `/chats/${data.chat_id}` , kind: "new_claim" });
    return { ok: true };
  });

// Смена статуса ОДНОГО assignment (order_id + chat_id).
// Разрешено: owner/manager — любой статус любому сектору;
// работник — только своему assignment (он responsible).
export const updateOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    order_id: z.string().uuid(),
    chat_id: z.string().uuid(),
    status: AssignmentStatusEnum,
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit, notifyOwners } = await import("@/lib/audit.server");
    const role = await getRole(context);

    if (role !== "owner" && role !== "manager") {
      let allowed = false;
      const { data: assignment, error: aErr } = await supabaseAdmin
        .from("order_assignments")
        .select("responsible_user_id")
        .eq("order_id", data.order_id)
        .eq("chat_id", data.chat_id)
        .maybeSingle();
      if (!aErr) {
        allowed = assignment?.responsible_user_id === context.userId;
      } else {
        // До миграции: ответственный == responsible_user_id заказа
        const { data: orderRow } = await supabaseAdmin
          .from("orders")
          .select("responsible_user_id")
          .eq("id", data.order_id)
          .maybeSingle();
        allowed = orderRow?.responsible_user_id === context.userId;
      }
      if (!allowed) {
        throw new Error("Только ответственный за этот сектор или руководство могут менять статус");
      }
    }

    const { prevStatus } = await setAssignmentStatus(supabaseAdmin, {
      orderId: data.order_id,
      chatId: data.chat_id,
      status: data.status,
    });

    const { data: prev } = await supabaseAdmin.from("orders").select("number").eq("id", data.order_id).single();
    const chatName = (await getChatName(supabaseAdmin, data.chat_id)) ?? "цех";

    await logAudit({ actor_user_id: context.userId, action: "assignment.status_changed", entity_type: "order", entity_id: data.order_id, details: { from: prevStatus, to: data.status, number: prev?.number, chat_id: data.chat_id, chat_name: chatName } });
    await notifyOwners({ title: `Статус заказа ${prev?.number ?? ""} (${chatName})`, body: `${prevStatus ?? "—"} → ${data.status}`, link: `/chats/${data.chat_id}`, kind: "status_change" });
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
    const role = await getRole(context);
    if (role !== "owner" && role !== "manager") throw new Error("Forbidden: опрос доступен только руководству");
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

// Завершить/вернуть в работу СВОЙ сектор. Другие assignments не изменяются.
export const toggleOrderSectorStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    order_id: z.string().uuid(),
    chat_id: z.string().uuid(),
    is_completed: z.boolean(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit, notifyOwners } = await import("@/lib/audit.server");
    const role = await getRole(context);

    let assignment;
    const { data: assignData, error: assignErr } = await supabaseAdmin
      .from("order_assignments")
      .select("responsible_user_id")
      .eq("order_id", data.order_id)
      .eq("chat_id", data.chat_id)
      .maybeSingle();
    if (!assignErr) assignment = assignData;

    if (role !== "owner" && role !== "manager") {
      let allowed = false;
      if (assignment) {
        allowed = assignment.responsible_user_id === context.userId;
      } else {
        // До миграции: ответственный == responsible_user_id заказа
        const { data: orderRow } = await supabaseAdmin
          .from("orders")
          .select("responsible_user_id")
          .eq("id", data.order_id)
          .maybeSingle();
        allowed = orderRow?.responsible_user_id === context.userId;
      }
      if (!allowed) {
        throw new Error("Завершить работу сектора может только его ответственный или руководство");
      }
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", data.order_id)
      .single();

    if (orderError || !order) throw new Error(orderError?.message || "Заказ не найден");

    const newAssignmentStatus = data.is_completed ? "completed" : "in_progress";
    await setAssignmentStatus(supabaseAdmin, {
      orderId: data.order_id,
      chatId: data.chat_id,
      status: newAssignmentStatus,
    });

    const workerName = (await getProfileName(supabaseAdmin, context.userId)) ?? "Сотрудник";
    const chatName = (await getChatName(supabaseAdmin, data.chat_id)) ?? "цех";
    const actionText = data.is_completed ? "завершил свою часть работы над заказом" : "вернул заказ в работу (в этом секторе)";

    await supabaseAdmin.from("messages").insert({
      chat_id: data.chat_id,
      is_ai: true,
      kind: "system",
      order_id: order.id,
      content: `🔄 **${workerName}** ${actionText} **${order.number}** (${chatName})`
    });

    // Все сектора завершили — заказ полностью выполнен
    const { data: allAssignments, error: allErr } = await supabaseAdmin
      .from("order_assignments")
      .select("status")
      .eq("order_id", data.order_id);

    let allCompleted = false;
    if (!allErr && allAssignments) {
      const active = allAssignments.filter(a => a.status !== "cancelled");
      allCompleted = active.length > 0 && active.every(a => a.status === "completed");
    } else if (data.is_completed) {
      // До миграции: единственный сектор == заказ
      allCompleted = true;
    }

    if (allCompleted) {
      await notifyOwners({ title: "Заказ полностью выполнен", body: `Заказ ${order.number} завершен всеми секторами`, link: `/dashboard`, kind: "status_change" });
    }

    await logAudit({ actor_user_id: context.userId, action: "order.sector_toggled", entity_type: "order", entity_id: data.order_id, details: { chat_id: data.chat_id, chat_name: chatName, is_completed: data.is_completed } });

    return { ok: true };
  });

// Owner/manager: переназначить ответственного за конкретный сектор
export const reassignAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    order_id: z.string().uuid(),
    chat_id: z.string().uuid(),
    user_id: z.string().uuid().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await getRole(context);
    if (role !== "owner" && role !== "manager") throw new Error("Forbidden: только руководство может переназначать ответственных");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit, notifyOwners } = await import("@/lib/audit.server");

    await reassignAssignmentResponsible(supabaseAdmin, {
      orderId: data.order_id,
      chatId: data.chat_id,
      userId: data.user_id,
    });

    const { data: order } = await supabaseAdmin.from("orders").select("number").eq("id", data.order_id).single();
    const workerName = data.user_id ? ((await getProfileName(supabaseAdmin, data.user_id)) ?? "Сотрудник") : null;
    const chatName = (await getChatName(supabaseAdmin, data.chat_id)) ?? "цех";

    await supabaseAdmin.from("messages").insert({
      chat_id: data.chat_id,
      is_ai: true,
      kind: "system",
      order_id: data.order_id,
      content: workerName
        ? `👤 Руководство назначило **${workerName}** ответственным за заказ **${order?.number ?? ""}** (${chatName})`
        : `👤 Руководство сняло ответственного с заказа **${order?.number ?? ""}** (${chatName}). Сектор снова ожидает принятия.`,
    });

    await logAudit({ actor_user_id: context.userId, action: "assignment.reassigned", entity_type: "order", entity_id: data.order_id, details: { chat_id: data.chat_id, chat_name: chatName, new_responsible: data.user_id, number: order?.number } });
    await notifyOwners({ title: "Переназначение ответственного", body: workerName ? `${workerName} теперь отвечает за заказ ${order?.number ?? ""} в секторе «${chatName}»` : `Заказ ${order?.number ?? ""} в секторе «${chatName}» снова свободен`, link: `/chats/${data.chat_id}`, kind: "status_change" });
    return { ok: true };
  });

// Owner: убрать сектор из заказа (assignment отменяется, история сохраняется)
export const removeAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    order_id: z.string().uuid(),
    chat_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");

    await setAssignmentStatus(supabaseAdmin, { orderId: data.order_id, chatId: data.chat_id, status: "cancelled" });

    const { data: order } = await supabaseAdmin.from("orders").select("number, dispatched_chat_ids").eq("id", data.order_id).single();
    if (order) {
      const remaining = ((order.dispatched_chat_ids as string[] | null) ?? []).filter((cid) => cid !== data.chat_id);
      await supabaseAdmin.from("orders").update({ dispatched_chat_ids: remaining }).eq("id", data.order_id);
    }
    const chatName = (await getChatName(supabaseAdmin, data.chat_id)) ?? "цех";

    await supabaseAdmin.from("messages").insert({
      chat_id: data.chat_id,
      is_ai: true,
      kind: "system",
      order_id: data.order_id,
      content: `🚫 Заказ **${order?.number ?? ""}** отменён для сектора «${chatName}» решением руководства.`,
    });

    await logAudit({ actor_user_id: context.userId, action: "assignment.removed", entity_type: "order", entity_id: data.order_id, details: { chat_id: data.chat_id, chat_name: chatName, number: order?.number } });
    return { ok: true };
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
    status: AssignmentStatusEnum.optional(),
    finish_date: z.string().nullable().optional(),
    comment: z.string().nullable().optional(),
    stage: z.string().optional(),
    priority: z.string().optional(),
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
    // Нативные колонки этапа и приоритета (приоритет относится к заказу в целом).
    // До миграции колонок нет — пишем только JSON-метаданные ниже.
    const { ordersHasNativeMeta } = await import("./assignments.server");
    if (data.stage !== undefined && (await ordersHasNativeMeta(supabaseAdmin))) updates.stage = data.stage;
    if (data.priority !== undefined && (await ordersHasNativeMeta(supabaseAdmin))) updates.priority = data.priority;
    if (data.responsible_user_id !== undefined) updates.responsible_user_id = data.responsible_user_id;
    if (data.chat_id !== undefined) updates.chat_id = data.chat_id;

    // Если пришли stage/priority — синхронизируем и JSON-метаданные в comment (legacy display)
    if (data.stage !== undefined || data.priority !== undefined) {
      const { data: current } = await supabaseAdmin.from("orders").select("comment").eq("id", data.order_id).single();
      updates.comment = buildOrderMetadata(
        { stage: data.stage as any, priority: data.priority as any },
        data.comment !== undefined ? data.comment : current?.comment
      );
    }

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
    const { ordersHasNativeMeta } = await import("./assignments.server");
    const nativeMeta = await ordersHasNativeMeta(supabaseAdmin);

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

      const row: any = {
        number: o.number,
        order_date: o.order_date || null,
        finish_date: o.finish_date || null,
        nomenclature: o.nomenclature,
        customer_order: o.customer_order || null,
        comment,
        created_by: context.userId,
        is_dispatched: false,
      };
      // До миграции нативных колонок нет — этап/приоритет остаются в JSON-метаданных
      if (nativeMeta) {
        row.stage = stage;
        row.priority = priority;
      }
      return row;
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

export const voiceDispatchOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    text: z.string().min(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { aiGenerateOrderCard } = await import("./orders.server");
    const { logAudit } = await import("@/lib/audit.server");

    const textLower = data.text.toLowerCase();

    // Fetch all non-dispatched orders
    const { data: undispatched } = await supabaseAdmin.from("orders").select("*").eq("is_dispatched", false);
    if (!undispatched || undispatched.length === 0) {
      return { ok: false, message: "Нет свободных нераспределённых заказов" };
    }

    // Try matching order by number or digits
    const digitsMatch = textLower.match(/\b\d+\b/);
    let targetOrder = undispatched.find(o => textLower.includes(o.number.toLowerCase()));
    if (!targetOrder && digitsMatch) {
      targetOrder = undispatched.find(o => o.number.includes(digitsMatch[0]));
    }
    if (!targetOrder) {
      targetOrder = undispatched[0];
    }

    // Fetch all active group chats
    const { data: chats } = await supabaseAdmin.from("chats").select("id, name").eq("is_dm", false);
    const matchedChatIds: string[] = [];
    const matchedChatNames: string[] = [];

    for (const c of chats ?? []) {
      const nameLower = c.name.toLowerCase();
      const tokens = nameLower.split(/[\s,._\-№#()]+/).filter(t => t.length >= 2);
      if (textLower.includes(nameLower) || tokens.some(t => textLower.includes(t))) {
        matchedChatIds.push(c.id);
        matchedChatNames.push(c.name);
      }
    }

    if (matchedChatIds.length === 0) {
      return {
        ok: false,
        message: `Заказ №${targetOrder.number} найден, но цеха не распознаны в фразе "${data.text}". Назовите цеха (например: Дерево, Ткань).`,
        orderNumber: targetOrder.number,
      };
    }

    // Dispatch order card to matched chats (merge with existing sectors)
    const orderInput = {
      number: targetOrder.number, order_date: targetOrder.order_date, finish_date: targetOrder.finish_date,
      nomenclature: targetOrder.nomenclature, customer_order: targetOrder.customer_order, comment: targetOrder.comment,
      chat_id: null, follow_up_interval_minutes: targetOrder.follow_up_interval_minutes,
    };
    const content = await aiGenerateOrderCard(orderInput);

    await dispatchOrderToChats(supabaseAdmin, { order: targetOrder, chatIds: matchedChatIds, cardContent: content });

    for (const cid of matchedChatIds) {
      await logAudit({ actor_user_id: context.userId, action: "message.ai_sent", entity_type: "message", entity_id: null, details: { chat_id: cid, kind: "order_card", order_id: targetOrder.id } });
    }

    await logAudit({ actor_user_id: context.userId, action: "order.dispatched", entity_type: "order", entity_id: targetOrder.id, details: { chat_ids: matchedChatIds, number: targetOrder.number, voice: true } });

    return {
      ok: true,
      message: `Заказ №${targetOrder.number} успешно распределен в цеха: ${matchedChatNames.join(", ")}`,
      orderNumber: targetOrder.number,
      chats: matchedChatNames,
    };
  });


// Server functions to load assignments bypassing RLS
// (RLS on order_assignments requires is_chat_member or is_owner, which may not be set up for all users)

export const loadAllAssignments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { assignmentsTableExists, synthesizeAssignments } = await import("./assignments.server");

    // До миграции синтезируем assignments из legacy-полей заказов
    if (!(await assignmentsTableExists(supabaseAdmin))) {
      const { data: orders } = await supabaseAdmin.from("orders").select("*");
      return (orders ?? []).flatMap((o: any) => synthesizeAssignments(o));
    }

    const { data } = await supabaseAdmin.from("order_assignments").select("*");
    return data ?? [];
  });

export const loadChatAssignments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    order_ids: z.array(z.string().uuid()),
    chat_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.order_ids.length === 0) return [];

    const { assignmentsTableExists, synthesizeAssignments } = await import("./assignments.server");
    if (!(await assignmentsTableExists(supabaseAdmin))) {
      const { data: orders } = await supabaseAdmin
        .from("orders")
        .select("*")
        .in("id", data.order_ids);
      return (orders ?? [])
        .flatMap((o: any) => synthesizeAssignments(o))
        .filter((a: any) => a.chat_id === data.chat_id);
    }

    const { data: assignments } = await supabaseAdmin
      .from("order_assignments")
      .select("order_id, status, responsible_user_id")
      .in("order_id", data.order_ids)
      .eq("chat_id", data.chat_id);
    return assignments ?? [];
  });
