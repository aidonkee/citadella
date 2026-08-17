// =============================================================================
// NERVA multi-sector assignment engine.
//
// Единый источник бизнес-логики для server functions и AI-инструментов.
//
// Главное правило архитектуры:
//   НЕ  Order -> responsible_user
//   А   Order -> OrderAssignment -> Sector(chat) -> Responsible Worker -> Status
//
// Принятие заказа одним сектором НИКОГДА не блокирует остальные сектора:
// claim меняет только СВОЙ order_assignment и не трогает чужие.
// =============================================================================

export type AssignmentStatus =
  | "new"          // PENDING — ожидает принятия сектором
  | "in_progress"  // сектор работает
  | "stalled"      // проблема / завис
  | "blocked"      // заблокирован
  | "completed"    // сектор завершил свою часть
  | "cancelled"    // назначение отменено
  | "overdue";     // legacy

export const ASSIGNMENT_STATUSES: AssignmentStatus[] = [
  "new", "in_progress", "stalled", "blocked", "completed", "cancelled", "overdue",
];

type Sb = any;

// ---------------------------------------------------------------------------
// Graceful degradation: пока миграция (order_assignments) не применена к БД,
// движок работает по legacy-схеме (один ответственный на заказ).
// Как только таблица появится — автоматически включается мультисекторная логика.
// ---------------------------------------------------------------------------
let _assignmentsTableExists: boolean | null = null;

export async function assignmentsTableExists(sb: Sb): Promise<boolean> {
  if (_assignmentsTableExists !== null) return _assignmentsTableExists;
  try {
    const { error } = await sb.from("order_assignments").select("id").limit(1);
    _assignmentsTableExists = !error;
  } catch {
    _assignmentsTableExists = false;
  }
  return _assignmentsTableExists;
}

// Нативные колонки orders.stage / orders.priority появились в миграции 20260818.
// До неё stage/priority живут только в JSON-метаданных comment.
let _ordersHasNativeMeta: boolean | null = null;

export async function ordersHasNativeMeta(sb: Sb): Promise<boolean> {
  if (_ordersHasNativeMeta !== null) return _ordersHasNativeMeta;
  try {
    const { error } = await sb.from("orders").select("stage").limit(1);
    _ordersHasNativeMeta = !error;
  } catch {
    _ordersHasNativeMeta = false;
  }
  return _ordersHasNativeMeta;
}

// Синтетические assignments из legacy-полей заказа (dispatched_chat_ids /
// chat_id / responsible_user_id). Используется дашбордом и AI до миграции.
export function synthesizeAssignments(order: any): any[] {
  if (!order) return [];
  const sectors: string[] = [];
  if (Array.isArray(order.dispatched_chat_ids)) sectors.push(...order.dispatched_chat_ids);
  if (order.chat_id) sectors.push(order.chat_id);
  const unique = Array.from(new Set(sectors.filter(Boolean)));
  const ts = order.last_update_at ?? order.updated_at ?? order.created_at ?? new Date().toISOString();
  return unique.map((cid, i) => ({
    id: `${order.id}:${cid}`,
    order_id: order.id,
    chat_id: cid,
    responsible_user_id: order.responsible_user_id ?? null,
    status: order.status ?? "new",
    order_index: i,
    started_at: order.responsible_user_id ? ts : null,
    completed_at: order.status === "completed" ? ts : null,
    created_at: ts,
    updated_at: ts,
  }));
}

