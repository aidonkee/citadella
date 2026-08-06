// Server-only helpers for audit log + owner notifications.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function logAudit(args: {
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  details?: Record<string, any>;
}) {
  await supabaseAdmin.from("audit_log").insert({
    actor_user_id: args.actor_user_id,
    action: args.action,
    entity_type: args.entity_type,
    entity_id: args.entity_id ?? null,
    details: (args.details ?? {}) as any,
  });
}

type NotifyKind = "status_change" | "worker_reply" | "new_claim";

export async function notifyOwners(args: {
  title: string;
  body?: string;
  link?: string;
  kind: NotifyKind;
}) {
  const { data: owners } = await supabaseAdmin
    .from("user_roles").select("user_id").eq("role", "owner");
  if (!owners?.length) return;

  const ids = owners.map((o) => o.user_id);
  const { data: settings } = await supabaseAdmin
    .from("notification_settings").select("*").in("user_id", ids);
  const byUser = new Map((settings ?? []).map((s: any) => [s.user_id, s]));

  const rtField = args.kind === "status_change" ? "realtime_status_changes"
    : args.kind === "worker_reply" ? "realtime_worker_replies"
    : "realtime_new_claims";
  const emField = args.kind === "status_change" ? "email_status_changes"
    : args.kind === "worker_reply" ? "email_worker_replies"
    : "email_new_claims";

  const rows: any[] = [];
  for (const id of ids) {
    const s: any = byUser.get(id) ?? {};
    const rt = s[rtField] ?? true;
    if (rt) rows.push({ user_id: id, title: args.title, body: args.body ?? null, link: args.link ?? null });
  }
  if (rows.length) await supabaseAdmin.from("notifications").insert(rows);

  // Best-effort email — only if domain configured for the project
  for (const id of ids) {
    const s: any = byUser.get(id) ?? {};
    if (!s[emField]) continue;
    const to = s.email_address;
    if (!to) continue;
    try {
      await fetch(`${process.env.SUPABASE_URL?.replace(/\/$/, "") ?? ""}/functions/v1/send-owner-email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, subject: args.title, body: args.body ?? "", link: args.link ?? null }),
      }).catch(() => {});
    } catch { /* swallow */ }
  }
}
