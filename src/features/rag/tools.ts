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
];

export async function executeToolCall(name: string, args: any) {
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
          // If not found by ilike, fetch all chats and match
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

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