// ---------------------------------------------------------------------------
// Синхронизация глобального статуса заказа из статусов его assignments.
// Правила (зеркало SQL-функции sync_order_status_from_assignments):
//   - все активные COMPLETED                 -> completed
//   - все assignments CANCELLED              -> cancelled
//   - есть BLOCKED/STALLED среди активных    -> stalled
//   - все активные NEW                       -> distributed
//   - иначе                                  -> in_progress
// 'cancelled' и 'overdue' у заказа автоматически не затираются.
// ---------------------------------------------------------------------------
export async function syncOrderStatusWithAssignments(sb: Sb, orderId: string) {
  // До миграции нечего синхронизировать — статус заказа и так легитимный.
  if (!(await assignmentsTableExists(sb))) return;
  // Основной путь — SQL-функция (та же логика висит на триггере).
  const { error } = await sb.rpc("sync_order_status_from_assignments", { p_order_id: orderId });
  if (!error) return;

  // Fallback на чистый TS, если функция ещё не развёрнута в БД.
  const { data: assignments } = await sb
    .from("order_assignments")
    .select("status")
    .eq("order_id", orderId);
  if (!assignments || assignments.length === 0) return;

  const { data: orderRow } = await sb.from("orders").select("status").eq("id", orderId).maybeSingle();
  const current = orderRow?.status as string | undefined;

  const statuses = assignments.map((a: any) => a.status as string);
  const active = statuses.filter((s: string) => s !== "cancelled");

  let next: string;
  if (active.length === 0) next = "cancelled";
  else if (active.every((s: string) => s === "completed")) next = "completed";
  else if (active.some((s: string) => s === "blocked" || s === "stalled")) next = "stalled";
  else if (active.every((s: string) => s === "new")) next = "distributed";
  else next = "in_progress";

  if (current === "cancelled" && next !== "cancelled") return;
  if (current === "overdue" && next !== "completed" && next !== "cancelled") return;
  if (current === next) return;

  await sb.from("orders").update({
    status: next,
    last_update_at: new Date().toISOString(),
  }).eq("id", orderId);
}

