import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { searchVectorStore } from "./vector-store";
import { FunctionDeclaration, SchemaType } from "@google/generative-ai";

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://jvvcholnwdinjbexbjvl.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  return createClient(url, key, { realtime: { transport: ws as any } });
}

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
    name: "get_latest_order_status",
    description: "Fetch the latest real-time status and details of an order from the database.",
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
    name: "list_chats",
    description: "List all existing chats and workshops in the system to find their names and IDs.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: "send_chat_message",
    description: "Send a message into a chat/workshop by chat_name (e.g., 'цех 2', 'Сборка') or chat_id.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        chat_name: {
          type: SchemaType.STRING,
          description: "The name of the target chat or workshop (e.g., 'цех 2', 'Сборка').",
        },
        chat_id: {
          type: SchemaType.STRING,
          description: "The UUID of the chat if known.",
        },
        message: {
          type: SchemaType.STRING,
          description: "The text content of the message to send.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "update_task_stage",
    description: "Update the stage and/or priority of an order in the database.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        order_number: {
          type: SchemaType.STRING,
          description: "The order number.",
        },
        stage: {
          type: SchemaType.STRING,
          description: "The new stage name (Новый, Производство, Логистика, Готово).",
        },
        priority: {
          type: SchemaType.STRING,
          description: "The new priority (Обычный, Срочно, Высокий, Средний).",
        },
      },
      required: ["order_number", "stage"],
    },
  },
  {
    name: "claim_order_by_worker",
    description: "Worker claims/accepts an order to start working on it in a workshop. Immediately updates status to in_progress on the dashboard without manual owner approval.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        order_number: {
          type: SchemaType.STRING,
          description: "The order number (e.g., '44' or '№44').",
        },
        chat_name: {
          type: SchemaType.STRING,
          description: "Optional workshop or chat name (e.g. 'Сборка', 'Дерево').",
        },
      },
      required: ["order_number"],
    },
  },
  {
    name: "update_sector_task_status",
    description: "Update the status of a specific sector/workshop task for an order (e.g., mark as completed, in_progress, or stalled). Immediately syncs dashboard matrix status.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        order_number: {
          type: SchemaType.STRING,
          description: "The order number.",
        },
        status: {
          type: SchemaType.STRING,
          description: "The new status: 'completed' (Сделано), 'in_progress' (В работе), 'stalled' (Проблема).",
        },
        chat_name: {
          type: SchemaType.STRING,
          description: "Optional workshop or chat name.",
        },
      },
      required: ["order_number", "status"],
    },
  },
  {
    name: "dispatch_order_to_chats",
    description: "Dispatch/send an undispatched order to specific workshop chats (e.g. 'цех 1', 'цех 2', 'Дерево', 'Ткань') so workers can see the order card and claim it. (Owner only).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        order_number: {
          type: SchemaType.STRING,
          description: "The order number to dispatch (e.g. '228' or '№228').",
        },
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
    name: "create_new_order",
    description: "Create a new production order in Nerva ERP. (Owner and Manager only).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        number: {
          type: SchemaType.STRING,
          description: "The order number (e.g. '228').",
        },
        nomenclature: {
          type: SchemaType.STRING,
          description: "Nomenclature or product description.",
        },
        finish_date: {
          type: SchemaType.STRING,
          description: "Optional deadline date YYYY-MM-DD.",
        },
        customer_order: {
          type: SchemaType.STRING,
          description: "Optional customer order ref.",
        },
        comment: {
          type: SchemaType.STRING,
          description: "Optional additional comment.",
        },
      },
      required: ["number", "nomenclature"],
    },
  },
];

