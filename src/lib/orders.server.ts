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
  const key = process.env.ORDER_AI_KEY || process.env.LOVABLE_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
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

  // Fetch user profile
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("display_name, id")
    .eq("id", userId)
    .single();
  const userName = profile?.display_name ?? "Сотрудник";

  let reply = "";

  // 1. Primary Engine: Autonomous RAG Agent (executes real tool calls for send_chat_message, search_knowledge_base, etc.)
  try {
    const { RAGAgent } = await import("@/features/rag/agent");
    const agent = new RAGAgent();
    reply = await agent.run(`Сотрудник ${userName}: ${content}`);
  } catch (err) {
    console.warn("RAGAgent execution failed, falling back to legacy parser:", err);
  }

  // 2. Fallback if RAGAgent returns empty
  if (!reply) {
    reply = `Принято. Обработал запрос: "${content}".`;
  }

  // Determine target chat to save assistant conversation
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

  if (targetChatId) {
    // Check if user's question was already inserted
    const { data: lastMsg } = await supabaseAdmin
      .from("messages")
      .select("content")
      .eq("chat_id", targetChatId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastMsg?.content !== content) {
      await supabaseAdmin.from("messages").insert({
        chat_id: targetChatId, sender_user_id: userId, is_ai: false, content: content,
      });
    }

    // Save Nerva AI reply
    await supabaseAdmin.from("messages").insert({
      chat_id: targetChatId, is_ai: true, kind: "followup", content: reply,
    });
  }

  return { reply };
}

export async function triggerAiPollHelper(actorUserId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { logAudit, notifyOwners } = await import("@/lib/audit.server");

  // Get all active order assignments currently in progress or stalled
  const { data: activeAssigns } = await supabaseAdmin
    .from("order_assignments")
    .select("*, order:orders(*)")
    .in("status", ["in_progress", "stalled"])
    .order("last_update_at", { ascending: true });

  if (!activeAssigns || activeAssigns.length === 0) {
    return { ok: true, count: 0, message: "Нет активных заказов для опроса" };
  }

  // Fetch all profiles of responsible users
  const userIds = [...new Set(activeAssigns.map(a => a.responsible_user_id).filter(Boolean))] as string[];
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
  for (const assign of activeAssigns) {
    if (!assign.order) continue;
    const userName = assign.responsible_user_id ? (profileMap.get(assign.responsible_user_id) ?? "Сотрудник") : "Команда";
    const pollMessage = `[NERVA // POLL]: Запрос статуса по заказу №${assign.order.number}\n\n` +
      `Ответственный: ${userName}\n` +
      `Позиция: ${assign.order.nomenclature} (срок: ${assign.order.finish_date ?? "—"})\n\n` +
      `*Нажмите кнопку микрофона и надиктуйте короткий ответ или напишите сообщением — я сразу обновлю дашборд.*`;

    // Send to assignment chat and DM
    const userDmId = assign.responsible_user_id ? dmMap.get(assign.responsible_user_id) : null;
    const allDest = new Set([assign.chat_id, ...(userDmId ? [userDmId] : [])]);

    for (const cid of allDest) {
      await supabaseAdmin.from("messages").insert({
        chat_id: cid,
        is_ai: true,
        kind: "followup",
        order_id: assign.order.id,
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