// ---------------------------------------------------------------------------
// Принятие заказа сектором ("Взять в работу").
// НИКОГДА не создаёт глобальный lock на заказ:
// меняется только assignment (order_id, chat_id) этого сектора.
// Полный цикл: данные -> системное сообщение в чат сектора -> ЛС работнику ->
// уведомление владельцу. Остальные сектора не затрагиваются.
// ---------------------------------------------------------------------------
export async function claimAssignment(sb: Sb, args: {
  orderId: string;
  chatId: string;
  userId: string;
  confirmedByManager?: boolean;
}) {
  const { orderId, chatId, userId, confirmedByManager } = args;
  const { logAudit, notifyOwners } = await import("@/lib/audit.server");

  const { data: order } = await sb.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) throw new Error("Заказ не найден");
  if (order.status === "cancelled") throw new Error("Заказ отменён");
  if (order.status === "completed") throw new Error("Заказ полностью выполнен — брать его в работу нельзя");

  // LEGACY (до миграции): один ответственный на весь заказ
  if (!(await assignmentsTableExists(sb))) {
    if (order.responsible_user_id && order.responsible_user_id !== userId) {
      throw new Error("Заказ уже взят в работу другим сотрудником");
    }
    const now = new Date().toISOString();
    const next = new Date(Date.now() + (order.follow_up_interval_minutes ?? 120) * 60 * 1000).toISOString();
    const { error: orderErr } = await sb.from("orders").update({
      responsible_user_id: userId,
      status: "in_progress",
      last_update_at: now,
      next_follow_up_at: next,
    }).eq("id", orderId);
    if (orderErr) throw new Error(orderErr.message);

    const workerName = (await getProfileName(sb, userId)) ?? "Сотрудник";
    const chatName = (await getChatName(sb, chatId)) ?? "цех";
    const suffix = confirmedByManager ? " (утверждено руководителем)" : "";
    await sb.from("messages").insert({
      chat_id: chatId, is_ai: true, kind: "system", order_id: orderId,
      content: `✅ Заказ **${order.number}** взял в работу **${workerName}** (${chatName})${suffix}`,
    });
    const { data: dm } = await sb.from("chats").select("id").eq("is_dm", true).eq("dm_user_id", userId).maybeSingle();
    if (dm) {
      await sb.from("messages").insert({
        chat_id: dm.id, is_ai: true, kind: "followup", order_id: orderId,
        content: `Привет! Ты взял в работу заказ **${order.number}** (${order.nomenclature}) в секторе «${chatName}». Напиши коротко — на какой стадии? Я буду уточнять каждые ${order.follow_up_interval_minutes} мин.`,
      });
    }
    await notifyOwners({ title: "Заказ взят в работу", body: `${workerName} взял заказ ${order.number} в секторе «${chatName}»`, link: `/chats/${chatId}`, kind: "status_change" });
    return { ok: true, alreadyMine: order.responsible_user_id === userId, order, workerName, chatName };
  }

  const { data: existing } = await sb
    .from("order_assignments")
    .select("id, responsible_user_id, status")
    .eq("order_id", orderId)
    .eq("chat_id", chatId)
    .maybeSingle();

  // Заказ можно взять только в том секторе, куда он РАСПРЕДЕЛЁН.
  // Без проверки работник мог бы создавать назначения в любом чате (эскалация).
  if (!existing) {
    const inLegacySectors =
      order.chat_id === chatId ||
      (Array.isArray(order.dispatched_chat_ids) && order.dispatched_chat_ids.includes(chatId));
    if (!inLegacySectors) {
      throw new Error("Заказ не распределён в этот цех — взять его здесь нельзя");
    }
  }

  if (existing?.responsible_user_id) {
    if (existing.responsible_user_id === userId) return { ok: true, alreadyMine: true, order };
    throw new Error("Заказ в этом цехе уже взят в работу другим сотрудником");
  }

  const now = new Date().toISOString();

  // Отклик (история) — per (order, chat), больше никакого глобального уникального lock.
  try {
    await sb.from("order_claims").upsert({
      order_id: orderId,
      chat_id: chatId,
      user_id: userId,
      status: "confirmed",
    }, { onConflict: "order_id,chat_id" });
  } catch (e) {
    console.warn("order_claims upsert warning:", e);
  }

  // Ядро: назначаем ответственным только в ЭТОМ секторе.
  const { error: assignErr } = await sb.from("order_assignments").upsert({
    order_id: orderId,
    chat_id: chatId,
    responsible_user_id: userId,
    status: "in_progress",
    started_at: now,
    completed_at: null,
  }, { onConflict: "order_id,chat_id" });
  if (assignErr) throw new Error(assignErr.message);

  // Планирование follow-up — метаданные заказа, не блокировка.
  const next = new Date(Date.now() + (order.follow_up_interval_minutes ?? 120) * 60 * 1000).toISOString();
  await sb.from("orders").update({ last_update_at: now, next_follow_up_at: next }).eq("id", orderId);

  await syncOrderStatusWithAssignments(sb, orderId);

  // --- Сообщения и уведомления (только этот сектор) ---
  const workerName = (await getProfileName(sb, userId)) ?? "Сотрудник";
  const chatName = (await getChatName(sb, chatId)) ?? "цех";
  const suffix = confirmedByManager ? " (утверждено руководителем)" : "";

  await sb.from("messages").insert({
    chat_id: chatId, is_ai: true, kind: "system", order_id: orderId,
    content: `✅ Заказ **${order.number}** взял в работу **${workerName}** (${chatName})${suffix}`,
  });

  const { data: dm } = await sb.from("chats").select("id").eq("is_dm", true).eq("dm_user_id", userId).maybeSingle();
  if (dm) {
    await sb.from("messages").insert({
      chat_id: dm.id, is_ai: true, kind: "followup", order_id: orderId,
      content: `Привет! Ты взял в работу заказ **${order.number}** (${order.nomenclature}) в секторе «${chatName}». Напиши коротко — на какой стадии? Я буду уточнять каждые ${order.follow_up_interval_minutes} мин.`,
    });
  }

  await notifyOwners({
    title: "Заказ взят в работу",
    body: `${workerName} взял заказ ${order.number} в секторе «${chatName}»`,
    link: `/chats/${chatId}`,
    kind: "status_change",
  });

  return { ok: true, alreadyMine: false, order, workerName, chatName };
}

