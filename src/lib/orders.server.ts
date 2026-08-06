import { generateText } from "ai";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { parseOrderMetadata, buildOrderMetadata, OrderStage, OrderPriority } from "./order-metadata";

const ORDER_AI_MODEL = "google/gemini-3-flash-preview";

export type AppRole = "owner" | "manager" | "worker" | null;

export type OrderCardInput = {
  number: string;
  order_date?: string | null;
  finish_date?: string | null;
  nomenclature: string;
  customer_order?: string | null;
  comment?: string | null;
  chat_id?: string | null;
  follow_up_interval_minutes?: number;
};

export async function getRole(ctx: { supabase: any; userId: string }): Promise<AppRole> {
  const { data } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  return (data?.role ?? null) as AppRole;
}

export async function assertOwner(ctx: { supabase: any; userId: string }) {
  const role = await getRole(ctx);
  if (role !== "owner") throw new Error("Forbidden: owner only");
}

export function getTargetChats(order: { dispatched_chat_ids?: (string | null)[] | null; chat_id?: string | null }) {
  return Array.from(new Set([...(order.dispatched_chat_ids ?? []), order.chat_id].filter((id): id is string => typeof id === "string" && id.length > 0)));
}

export async function aiGenerateOrderCard(order: OrderCardInput) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return defaultCard(order);

  try {
    const gateway = createLovableAiGatewayProvider(key);
    const { text } = await generateText({
      model: gateway(ORDER_AI_MODEL),
      prompt: `Сформируй компактное, строгое, техническое сообщение для производственного терминала от имени NERVA AI (нервная система предприятия) о новом заказе. Используй markdown без эмодзи и смайликов. Поля:
Номер: ${order.number}
Дата: ${order.order_date ?? "—"}
Срок: ${order.finish_date ?? "—"}
Номенклатура: ${order.nomenclature}
Заказ покупателя: ${order.customer_order ?? "—"}
Комментарий: ${order.comment ?? "—"}
В начале добавь: «[NERVA // СИГНАЛ: НОВЫЙ ЗАКАЗ]»
В конце добавь призыв: «Кто берёт заказ в работу — нажмите кнопку ниже или надиктуйте ответ голосом Nerva».`,
    });
    return text.trim() || defaultCard(order);
  } catch (error) {
    console.error("AI order card failed", error);
    return defaultCard(order);
  }
}

export async function processDmReply(userId: string, content: string) {
  return processAiAssistantQuery(userId, content, null);
}

