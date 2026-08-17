import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { searchVectorStore } from "./vector-store";
import { FunctionDeclaration, SchemaType } from "@google/generative-ai";
import {
  claimAssignment,
  setAssignmentStatus,
  reassignAssignmentResponsible,
  dispatchOrderToChats,
  findOrderByNumber,
  findChatByName,
  findWorkerByName,
  getProfileName,
  getChatName,
  syncOrderStatusWithAssignments,
  type AssignmentStatus,
} from "@/lib/assignments.server";
import { buildOrderMetadata } from "@/lib/order-metadata";

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://nngbqrfatvpxwxoljihv.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  return createClient(url, key, { realtime: { transport: ws as any } });
}

export type ToolContext = {
  userId?: string;
  userRole?: string;
  affectedOrders?: Set<string>;
};

const canManage = (ctx?: ToolContext) => ctx?.userRole === "owner" || ctx?.userRole === "manager";
const isOwner = (ctx?: ToolContext) => ctx?.userRole === "owner";

export const agentTools: FunctionDeclaration[] = [
  {
    name: "search_knowledge_base",
    description: "Search the internal knowledge base for regulations, responsibilities, or instructions.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: "The search query (e.g., 'Кто отвечает за заказ НФОС-00096?').",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_chats",
    description: "List all existing chats and production workshops in the system to find their names and IDs.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: "list_workers",
    description: "List all workers and their roles (owner/manager/worker) to find a worker by name.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: "list_orders",
    description: "List orders with their current overall status and per-sector progress. Optionally filter by status.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        status_filter: {
          type: SchemaType.STRING,
          description: "Optional filter: new, distributed, in_progress, stalled, overdue, completed, cancelled.",
        },
        limit: {
          type: SchemaType.NUMBER,
          description: "Maximum number of orders to return (default 20).",
        },
      },
    },
  },
  {
    name: "get_latest_order_status",
    description: "Fetch the latest real-time status and details of an order, including per-sector breakdown.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        order_number: {
          type: SchemaType.STRING,
          description: "The order number (e.g., 'НФОС-00096' or '1' or '8926986424').",
        },
      },
      required: ["order_number"],
    },
  },
  {
    name: "get_order_assignments",
    description: "Get detailed per-sector (workshop) assignment breakdown of an order: who is responsible, status, started/completed timestamps.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        order_number: {
          type: SchemaType.STRING,
          description: "The order number.",
        },
      },
      required: ["order_number"],
    },
  },
  {
    name: "create_new_order",
    description: "Create a new production order and optionally dispatch it to workshops immediately. (Owner and Manager only).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        number: { type: SchemaType.STRING, description: "The order number (e.g. '228')." },
        nomenclature: { type: SchemaType.STRING, description: "Nomenclature or product description." },
        finish_date: { type: SchemaType.STRING, description: "Optional deadline date YYYY-MM-DD." },
        customer_order: { type: SchemaType.STRING, description: "Optional customer order ref." },
        comment: { type: SchemaType.STRING, description: "Optional additional comment." },
        stage: { type: SchemaType.STRING, description: "Optional stage: Новый, Производство, Логистика, Готово." },
        priority: { type: SchemaType.STRING, description: "Optional priority: Обычный, Средний, Высокий, Срочно." },
        chat_names: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: "Optional list of workshop names to dispatch the order to immediately (e.g. ['цех 1', 'цех 2']).",
        },
      },
      required: ["number", "nomenclature"],
    },
  },
  {
    name: "dispatch_order_to_chats",
    description: "Dispatch an order to workshop chats (e.g. 'цех 1', 'цех 2', 'Сборка') so workers see the order card and can claim it. Existing sectors are preserved (merge). (Owner and Manager only).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        order_number: { type: SchemaType.STRING, description: "The order number to dispatch (e.g. '228' or '№228')." },
        chat_names: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: "List of target workshop chat names to dispatch to (e.g. ['цех 1', 'цех 2']).",
        },
      },
      required: ["order_number", "chat_names"],
    },
  },
  {
    name: "claim_order_by_worker",
    description: "Worker claims/accepts an order to start working on it in THEIR OWN workshop sector. The claim affects only that sector — other workshops are untouched. Status updates to in_progress on the dashboard immediately.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        order_number: { type: SchemaType.STRING, description: "The order number (e.g. '44' or '№44')." },
        chat_name: { type: SchemaType.STRING, description: "Optional workshop name (e.g. 'Сборка'). If omitted, the worker's own sector is used." },
      },
      required: ["order_number"],
    },
  },
  {
    name: "update_sector_task_status",
    description: "Update the status of a specific sector/workshop task for an order (completed / in_progress / stalled / blocked / new). Only that sector is changed; the overall order status is re-synced automatically.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        order_number: { type: SchemaType.STRING, description: "The order number." },
        status: {
          type: SchemaType.STRING,
          description: "New status: 'completed' (Сделано), 'in_progress' (В работе), 'stalled' (Проблема), 'blocked' (Заблокирован), 'new' (Вернуть в ожидание).",
        },
        chat_name: { type: SchemaType.STRING, description: "Optional workshop name. If omitted, the worker's own sector is used." },
        reason: { type: SchemaType.STRING, description: "Optional short reason when marking stalled/blocked (e.g. 'нет материала')." },
      },
      required: ["order_number", "status"],
    },
  },
  {
    name: "update_task_stage",
    description: "Update the stage (Новый/Производство/Логистика/Готово) and/or priority (Обычный/Средний/Высокий/Срочно) of an order.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        order_number: { type: SchemaType.STRING, description: "The order number." },
        stage: { type: SchemaType.STRING, description: "New stage name." },
        priority: { type: SchemaType.STRING, description: "New priority." },
      },
      required: ["order_number"],
    },
  },
  {
    name: "set_assignment_responsible",
    description: "Assign or change the responsible worker for a specific workshop sector of an order. (Owner and Manager only).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        order_number: { type: SchemaType.STRING, description: "The order number." },
        chat_name: { type: SchemaType.STRING, description: "Workshop name (e.g. 'Сборка')." },
        worker_name: { type: SchemaType.STRING, description: "Worker's name to assign. Use null/empty to unassign." },
      },
      required: ["order_number", "chat_name", "worker_name"],
    },
  },
  {
    name: "send_chat_message",
    description: "Send a message into a chat/workshop by chat_name (e.g., 'цех 2', 'Сборка') or chat_id. Workers can only message chats they belong to.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        chat_name: { type: SchemaType.STRING, description: "The name of the target chat or workshop (e.g., 'цех 2', 'Сборка')." },
        chat_id: { type: SchemaType.STRING, description: "The UUID of the chat if known." },
        message: { type: SchemaType.STRING, description: "The text content of the message to send." },
      },
      required: ["message"],
    },
  },
  {
    name: "create_chat",
    description: "Create a new workshop chat / production sector. (Owner only).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: { type: SchemaType.STRING, description: "The name of the new chat (e.g. 'Шитьё')." },
      },
      required: ["name"],
    },
  },
  {
    name: "get_production_summary",
    description: "Get overall production statistics: total orders, active, completed, in progress, per-sector load.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: "delete_order",
    description: "Permanently delete an order and all its assignments/messages. (Owner only).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        order_number: { type: SchemaType.STRING, description: "The order number to delete." },
      },
      required: ["order_number"],
    },
  },
];