// ---------------------------------------------------------------------------
// Смена статуса одного assignment. Меняет ТОЛЬКО свой сектор.
// ---------------------------------------------------------------------------
export async function setAssignmentStatus(sb: Sb, args: {
  orderId: string;
  chatId: string;
  status: AssignmentStatus;
}) {
  const { orderId, chatId, status } = args;
  if (!ASSIGNMENT_STATUSES.includes(status)) throw new Error(`Недопустимый статус: ${status}`);

  const now = new Date().toISOString();

  // LEGACY (до миграции): статус сектора == статус заказа
  if (!(await assignmentsTableExists(sb))) {
    const { data: order } = await sb.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (!order) throw new Error("Заказ не найден");
    const inThisChat = order.chat_id === chatId || (Array.isArray(order.dispatched_chat_ids) && order.dispatched_chat_ids.includes(chatId));
    if (!inThisChat) throw new Error("Заказ не назначен в этот цех");

    const legacyMap: Record<string, string> = {
      completed: "completed",
      stalled: "stalled",
      blocked: "stalled",
      in_progress: "in_progress",
      new: "new",
      cancelled: "cancelled",
    };
    const { error } = await sb.from("orders").update({
      status: legacyMap[status] ?? order.status,
      last_update_at: now,
      ...(status === "completed" ? {} : {}),
    }).eq("id", orderId);
    if (error) throw new Error(error.message);
    return { ok: true, prevStatus: order.status ?? null };
  }

  const patch: Record<string, any> = { status };
  if (status === "completed") patch.completed_at = now;
  else patch.completed_at = null;
  if (status === "in_progress") patch.started_at = now;
  if (status === "new") { patch.started_at = null; patch.completed_at = null; }

  const { data: prev } = await sb
    .from("order_assignments")
    .select("status")
    .eq("order_id", orderId)
    .eq("chat_id", chatId)
    .maybeSingle();

  const { error } = await sb
    .from("order_assignments")
    .update(patch)
    .eq("order_id", orderId)
    .eq("chat_id", chatId);
  if (error) throw new Error(error.message);

  await syncOrderStatusWithAssignments(sb, orderId);

  return { ok: true, prevStatus: prev?.status ?? null };
}