export async function processAiAssistantQuery(userId: string, content: string, chatId?: string | null) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { logAudit, notifyOwners } = await import("@/lib/audit.server");

  // Fetch user profile
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("display_name, id")
    .eq("id", userId)
    .single();
  const userName = profile?.display_name ?? "Сотрудник";

  // Fetch active orders for context
  const { data: allOrders } = await supabaseAdmin
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  const userOrders = (allOrders ?? []).filter(o => o.responsible_user_id === userId);

  const key = process.env.ORDER_AI_KEY || process.env.LOVABLE_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  let reply = "";
  let targetOrderToUpdate: any = null;
  
  // New target properties
  let targetStatus: any = null;
  let targetStage: OrderStage | null = null;
  let targetPriority: OrderPriority | null = null;
  let targetComment: string | null = null;
  let targetAssignee: string | null = null;
  
  let actionExecuted: string | null = null;

  // 1. EXTRACT DATA VIA REGEX FALLBACK
  const lower = content.toLowerCase().trim();
  const numMatch = content.match(/(?:№|заказ|нфос[- ]?)?\s*0*(\d+)/i);
  const targetNum = numMatch ? String(numMatch[1]) : null;

  // NLP: Stage detection
  if (/логистик/i.test(lower)) targetStage = "Логистика";
  else if (/производств/i.test(lower)) targetStage = "Производство";
  else if (/готов/i.test(lower)) targetStage = "Готово";
  else if (/нов(?:ый|ая)/i.test(lower)) targetStage = "Новый";

  // NLP: Priority detection
  if (/срочн/i.test(lower)) targetPriority = "Срочно";
  else if (/высок/i.test(lower)) targetPriority = "Высокий";
  else if (/средн/i.test(lower)) targetPriority = "Средний";
  else if (/обычн/i.test(lower)) targetPriority = "Обычный";

  // NLP: Map stage to existing DB status
  if (targetStage === "Новый") targetStatus = "new";
  else if (targetStage === "Производство" || targetStage === "Логистика") targetStatus = "in_progress";
  else if (targetStage === "Готово") targetStatus = "completed";

  // Match order
  let matchedOrder = targetNum ? (allOrders ?? []).find(o => o.number.endsWith(targetNum)) : null;

  // 2. LLM CALL (Optional, wrapped in graceful try/catch)
  if (key) {
    try {
      const gateway = createLovableAiGatewayProvider(key);
      const ordersContext = (allOrders ?? []).filter(o => o.status !== 'completed').slice(0, 10).map(o => 
        `[ID: ${o.id} | №${o.number} | Статус: ${o.status} | Номенклатура: "${o.nomenclature}"]`
      ).join("\n");

      const prompt = `Сотрудник (${userName}) говорит: "${content}".
Заказы: ${ordersContext || "Нет"}

Определи:
- action: create_order, update_order, stats, reply_only
- reply: Твой ответ
- update_params: order_id, new_stage (Новый, Производство, Логистика, Готово), new_priority (Срочно, Высокий, Средний, Обычный), comment, new_status (new, in_progress, stalled, completed)

Верни JSON.`;

      const { text } = await generateText({
        model: gateway(ORDER_AI_MODEL),
        prompt,
      });

      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.reply) reply = parsed.reply.trim();
        
        if (parsed.action === "update_order" && parsed.update_params) {
           targetOrderToUpdate = (allOrders ?? []).find(o => o.id === parsed.update_params.order_id) || matchedOrder;
           if (parsed.update_params.new_stage) targetStage = parsed.update_params.new_stage;
           if (parsed.update_params.new_priority) targetPriority = parsed.update_params.new_priority;
           if (parsed.update_params.new_status) targetStatus = parsed.update_params.new_status;
           if (parsed.update_params.comment) targetComment = parsed.update_params.comment;
           actionExecuted = "update_order";
        }
      }
    } catch (err) {
      console.warn("LLM API fallback to internal NLP engine", err);
      // Fallback response handled below
    }
  }

  // 3. FALLBACK ENGINE IF NO ACTION WAS DETERMINED
  if (!actionExecuted || !reply) {
    if (targetStage || targetPriority || /проблем|задерж/i.test(lower) || /в\s*работу/i.test(lower)) {
      if (matchedOrder) {
        targetOrderToUpdate = matchedOrder;
        targetComment = content;
        
        const updates = [];
        if (targetStage) updates.push(`этап [${targetStage}]`);
        if (targetPriority) updates.push(`приоритет [${targetPriority}]`);
        
        reply = `[NERVA]: Заказ №${matchedOrder.number} обновлен. ${updates.join(', ')}`;
        actionExecuted = "update_order";
      } else {
        reply = `[NERVA]: Я понял параметры изменения, но не смог найти указанный номер заказа.`;
      }
    } else {
      reply = `[NERVA]: Команда принята, но я не распознал точный номер заказа или параметры. Пожалуйста, повторите (Например: "Заказ 96 на производство, срочно").`;
    }
  }

  // 4. PERFORM DATABASE MUTATION
  if (targetOrderToUpdate && actionExecuted === "update_order") {
    let finalStatus = targetStatus ?? targetOrderToUpdate.status;
    let newMetaStr = targetOrderToUpdate.comment;
    
    if (finalStatus === "completed" && chatId) {
      const targetChats = getTargetChats(targetOrderToUpdate);
      if (targetChats.includes(chatId)) {
        const { parseOrderMetadata } = await import("./order-metadata");
        const meta = parseOrderMetadata(targetOrderToUpdate.comment);
        const sectors = meta.completed_sectors || {};
        sectors[chatId] = true;
        
        const allCompleted = targetChats.every(cid => sectors[cid] === true);
        if (!allCompleted) {
           finalStatus = "in_progress";
           reply += `\n[NERVA]: Сектор отмечен выполненным. Ожидаем другие сектора.`;
        } else {
           reply += `\n[NERVA]: Все сектора завершили работу! Заказ полностью выполнен.`;
        }
        
        newMetaStr = buildOrderMetadata({
          stage: targetStage ?? undefined,
          priority: targetPriority ?? undefined,
          comment: targetComment ?? undefined,
          completed_sectors: sectors,
        }, targetOrderToUpdate.comment);
      } else {
        newMetaStr = buildOrderMetadata({ stage: targetStage ?? undefined, priority: targetPriority ?? undefined, comment: targetComment ?? undefined }, targetOrderToUpdate.comment);
      }
    } else {
      newMetaStr = buildOrderMetadata({ stage: targetStage ?? undefined, priority: targetPriority ?? undefined, comment: targetComment ?? undefined }, targetOrderToUpdate.comment);
    }

    const { error } = await supabaseAdmin
      .from("orders")
      .update({
        status: finalStatus,
        comment: newMetaStr,
        last_update_at: new Date().toISOString(),
      })
      .eq("id", targetOrderToUpdate.id);

    if (error) {
       console.error("Failed to update order in DB", error);
       reply = `[NERVA]: Ошибка сохранения статуса в базе данных.`;
    }
  }

  // Determine target chat to send Nerva reply and user query
  let targetChatId = chatId;
  if (!targetChatId) {
    const { data: dm } = await supabaseAdmin
      .from("chats")
      .select("id")
      .eq("is_dm", true)
      .eq("dm_user_id", userId)
      .maybeSingle();
    targetChatId = dm?.id;
  }

  // GUARANTEED CHAT UPDATE (Graceful Fallback)
  if (targetChatId) {
    // 1. Сохраняем запрос пользователя
    await supabaseAdmin.from("messages").insert({
      chat_id: targetChatId, sender_user_id: userId, is_ai: false, content: content,
    });

    // 2. Сохраняем ответ Nerva AI
    await supabaseAdmin.from("messages").insert({
      chat_id: targetChatId, is_ai: true, kind: "followup", order_id: targetOrderToUpdate?.id ?? null, content: reply,
    });
  }

  return { reply, updatedOrder: targetOrderToUpdate?.number, status: targetStatus };
}