export async function executeToolCall(name: string, args: any, ctx?: { userId?: string; userRole?: string }) {
  const supabase = getSupabaseClient();
  switch (name) {
    case "search_knowledge_base":
      return await searchVectorStore(args.query);

    case "get_latest_order_status": {
      const numStr = String(args.order_number).trim();
      let { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("number", numStr)
        .maybeSingle();
      if (!data) {
        const { data: list } = await supabase
          .from("orders")
          .select("*")
          .ilike("number", `%${numStr}%`)
          .limit(1);
        data = list?.[0] ?? null;
      }
      if (!data) return { error: `Заказ ${numStr} не найден` };
      return data;
    }

    case "list_chats": {
      const { data, error } = await supabase
        .from("chats")
        .select("id, name, is_dm")
        .order("name");
      if (error) return { error: error.message };
      return { chats: data };
    }

    case "send_chat_message": {
      let targetChatId = args.chat_id;

      if (!targetChatId && args.chat_name) {
        const cleanName = String(args.chat_name).trim();
        const { data: foundChat } = await supabase
          .from("chats")
          .select("id, name")
          .ilike("name", `%${cleanName}%`)
          .limit(1)
          .maybeSingle();
        if (foundChat) {
          targetChatId = foundChat.id;
        } else {
          const { data: allChats } = await supabase.from("chats").select("id, name");
          const matched = (allChats || []).find((c) =>
            c.name.toLowerCase().includes(cleanName.toLowerCase()) ||
            cleanName.toLowerCase().includes(c.name.toLowerCase())
          );
          if (matched) targetChatId = matched.id;
        }
      }

      if (!targetChatId) {
        return { error: `Чат "${args.chat_name || "неуказанный"}" не найден в системе.` };
      }

      const { data, error } = await supabase
        .from("messages")
        .insert({
          chat_id: targetChatId,
          content: args.message,
          is_ai: true,
          kind: "text",
        })
        .select()
        .single();

      if (error) return { error: error.message };
      return { success: true, message_id: data.id, chat_id: targetChatId };
    }

    case "update_task_stage": {
      const numStr = String(args.order_number).trim();
      const updates: any = { last_update_at: new Date().toISOString() };
      if (args.stage) updates.stage = args.stage;
      if (args.priority) updates.priority = args.priority;

      const { data, error } = await supabase
        .from("orders")
        .update(updates)
        .ilike("number", `%${numStr}%`)
        .select()
        .single();
      if (error) return { error: error.message };
      return data;
    }

    case "dispatch_order_to_chats": {
      if (ctx?.userRole === "worker") {
        return { error: "Операция не выполнена. Работники цехов не могут распределять заказы. Распределять заказы могут менеджеры и владелец." };
      }

      const numStr = String(args.order_number).trim();
      let { data: order } = await supabase
        .from("orders")
        .select("*")
        .ilike("number", `%${numStr}%`)
        .limit(1)
        .maybeSingle();

      if (!order) {
        return { error: `Заказ №${numStr} не найден в базе.` };
      }

      const chatNames: string[] = args.chat_names || [];
      if (chatNames.length === 0) {
        return { error: "Не указаны цеха для распределения." };
      }

      const { data: chats } = await supabase.from("chats").select("id, name").eq("is_dm", false);
      const matchedChatIds: string[] = [];
      const matchedChatNames: string[] = [];

      for (const requestedName of chatNames) {
        const clean = requestedName.toLowerCase().trim();
        const found = (chats || []).find(c => 
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
        return { error: `Ни один цех из списка [${chatNames.join(", ")}] не найден в системе. Доступные цеха: ${(chats || []).map(c => c.name).join(", ")}` };
      }

      const { aiGenerateOrderCard } = await import("@/lib/orders.server");
      const orderInput = {
        number: order.number, order_date: order.order_date, finish_date: order.finish_date,
        nomenclature: order.nomenclature, customer_order: order.customer_order, comment: order.comment,
        chat_id: null, follow_up_interval_minutes: order.follow_up_interval_minutes,
      };
      const content = await aiGenerateOrderCard(orderInput);
      let firstMsgId: string | null = null;

      for (const cid of matchedChatIds) {
        const { data: m } = await supabase.from("messages").insert({
          chat_id: cid, is_ai: true, content, order_id: order.id, kind: "order_card",
        }).select().single();
        if (!firstMsgId && m) firstMsgId = m.id;
      }

      await supabase.from("orders").update({
        is_dispatched: true,
        dispatched_at: new Date().toISOString(),
        dispatched_chat_ids: matchedChatIds,
        ai_message_id: firstMsgId,
        status: "new",
      }).eq("id", order.id);

      const assignments = matchedChatIds.map(cid => ({
        order_id: order.id,
        chat_id: cid,
        status: "new" as const,
      }));
      await supabase.from("order_assignments").upsert(assignments, { onConflict: "order_id,chat_id" });

      return {
        success: true,
        message: `Заказ №${order.number} успешно отправлен в ${matchedChatNames.length} цеха: ${matchedChatNames.join(", ")}. В этих чатах созданы карточки заказа для отклика сотрудников!`,
      };
    }

    case "create_new_order": {
      if (ctx?.userRole === "worker") {
        return { error: "Операция недоступна. Сотрудники цехов не могут создавать новые заказы. Создавать заказы могут только менеджеры и владелец." };
      }

      const { buildOrderMetadata } = await import("@/lib/order-metadata");
      const comment = buildOrderMetadata({ stage: "Новый", priority: "Обычный", comment: args.comment || "" }, null);

      const { data: newOrder, error } = await supabase.from("orders").insert({
        number: String(args.number).trim(),
        nomenclature: String(args.nomenclature).trim(),
        finish_date: args.finish_date || null,
        customer_order: args.customer_order || null,
        comment,
        created_by: ctx?.userId || null,
        is_dispatched: false,
        status: "new",
      }).select().single();

      if (error) return { error: error.message };

      return {
        success: true,
        message: `Новый заказ №${newOrder.number} ("${newOrder.nomenclature}") успешно создан и помещён во входящие для распределения владельцем.`,
      };
    }

    case "claim_order_by_worker": {
      const numStr = String(args.order_number).trim();
      let { data: order } = await supabase
        .from("orders")
        .select("id, number")
        .ilike("number", `%${numStr}%`)
        .limit(1)
        .maybeSingle();

      if (!order) return { error: `Заказ №${numStr} не найден` };

      let chatId: string | null = null;
      if (args.chat_name) {
        const { data: c } = await supabase.from("chats").select("id").ilike("name", `%${args.chat_name}%`).limit(1).maybeSingle();
        if (c) chatId = c.id;
      }

      if (!chatId) {
        const { data: oa } = await supabase.from("order_assignments").select("chat_id").eq("order_id", order.id).limit(1).maybeSingle();
        if (oa) chatId = oa.chat_id;
      }

      if (!chatId) {
        const { data: fullOrder } = await supabase.from("orders").select("dispatched_chat_ids, chat_id").eq("id", order.id).single();
        if (fullOrder?.dispatched_chat_ids && fullOrder.dispatched_chat_ids.length > 0) {
          chatId = fullOrder.dispatched_chat_ids[0];
        } else if (fullOrder?.chat_id) {
          chatId = fullOrder.chat_id;
        }
      }

      if (!chatId) {
        return { error: `Не указан цех для взятия заказа №${order.number}` };
      }

      const { error: assignErr } = await supabase
        .from("order_assignments")
        .upsert({
          order_id: order.id,
          chat_id: chatId,
          status: "in_progress",
          ...(ctx?.userId ? { responsible_user_id: ctx.userId } : {}),
        }, { onConflict: "order_id,chat_id" });

      if (assignErr) return { error: assignErr.message };

      const { data: assignments } = await supabase.from("order_assignments").select("status").eq("order_id", order.id);
      const statuses = (assignments || []).map((a: any) => a.status);
      const allCompleted = statuses.every((s: string) => s === "completed");
      const overallStatus = allCompleted ? "completed" : "in_progress";

      await supabase.from("orders").update({
        status: overallStatus,
        last_update_at: new Date().toISOString(),
      }).eq("id", order.id);

      return {
        success: true,
        message: `Заказ №${order.number} успешно взят в работу! Статус в матрице на дашборде мгновенно переведён в 'В работе'.`,
      };
    }

    case "update_sector_task_status": {
      const numStr = String(args.order_number).trim();
      const newStatus = args.status as "completed" | "in_progress" | "stalled";
      let { data: order } = await supabase
        .from("orders")
        .select("id, number")
        .ilike("number", `%${numStr}%`)
        .limit(1)
        .maybeSingle();

      if (!order) return { error: `Заказ №${numStr} не найден` };

      let chatId: string | null = null;
      if (args.chat_name) {
        const { data: c } = await supabase.from("chats").select("id").ilike("name", `%${args.chat_name}%`).limit(1).maybeSingle();
        if (c) chatId = c.id;
      }

      const { data: oaList } = await supabase.from("order_assignments").select("*").eq("order_id", order.id);
      if (!oaList || oaList.length === 0) {
        return { error: `У заказа №${order.number} нет назначений в цехах` };
      }

      const targetOa = chatId ? oaList.find(a => a.chat_id === chatId) : oaList[0];
      if (!targetOa) {
        return { error: `Заказ №${order.number} не назначен в указанный цех` };
      }

      await supabase.from("order_assignments").update({ status: newStatus }).eq("id", targetOa.id);

      const { data: updatedOaList } = await supabase.from("order_assignments").select("status").eq("order_id", order.id);
      const statuses = (updatedOaList || []).map((a: any) => a.status);
      const allCompleted = statuses.every((s: string) => s === "completed");
      const anyStalled = statuses.some((s: string) => s === "stalled");
      const overallStatus = allCompleted ? "completed" : anyStalled ? "stalled" : "in_progress";

      await supabase.from("orders").update({
        status: overallStatus,
        last_update_at: new Date().toISOString(),
        ...(allCompleted ? { finish_date: new Date().toISOString().split("T")[0] } : {}),
      }).eq("id", order.id);

      return {
        success: true,
        message: `Статус задачи по заказу №${order.number} обновлен на '${newStatus}'. Дашборд синхронизирован!`,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