// ---------------------------------------------------------------------------
// Переназначить ответственного за сектор (owner/manager).
// ---------------------------------------------------------------------------
export async function reassignAssignmentResponsible(sb: Sb, args: {
  orderId: string;
  chatId: string;
  userId: string | null;
}) {
  const { orderId, chatId, userId } = args;
  const now = new Date().toISOString();

  // LEGACY (до миграции): переназначение единственного ответственного
  if (!(await assignmentsTableExists(sb))) {
    const patch: Record<string, any> = {
      responsible_user_id: userId,
      last_update_at: now,
    };
    if (userId) patch.status = "in_progress";
    else patch.status = "new";
    const { error } = await sb.from("orders").update(patch).eq("id", orderId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  const patch: Record<string, any> = { responsible_user_id: userId };
  if (userId) {
    patch.status = "in_progress";
    patch.started_at = now;
    patch.completed_at = null;
  } else {
    patch.status = "new";
    patch.started_at = null;
    patch.completed_at = null;
  }

  const { error } = await sb
    .from("order_assignments")
    .update(patch)
    .eq("order_id", orderId)
    .eq("chat_id", chatId);
  if (error) throw new Error(error.message);

  await syncOrderStatusWithAssignments(sb, orderId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Распределение заказа в сектора.
// Сливается с существующими назначениями (merge, а не overwrite):
// старые сектора и их ответственные сохраняются.
// ---------------------------------------------------------------------------
export async function dispatchOrderToChats(sb: Sb, args: {
  order: any;
  chatIds: string[];
  cardContent: string;
}) {
  const { order, chatIds, cardContent } = args;

  // До миграции таблицы нет — сектора берём из dispatched_chat_ids заказа
  let existingAssign: any[] = [];
  const { data: oaData, error: oaError } = await sb
    .from("order_assignments")
    .select("chat_id, order_index")
    .eq("order_id", order.id);
  if (!oaError) {
    existingAssign = oaData ?? [];
  } else {
    existingAssign = (Array.isArray(order.dispatched_chat_ids) ? order.dispatched_chat_ids : []).map((cid: string, i: number) => ({ chat_id: cid, order_index: i }));
  }
  const existingChats = new Set(existingAssign.map((a: any) => a.chat_id as string));
  const maxIndex = (existingAssign ?? []).reduce((m: number, a: any) => Math.max(m, a.order_index ?? 0), -1);

  const newChatIds = chatIds.filter((cid) => !existingChats.has(cid));

  // Карточки заказа — только в чаты, где его ещё нет
  let firstMsgId: string | null = null;
  for (const cid of newChatIds) {
    const { data: m, error: msgError } = await sb.from("messages").insert({
      chat_id: cid, is_ai: true, content: cardContent, order_id: order.id, kind: "order_card",
    }).select().single();
    if (msgError) throw new Error(msgError.message);
    if (!firstMsgId) firstMsgId = m?.id ?? null;
  }

  // Новые assignments со сквозным порядковым индексом (подготовка к workflow).
  // До миграции таблицы нет — просто пропускаем (сектора живут в dispatched_chat_ids).
  if (newChatIds.length && (await assignmentsTableExists(sb))) {
    const rows = newChatIds.map((cid, i) => ({
      order_id: order.id,
      chat_id: cid,
      status: "new" as const,
      order_index: maxIndex + 1 + i,
    }));
    await sb.from("order_assignments").upsert(rows, { onConflict: "order_id,chat_id", ignoreDuplicates: true });
  }

  const mergedChatIds = Array.from(new Set([
    ...((order.dispatched_chat_ids as string[] | null) ?? []),
    ...chatIds,
  ]));

  const orderPatch: Record<string, any> = {
    is_dispatched: true,
    dispatched_at: order.dispatched_at ?? new Date().toISOString(),
    dispatched_chat_ids: mergedChatIds,
  };
  if (firstMsgId) orderPatch.ai_message_id = firstMsgId;
  // Если заказ был совсем новый — после раздачи он "распределён"
  // (до миграции статуса 'distributed' нет — оставляем 'new')
  if (order.status === "new" && (await assignmentsTableExists(sb))) orderPatch.status = "distributed";

  const { error: updateError } = await sb.from("orders").update(orderPatch).eq("id", order.id);
  if (updateError) throw new Error(updateError.message);

  await syncOrderStatusWithAssignments(sb, order.id);

  return { ok: true, added: newChatIds, total: mergedChatIds.length };
}

// ---------------------------------------------------------------------------
// Вспомогательные поиски (используются и UI-функциями, и AI-инструментами)
// ---------------------------------------------------------------------------
export async function findOrderByNumber(sb: Sb, numberRaw: string) {
  const numStr = String(numberRaw).trim().replace(/^№/, "");
  const { data: exact } = await sb.from("orders").select("*").eq("number", numStr).maybeSingle();
  if (exact) return exact;
  const { data: list } = await sb.from("orders").select("*").ilike("number", `%${numStr}%`).order("created_at", { ascending: false }).limit(1);
  return list?.[0] ?? null;
}

export async function findChatByName(sb: Sb, nameRaw: string) {
  const clean = String(nameRaw).trim();
  if (!clean) return null;
  const { data: found } = await sb.from("chats").select("id, name, is_dm").ilike("name", `%${clean}%`).eq("is_dm", false).limit(1).maybeSingle();
  if (found) return found;
  const { data: all } = await sb.from("chats").select("id, name, is_dm").eq("is_dm", false);
  return (all ?? []).find((c: any) =>
    c.name.toLowerCase().includes(clean.toLowerCase()) || clean.toLowerCase().includes(c.name.toLowerCase())
  ) ?? null;
}

export async function findWorkerByName(sb: Sb, nameRaw: string) {
  const clean = String(nameRaw).trim();
  if (!clean) return null;
  const { data } = await sb.from("profiles").select("id, display_name, username").or(
    `display_name.ilike.%${clean}%,username.ilike.%${clean}%`
  ).limit(5);
  if (!data?.length) return null;
  return data.find((p: any) => p.display_name?.toLowerCase() === clean.toLowerCase()) ?? data[0];
}

export async function getProfileName(sb: Sb, userId: string | null | undefined) {
  if (!userId) return null;
  const { data } = await sb.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return data?.display_name ?? null;
}

export async function getChatName(sb: Sb, chatId: string | null | undefined) {
  if (!chatId) return null;
  const { data } = await sb.from("chats").select("name").eq("id", chatId).maybeSingle();
  return data?.name ?? null;
}