export async function triggerAiPollHelper(actorUserId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { logAudit, notifyOwners } = await import("@/lib/audit.server");

  // Get all active orders currently in progress or stalled
  const { data: activeOrders } = await supabaseAdmin
    .from("orders")
    .select("*")
    .in("status", ["in_progress", "stalled"])
    .order("last_update_at", { ascending: true });

  if (!activeOrders || activeOrders.length === 0) {
    return { ok: true, count: 0, message: "Нет активных заказов для опроса" };
  }

  // Fetch all profiles of responsible users
  const userIds = [...new Set(activeOrders.map(o => o.responsible_user_id).filter(Boolean))] as string[];
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);
  const profileMap = new Map((profiles ?? []).map(p => [p.id, p.display_name]));

  // Fetch all DMs of responsible users
  const { data: dms } = await supabaseAdmin
    .from("chats")
    .select("id, dm_user_id")
    .eq("is_dm", true)
    .in("dm_user_id", userIds);
  const dmMap = new Map((dms ?? []).map(d => [d.dm_user_id, d.id]));

  let pollCount = 0;
  for (const order of activeOrders) {
    const userName = order.responsible_user_id ? (profileMap.get(order.responsible_user_id) ?? "Сотрудник") : "Команда";
    const pollMessage = `[NERVA // POLL]: Запрос статуса по заказу №${order.number}\n\n` +
      `Ответственный: ${userName}\n` +
      `Позиция: ${order.nomenclature} (срок: ${order.finish_date ?? "—"})\n\n` +
      `*Нажмите кнопку микрофона и надиктуйте короткий ответ или напишите сообщением — я сразу обновлю дашборд.*`;

    // Send to target chats or DM
    const targetChats = getTargetChats(order);
    const userDmId = order.responsible_user_id ? dmMap.get(order.responsible_user_id) : null;
    const allDest = new Set([...targetChats, ...(userDmId ? [userDmId] : [])]);

    for (const cid of allDest) {
      await supabaseAdmin.from("messages").insert({
        chat_id: cid,
        is_ai: true,
        kind: "followup",
        order_id: order.id,
        content: pollMessage,
      });
    }
    pollCount++;
  }

  await logAudit({ actor_user_id: actorUserId, action: "ai.poll_triggered", entity_type: "system", entity_id: null, details: { count: pollCount } });
  await notifyOwners({ title: "[NERVA]: Запущен опрос сотрудников", body: `Разослано запросов по ${pollCount} заказам в работе.`, kind: "status_change" });

  return { ok: true, count: pollCount, message: `Опрошено сотрудников по ${pollCount} заказам` };
}

function defaultCard(order: OrderCardInput) {
  return `[NERVA // СИГНАЛ: НОВЫЙ ЗАКАЗ №${order.number}]\n\n` +
    `Дата: ${order.order_date ?? "—"}\n` +
    `Срок: ${order.finish_date ?? "—"}\n` +
    `Номенклатура: ${order.nomenclature}\n` +
    (order.customer_order ? `Заказ: ${order.customer_order}\n` : "") +
    (order.comment ? `Комментарий: ${order.comment}\n` : "") +
    `\nКто берёт в работу — нажмите кнопку ниже или ответьте голосом Nerva.`;
}

async function sendGeneralAiDmReply(userId: string, content: string) {
  return processAiAssistantQuery(userId, content, null);
}