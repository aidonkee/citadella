import { createFileRoute } from "@tanstack/react-router";
import { generateText } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

function isAuthorizedCron(request: Request): boolean {
  // Vercel Cron добавляет заголовок x-vercel-cron (если cron задан в vercel.json)
  if (request.headers.get("x-vercel-cron")) return true;
  // Для локальных/внешних запусков — секрет в заголовке Authorization
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    return auth === `Bearer ${secret}`;
  }
  return false;
}

export const Route = createFileRoute("/api/public/cron/followups")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthorizedCron(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { syncOrderStatusWithAssignments, assignmentsTableExists } = await import("@/lib/assignments.server");
        const now = new Date();
        const stalledThresholdIntervals = 3;
        const key = process.env.ORDER_AI_KEY || process.env.LOVABLE_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
        const gateway = key ? createLovableAiGatewayProvider(key) : null;

        // Mark overdue (order-level, по сроку сдачи)
        await supabaseAdmin.from("orders")
          .update({ status: "overdue" })
          .lt("finish_date", now.toISOString().slice(0, 10))
          .in("status", ["new", "distributed", "in_progress", "stalled"]);

        // До миграции: legacy-фоллоу-апы по заказам
        if (!(await assignmentsTableExists(supabaseAdmin))) {
          const { data: dueLegacy } = await supabaseAdmin.from("orders")
            .select("*")
            .in("status", ["in_progress", "stalled"])
            .lte("next_follow_up_at", now.toISOString());

          let legacyProcessed = 0;
          for (const order of dueLegacy ?? []) {
            if (!order.responsible_user_id) continue;
            const { data: dm } = await supabaseAdmin.from("chats")
              .select("id").eq("is_dm", true).eq("dm_user_id", order.responsible_user_id).maybeSingle();
            if (!dm) continue;

            let text = `Привет! Напомни, на какой стадии заказ **${order.number}** (${order.nomenclature})?`;
            if (gateway) {
              try {
                const r = await generateText({
                  model: gateway("google/gemini-3.6-flash"),
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

            const lastUpdate = new Date(order.last_update_at ?? order.updated_at ?? order.created_at);
            const intervalsSilent = (now.getTime() - lastUpdate.getTime()) / (order.follow_up_interval_minutes * 60 * 1000);
            if (intervalsSilent >= stalledThresholdIntervals && order.status !== "stalled") {
              await supabaseAdmin.from("orders").update({ status: "stalled" }).eq("id", order.id);
              await logAudit({ actor_user_id: null, action: "order.status_changed", entity_type: "order", entity_id: order.id, details: { from: order.status, to: "stalled", by_ai: true, number: order.number } });
              await notifyOwners({ title: `ИИ: заказ ${order.number} завис`, body: `Нет ответа от ответственного ${order.follow_up_interval_minutes * stalledThresholdIntervals}+ мин`, link: `/chats/${order.chat_id ?? (order.dispatched_chat_ids?.[0])}`, kind: "status_change" });
            }

            await supabaseAdmin.from("orders").update({
              next_follow_up_at: new Date(now.getTime() + order.follow_up_interval_minutes * 60 * 1000).toISOString(),
            }).eq("id", order.id);
            legacyProcessed++;
          }

          return Response.json({ processed: dueLegacy?.length ?? 0, assignments: legacyProcessed, mode: "legacy" });
        }

        // Find orders needing follow-up (per-assignment архитектура)
        const { data: due } = await supabaseAdmin.from("orders")
          .select("*")
          .in("status", ["in_progress", "stalled"])
          .lte("next_follow_up_at", now.toISOString());

        let processedAssignments = 0;

        for (const order of due ?? []) {
          // Работаем по assignments заказа, а не по одному responsible_user_id
          const { data: assigns } = await supabaseAdmin.from("order_assignments")
            .select("*")
            .eq("order_id", order.id)
            .in("status", ["in_progress", "stalled", "blocked"]);

          for (const assign of assigns ?? []) {
            if (!assign.responsible_user_id) continue;
            const { data: dm } = await supabaseAdmin.from("chats")
              .select("id").eq("is_dm", true).eq("dm_user_id", assign.responsible_user_id).maybeSingle();
            if (!dm) continue;

            let text = `Привет! Напомни, на какой стадии заказ **${order.number}** (${order.nomenclature})?`;
            if (gateway) {
              try {
                const r = await generateText({
                  model: gateway("google/gemini-3.6-flash"),
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

            // Молчит слишком долго -> assignment помечаем stalled (заказ пересчитается триггером)
            const lastUpdate = new Date(assign.updated_at ?? assign.created_at);
            const intervalsSilent = (now.getTime() - lastUpdate.getTime()) / (order.follow_up_interval_minutes * 60 * 1000);
            if (intervalsSilent >= stalledThresholdIntervals && assign.status !== "stalled") {
              await supabaseAdmin.from("order_assignments")
                .update({ status: "stalled" })
                .eq("id", assign.id);
              await syncOrderStatusWithAssignments(supabaseAdmin, order.id);
              await logAudit({ actor_user_id: null, action: "assignment.status_changed", entity_type: "order", entity_id: order.id, details: { from: assign.status, to: "stalled", by_ai: true, number: order.number, chat_id: assign.chat_id } });
              await notifyOwners({ title: `ИИ: сектор завис по заказу ${order.number}`, body: `Нет ответа от ответственного ${order.follow_up_interval_minutes * stalledThresholdIntervals}+ мин`, link: `/chats/${assign.chat_id}`, kind: "status_change" });
            }
            processedAssignments++;
          }

          await supabaseAdmin.from("orders").update({
            next_follow_up_at: new Date(now.getTime() + order.follow_up_interval_minutes * 60 * 1000).toISOString(),
          }).eq("id", order.id);
        }

        return Response.json({ processed: due?.length ?? 0, assignments: processedAssignments });
      },
    },
  },
});
