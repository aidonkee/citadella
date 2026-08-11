import { createFileRoute } from "@tanstack/react-router";
import { generateText } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

export const Route = createFileRoute("/api/public/cron/followups")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date();
        const stalledThresholdMs = 3;

        // Mark overdue
        await supabaseAdmin.from("orders")
          .update({ status: "overdue" })
          .lt("finish_date", now.toISOString().slice(0, 10))
          .in("status", ["new", "in_progress", "stalled"]);

        // Find orders needing follow-up
        const { data: due } = await supabaseAdmin.from("orders")
          .select("*")
          .in("status", ["in_progress", "stalled"])
          .lte("next_follow_up_at", now.toISOString());

        const key = process.env.ORDER_AI_KEY || process.env.LOVABLE_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
        const gateway = key ? createLovableAiGatewayProvider(key) : null;

        for (const order of due ?? []) {
          if (!order.responsible_user_id) continue;
          const { data: dm } = await supabaseAdmin.from("chats")
            .select("id").eq("is_dm", true).eq("dm_user_id", order.responsible_user_id).maybeSingle();
          if (!dm) continue;

          let text = `Привет! Напомни, на какой стадии заказ **${order.number}** (${order.nomenclature})?`;
          if (gateway) {
            try {
              const r = await generateText({
                model: gateway("google/gemini-3-flash-preview"),
                prompt: `Сгенерируй короткое дружелюбное сообщение-напоминание сотруднику о текущем статусе заказа №${order.number} «${order.nomenclature}». Срок: ${order.finish_date ?? "—"}. Попроси ответить одним предложением. Без воды.`,
              });
              text = r.text;
            } catch { /* keep default */ }
          }

          const { logAudit, notifyOwners } = await import("@/lib/audit.server");
          const { data: aimsg } = await supabaseAdmin.from("messages").insert({
            chat_id: dm.id, is_ai: true, kind: "followup", order_id: order.id, content: text,
          }).select().single();
          await logAudit({ actor_user_id: null, action: "message.ai_sent", entity_type: "message", entity_id: aimsg?.id ?? null, details: { chat_id: dm.id, kind: "followup", order_id: order.id } });

          // Mark as stalled if no update for many intervals
          const lastUpdate = order.last_update_at ? new Date(order.last_update_at) : new Date(order.updated_at);
          const intervalsSilent = (now.getTime() - lastUpdate.getTime()) / (order.follow_up_interval_minutes * 60 * 1000);
          const newStatus = intervalsSilent >= stalledThresholdMs ? "stalled" : order.status;

          await supabaseAdmin.from("orders").update({
            status: newStatus,
            next_follow_up_at: new Date(now.getTime() + order.follow_up_interval_minutes * 60 * 1000).toISOString(),
          }).eq("id", order.id);

          if (newStatus !== order.status) {
            await logAudit({ actor_user_id: null, action: "order.status_changed", entity_type: "order", entity_id: order.id, details: { from: order.status, to: newStatus, by_ai: true, number: order.number } });
            await notifyOwners({ title: `ИИ обновил статус заказа ${order.number}`, body: `${order.status} → ${newStatus}`, link: order.chat_id ? `/chats/${order.chat_id}` : undefined, kind: "status_change" });
          }
        }

        return Response.json({ processed: due?.length ?? 0 });
      },
    },
  },
});
