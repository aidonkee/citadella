import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Nerva — Нервная система предприятия" }] }),
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id).maybeSingle();
    const r = role?.role;
    throw redirect({ to: r === "owner" ? "/dashboard" : r === "manager" ? "/manager/new" : "/chats" });
  },
  component: () => null,
});