function track(ctx: ToolContext | undefined, orderNumber: string | number | undefined | null) {
  if (ctx?.affectedOrders && orderNumber !== undefined && orderNumber !== null) {
    ctx.affectedOrders.add(String(orderNumber));
  }
}

async function audit(ctx: ToolContext | undefined, action: string, entityType: string, entityId: string | null, details: Record<string, any>) {
  try {
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({ actor_user_id: ctx?.userId ?? null, action, entity_type: entityType, entity_id: entityId, details });
  } catch (e) {
    console.warn("audit failed:", e);
  }
}

async function isMemberOfChat(sb: any, userId: string, chatId: string): Promise<boolean> {
  const { data } = await sb.from("chat_members").select("user_id").eq("chat_id", chatId).eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

// Разрешение сектора для работника: его чаты (членство) + назначения заказа.
// Если ровно одно назначение в его секторах — берём его; если несколько — просим уточнить.
async function resolveWorkerSector(sb: any, ctx: ToolContext, orderId: string, chatNameRaw?: string): Promise<string> {
  if (chatNameRaw) {
    const chat = await findChatByName(sb, chatNameRaw);
    if (!chat) throw new Error(`Цех «${chatNameRaw}» не найден. Доступные цеха: см. list_chats`);
    const member = ctx.userId ? await isMemberOfChat(sb, ctx.userId, chat.id) : false;
    if (ctx.userRole === "worker" && !member) {
      throw new Error(`Вы не являетесь участником цеха «${chat.name}» — брать заказ можно только в своём цехе.`);
    }
    return chat.id;
  }

  if (!ctx.userId) throw new Error("Не определён пользователь для выбора сектора");
  const { data: myChats } = await sb.from("chat_members").select("chat_id").eq("user_id", ctx.userId);
  const myChatIds = new Set((myChats ?? []).map((m: any) => m.chat_id as string));

  const { data: oa, error: oaErr } = await sb.from("order_assignments").select("chat_id").eq("order_id", orderId);
  let sectorChatIds: string[] = (oa ?? []).map((a: any) => a.chat_id);
  if (oaErr) {
    // До миграции: сектора = dispatched_chat_ids / chat_id заказа
    const { data: orderRow } = await sb.from("orders").select("chat_id, dispatched_chat_ids").eq("id", orderId).maybeSingle();
    sectorChatIds = [...(Array.isArray(orderRow?.dispatched_chat_ids) ? orderRow.dispatched_chat_ids : []), ...(orderRow?.chat_id ? [orderRow.chat_id] : [])];
  }

  const mine = sectorChatIds.filter((cid) => myChatIds.has(cid));
  if (mine.length === 0) {
    throw new Error("Заказ не распределён в ваш цех. Руководитель ещё не отправил его вам — уточните у владельца или менеджера.");
  }
  if (mine.length > 1) {
    const names = await Promise.all(mine.map((a) => getChatName(sb, a)));
    throw new Error(`Заказ распределён в несколько ваших цехов (${names.join(", ")}). Уточните, в каком именно вы работаете.`);
  }
  return mine[0];
}

export async function executeToolCall(name: string, args: any, ctx?: ToolContext): Promise<any> {
  const supabase = getSupabaseClient();
  const { notifyOwners } = await import("@/lib/audit.server");

  switch (name) {
    case "search_knowledge_base":
      return await searchVectorStore(args.query);

    // ---------------------------------------------------------------- READ
    case "list_chats": {
      const { data } = await supabase.from("chats").select("id, name, is_dm").order("name");
      if (ctx?.userRole === "worker" && ctx.userId) {
        const { data: members } = await supabase.from("chat_members").select("chat_id").eq("user_id", ctx.userId);
        const ids = new Set((members ?? []).map((m: any) => m.chat_id));
        return { chats: (data ?? []).filter((c: any) => ids.has(c.id)) };
      }
      return { chats: data ?? [] };
    }

    case "list_workers": {
      const { data } = await supabase.from("profiles").select("id, display_name, username, role");
      return { workers: (data ?? []).map((p: any) => ({ id: p.id, name: p.display_name ?? p.username ?? "—", role: p.role ?? "worker" })) };
    }

    case "list_orders": {
      let query = supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(Math.min(args.limit ?? 20, 50));
      if (args.status_filter) query = query.eq("status", String(args.status_filter).toLowerCase());
      const { data } = await query;

      const { data: oa, error: oaErr } = await supabase.from("order_assignments").select("order_id, status");
      const byOrder = new Map<string, { total: number; done: number; problem: number }>();
      for (const a of oa ?? []) {
        const entry = byOrder.get(a.order_id) ?? { total: 0, done: 0, problem: 0 };
        entry.total += 1;
        if (a.status === "completed") entry.done += 1;
        if (a.status === "stalled" || a.status === "blocked") entry.problem += 1;
        byOrder.set(a.order_id, entry);
      }

      return {
        orders: (data ?? []).map((o: any) => ({
          number: o.number,
          nomenclature: o.nomenclature,
          status: o.status,
          finish_date: o.finish_date,
          stage: o.stage,
          priority: o.priority,
          progress: oaErr
            ? (o.responsible_user_id ? { total: 1, done: o.status === "completed" ? 1 : 0, problem: o.status === "stalled" ? 1 : 0 } : null)
            : byOrder.get(o.id),
        })),
      };
    }

    case "get_latest_order_status": {
      const order = await findOrderByNumber(supabase, args.order_number);
      if (!order) return { error: `Заказ ${args.order_number} не найден` };

      const { data: oa, error: oaErr } = await supabase.from("order_assignments")
        .select("chat_id, responsible_user_id, status, started_at, completed_at")
        .eq("order_id", order.id);
      const { data: chats } = await supabase.from("chats").select("id, name");

      let sectorRows = oa ?? [];
      if (oaErr) {
        // До миграции: сектора из legacy-полей заказа
        const sectors = [...(Array.isArray(order.dispatched_chat_ids) ? order.dispatched_chat_ids : []), ...(order.chat_id ? [order.chat_id] : [])];
        sectorRows = Array.from(new Set(sectors.filter(Boolean))).map((cid) => ({
          chat_id: cid,
          responsible_user_id: order.responsible_user_id,
          status: order.responsible_user_id ? "in_progress" : "new",
          started_at: order.last_update_at ?? order.updated_at ?? order.created_at,
          completed_at: order.status === "completed" ? order.updated_at : null,
        }));
      }

      const sectors = await Promise.all(sectorRows.map(async (a: any) => ({
        sector: chats?.find((c: any) => c.id === a.chat_id)?.name ?? a.chat_id,
        responsible_worker: a.responsible_user_id ? ((await getProfileName(supabase, a.responsible_user_id)) ?? "—") : null,
        status: a.status,
        started_at: a.started_at,
        completed_at: a.completed_at,
      })));

      return {
        number: order.number,
        nomenclature: order.nomenclature,
        status: order.status,
        finish_date: order.finish_date,
        customer_order: order.customer_order,
        stage: order.stage,
        priority: order.priority,
        sectors,
      };
    }

    case "get_order_assignments": {
      const order = await findOrderByNumber(supabase, args.order_number);
      if (!order) return { error: `Заказ ${args.order_number} не найден` };

      const { data: oa, error: oaErr2 } = await supabase.from("order_assignments")
        .select("*")
        .eq("order_id", order.id)
        .order("order_index", { ascending: true });
      const { data: chats } = await supabase.from("chats").select("id, name");

      let sectorRows = oa ?? [];
      if (oaErr2) {
        const sectors = [...(Array.isArray(order.dispatched_chat_ids) ? order.dispatched_chat_ids : []), ...(order.chat_id ? [order.chat_id] : [])];
        sectorRows = Array.from(new Set(sectors.filter(Boolean))).map((cid, i) => ({
          chat_id: cid,
          responsible_user_id: order.responsible_user_id,
          status: order.responsible_user_id ? "in_progress" : "new",
          order_index: i,
          started_at: order.last_update_at ?? order.updated_at ?? order.created_at,
          completed_at: order.status === "completed" ? order.updated_at : null,
        }));
      }

      return {
        order_number: order.number,
        overall_status: order.status,
        assignments: await Promise.all(sectorRows.map(async (a: any) => ({
          sector: chats?.find((c: any) => c.id === a.chat_id)?.name ?? a.chat_id,
          chat_id: a.chat_id,
          responsible_worker: a.responsible_user_id ? ((await getProfileName(supabase, a.responsible_user_id)) ?? "—") : null,
          status: a.status,
          order_index: a.order_index,
          started_at: a.started_at,
          completed_at: a.completed_at,
        }))),
      };
    }

    case "get_production_summary": {
      const { data: orders } = await supabase.from("orders").select("id, status, finish_date");
      const { data: oa } = await supabase.from("order_assignments").select("order_id, chat_id, status, responsible_user_id");
      const { data: chats } = await supabase.from("chats").select("id, name").eq("is_dm", false);

      const byStatus = new Map<string, number>();
      let overdue = 0;
      for (const o of orders ?? []) {
        byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
        if ((o.status === "in_progress" || o.status === "distributed" || o.status === "stalled") && o.finish_date) {
          if (new Date(o.finish_date) < new Date()) overdue += 1;
        }
      }

      const sectorLoad = new Map<string, { active: number; done: number }>();
      for (const a of oa ?? []) {
        const entry = sectorLoad.get(a.chat_id) ?? { active: 0, done: 0 };
        if (a.status === "completed") entry.done += 1;
        else if (a.status !== "cancelled" && a.status !== "new") entry.active += 1;
        sectorLoad.set(a.chat_id, entry);
      }

      return {
        total_orders: orders?.length ?? 0,
        by_status: Object.fromEntries(byStatus),
        overdue_orders: overdue,
        per_sector: (chats ?? []).map((c: any) => ({
          sector: c.name,
          active: sectorLoad.get(c.id)?.active ?? 0,
          completed: sectorLoad.get(c.id)?.done ?? 0,
        })),
      };
    }

    // --------------------------------------------------------------- WRITE
    case "create_new_order": {
      if (!canManage(ctx)) {
        return { error: "Операция недоступна. Создавать заказы могут только менеджеры и владелец." };
      }

      const stage = args.stage ?? "Новый";
      const priority = args.priority ?? "Обычный";
      const comment = buildOrderMetadata({ stage, priority, comment: args.comment || "" }, null);

      const row: any = {
        number: String(args.number).trim(),
        nomenclature: String(args.nomenclature).trim(),
        finish_date: args.finish_date || null,
        customer_order: args.customer_order || null,
        comment,
        created_by: ctx?.userId ?? null,
        is_dispatched: false,
        status: "new",
      };
      // До миграции нативных колонок нет — этап/приоритет в JSON-метаданных
      const { ordersHasNativeMeta } = await import("@/lib/assignments.server");
      if (await ordersHasNativeMeta(supabase)) {
        row.stage = stage;
        row.priority = priority;
      }

      const { data: newOrder, error } = await supabase.from("orders").insert(row).select().single();

      if (error) return { error: error.message };
      await audit(ctx, "order.created", "order", newOrder.id, { number: newOrder.number, nomenclature: newOrder.nomenclature });
      track(ctx, newOrder.number);

      // Если сразу указаны цеха — распределяем их же инструментом dispatch
      if (args.chat_names && Array.isArray(args.chat_names) && args.chat_names.length > 0) {
        const dispatchResult = await executeToolCall("dispatch_order_to_chats", { order_number: newOrder.number, chat_names: args.chat_names }, ctx);
        return {
          success: true,
          message: `Новый заказ №${newOrder.number} («${newOrder.nomenclature}») создан.`,
          dispatch_result: dispatchResult,
        };
      }

      return {
        success: true,
        message: `Новый заказ №${newOrder.number} («${newOrder.nomenclature}») успешно создан и помещён во входящие для распределения.`,
      };
    }

    case "dispatch_order_to_chats": {
      if (!canManage(ctx)) {
        return { error: "Операция не выполнена. Работники цехов не могут распределять заказы. Распределять заказы могут менеджеры и владелец." };
      }

      const order = await findOrderByNumber(supabase, args.order_number);
      if (!order) return { error: `Заказ №${args.order_number} не найден в базе.` };

      const chatNames: string[] = args.chat_names || [];
      if (chatNames.length === 0) return { error: "Не указаны цеха для распределения." };

      const { data: chats } = await supabase.from("chats").select("id, name").eq("is_dm", false);
      const matchedChatIds: string[] = [];
      const matchedChatNames: string[] = [];

      for (const requestedName of chatNames) {
        const clean = String(requestedName).toLowerCase().trim();
        const found = (chats ?? []).find((c: any) =>
          c.name.toLowerCase() === clean ||
          c.name.toLowerCase().includes(clean) ||
          clean.includes(c.name.toLowerCase())
        );
        if (found && !matchedChatIds.includes(found.id)) {
          matchedChatIds.push(found.id);
          matchedChatNames.push(found.name);
        }
      }

      if (matchedChatIds.length === 0) {
        return { error: `Ни один цех из списка [${chatNames.join(", ")}] не найден. Доступные цеха: ${(chats ?? []).map((c: any) => c.name).join(", ")}` };
      }

      const alreadyAssigned = (await supabase.from("order_assignments").select("chat_id").eq("order_id", order.id)).data ?? [];
      const knownChatIds = new Set(alreadyAssigned.map((a: any) => a.chat_id));
      const onlyNew = matchedChatIds.filter((cid) => !knownChatIds.has(cid));

      const { aiGenerateOrderCard } = await import("@/lib/orders.server");
      const cardContent = await aiGenerateOrderCard({
        number: order.number, order_date: order.order_date, finish_date: order.finish_date,
        nomenclature: order.nomenclature, customer_order: order.customer_order, comment: order.comment,
        chat_id: null, follow_up_interval_minutes: order.follow_up_interval_minutes,
      });

      const result = await dispatchOrderToChats(supabase, { order, chatIds: matchedChatIds, cardContent });

      await audit(ctx, "order.dispatched", "order", order.id, { number: order.number, chats: matchedChatNames });
      track(ctx, order.number);

      return {
        success: true,
        message: `Заказ №${order.number} отправлен в ${matchedChatNames.length} цеха: ${matchedChatNames.join(", ")}. В новых цехах созданы карточки для отклика; уже работающие сектора не тронуты.`,
        new_sectors: result.added.length,
        total_sectors: result.total,
        already_had_sectors: onlyNew.length,
      };
    }

    case "claim_order_by_worker": {
      if (!ctx?.userId) return { error: "Не удалось определить пользователя — нельзя взять заказ." };

      const order = await findOrderByNumber(supabase, args.order_number);
      if (!order) return { error: `Заказ №${args.order_number} не найден` };

      const chatId = await resolveWorkerSector(supabase, ctx, order.id, args.chat_name);

      try {
        const result = await claimAssignment(supabase, { orderId: order.id, chatId, userId: ctx.userId });
        await audit(ctx, "claim.confirmed", "order", order.id, { number: order.number, chat_id: chatId, worker: ctx.userId });
        track(ctx, order.number);
        if (result.alreadyMine) {
          return { success: true, message: `Заказ №${order.number} уже взят вами в работу в цехе «${result.chatName}».` };
        }
        return {
          success: true,
          message: `Заказ №${order.number} успешно взят в работу вами в цехе «${result.chatName}». Статус сектора — В работе. Другие цеха не затронуты.`,
        };
      } catch (e: any) {
        return { error: e.message };
      }
    }

    case "update_sector_task_status": {
      const order = await findOrderByNumber(supabase, args.order_number);
      if (!order) return { error: `Заказ №${args.order_number} не найден` };

      const status = String(args.status).toLowerCase() as AssignmentStatus;
      const valid: AssignmentStatus[] = ["new", "in_progress", "stalled", "blocked", "completed", "cancelled"];
      if (!valid.includes(status)) {
        return { error: `Недопустимый статус «${args.status}». Допустимо: completed, in_progress, stalled, blocked, new.` };
      }

      let chatId: string;
      try {
        chatId = await resolveWorkerSector(supabase, ctx!, order.id, args.chat_name);
      } catch (e: any) {
        // Менеджер/владелец может выбрать любой сектор даже вне своих чатов
        if (canManage(ctx)) {
          if (!args.chat_name) return { error: "Укажите цех (chat_name), статус которого нужно изменить." };
          const chat = await findChatByName(supabase, args.chat_name);
          if (!chat) return { error: `Цех «${args.chat_name}» не найден.` };
          chatId = chat.id;
        } else {
          return { error: e.message };
        }
      }

      // Работник может менять только СВОЁ назначение
      if (ctx?.userRole === "worker") {
        const { data: oa } = await supabase.from("order_assignments")
          .select("responsible_user_id").eq("order_id", order.id).eq("chat_id", chatId).maybeSingle();
        if (!oa || oa.responsible_user_id !== ctx.userId) {
          return { error: "Вы можете менять статус только по заказу, который сами взяли в работу в своём цехе. Сначала возьмите заказ (claim_order_by_worker)." };
        }
      }

      const { data: chatRow } = await supabase.from("chats").select("name").eq("id", chatId).maybeSingle();
      const sectorName = chatRow?.name ?? "цех";

      // reason указывается при проблеме — дублируем в чат сектора
      if ((status === "stalled" || status === "blocked") && args.reason) {
        await supabase.from("messages").insert({
          chat_id: chatId, is_ai: true, kind: "system", order_id: order.id,
          content: `⚠️ По заказу **${order.number}** в цехе «${sectorName}» отмечена проблема: ${args.reason}`,
        });
        await notifyOwners({ title: "Проблема с заказом", body: `Заказ ${order.number} (${sectorName}): ${args.reason}`, link: `/chats/${chatId}`, kind: "status_change" });
      }

      try {
        await setAssignmentStatus(supabase, { orderId: order.id, chatId, status });
      } catch (e: any) {
        return { error: e.message };
      }

      await audit(ctx, `assignment.${status}`, "order", order.id, { number: order.number, chat_id: chatId, sector: sectorName });
      track(ctx, order.number);

      const statusLabels: Record<string, string> = {
        completed: "Сделано", in_progress: "В работе", stalled: "Проблема", blocked: "Заблокирован", new: "Ожидает",
      };
      return {
        success: true,
        message: `Статус сектора «${sectorName}» по заказу №${order.number} обновлён на «${statusLabels[status] ?? status}». Общий статус заказа пересчитан автоматически.`,
      };
    }

    case "update_task_stage": {
      const order = await findOrderByNumber(supabase, args.order_number);
      if (!order) return { error: `Заказ №${args.order_number} не найден` };

      const meta = (() => {
        try {
          return JSON.parse(order.comment ?? "{}");
        } catch {
          return {};
        }
      })();
      const stage = args.stage ?? meta.stage ?? "Новый";
      const priority = args.priority ?? meta.priority ?? "Обычный";
      const comment = buildOrderMetadata({ stage, priority, comment: meta.comment ?? "" }, order.comment);

      const updates: Record<string, any> = {
        stage,
        priority,
        comment,
        last_update_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("orders").update(updates).eq("id", order.id);
      if (error) return { error: error.message };

      await audit(ctx, "order.details_updated", "order", order.id, { number: order.number, stage, priority });
      track(ctx, order.number);

      return { success: true, message: `Заказ №${order.number}: этап «${stage}», приоритет «${priority}».` };
    }

    case "set_assignment_responsible": {
      if (!canManage(ctx)) {
        return { error: "Операция недоступна. Назначать ответственных могут только менеджеры и владелец." };
      }

      const order = await findOrderByNumber(supabase, args.order_number);
      if (!order) return { error: `Заказ №${args.order_number} не найден` };

      const chat = await findChatByName(supabase, args.chat_name);
      if (!chat) return { error: `Цех «${args.chat_name}» не найден.` };

      const { data: oa } = await supabase.from("order_assignments").select("id").eq("order_id", order.id).eq("chat_id", chat.id).maybeSingle();
      if (!oa) return { error: `Заказ №${order.number} не распределён в цех «${chat.name}». Сначала dispatch_order_to_chats.` };

      let workerId: string | null = null;
      if (args.worker_name) {
        const worker = await findWorkerByName(supabase, args.worker_name);
        if (!worker) return { error: `Работник «${args.worker_name}» не найден.` };
        workerId = worker.id;
      }

      await reassignAssignmentResponsible(supabase, { orderId: order.id, chatId: chat.id, userId: workerId });
      await audit(ctx, "assignment.responsible_changed", "order", order.id, { number: order.number, chat: chat.name, worker_id: workerId });
      track(ctx, order.number);

      const workerName = workerId ? (await getProfileName(supabase, workerId)) ?? args.worker_name : null;
      return {
        success: true,
        message: workerName
          ? `Ответственный за сектор «${chat.name}» по заказу №${order.number} назначен: ${workerName}.`
          : `Ответственный за сектор «${chat.name}» по заказу №${order.number} снят — сектор снова ожидает принятия.`,
      };
    }

    case "send_chat_message": {
      let targetChatId = args.chat_id;
      if (!targetChatId && args.chat_name) {
        const chat = await findChatByName(supabase, args.chat_name);
        targetChatId = chat?.id;
      }
      if (!targetChatId) {
        return { error: `Чат "${args.chat_name || "неуказанный"}" не найден в системе.` };
      }

      if (ctx?.userRole === "worker") {
        if (!ctx.userId || !(await isMemberOfChat(supabase, ctx.userId, targetChatId))) {
          return { error: "Работник может писать только в свои цеха." };
        }
      }

      const { data, error } = await supabase.from("messages").insert({
        chat_id: targetChatId,
        content: args.message,
        is_ai: true,
        kind: "text",
      }).select().single();

      if (error) return { error: error.message };
      await audit(ctx, "message.ai_sent", "message", data.id, { chat_id: targetChatId, kind: "text" });
      return { success: true, message_id: data.id, chat_id: targetChatId };
    }

    case "create_chat": {
      if (!isOwner(ctx)) return { error: "Операция недоступна. Создавать цеха может только владелец." };
      const name = String(args.name ?? "").trim();
      if (!name) return { error: "Укажите название цеха." };

      const { data: existing } = await supabase.from("chats").select("id").eq("name", name).maybeSingle();
      if (existing) return { error: `Чат «${name}» уже существует.` };

      const { data: chat, error } = await supabase.from("chats").insert({ name, is_dm: false }).select().single();
      if (error) return { error: error.message };

      await audit(ctx, "chat.created", "chat", chat.id, { name });
      return { success: true, message: `Цех «${name}» создан. Теперь распределяйте в него заказы через dispatch_order_to_chats.`, chat_id: chat.id };
    }

    case "delete_order": {
      if (!isOwner(ctx)) return { error: "Операция недоступна. Удалять заказы может только владелец." };
      const order = await findOrderByNumber(supabase, args.order_number);
      if (!order) return { error: `Заказ №${args.order_number} не найден` };

      await supabase.from("order_assignments").delete().eq("order_id", order.id);
      await supabase.from("order_claims").delete().eq("order_id", order.id);
      await supabase.from("messages").delete().eq("order_id", order.id);
      await supabase.from("orders").delete().eq("id", order.id);

      await audit(ctx, "order.deleted", "order", order.id, { number: order.number });
      return { success: true, message: `Заказ №${order.number} полностью удалён (включая назначения, отклики и карточки в чатах).` };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}