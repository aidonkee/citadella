import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { toast } from "sonner";

export function OwnerNotifications() {
  const { user, isOwner } = useAuth();
  useEffect(() => {
    if (!user || !isOwner) return;
    const ch = supabase.channel(`notif-${user.id}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as { title: string; body: string | null; link: string | null };
          toast(n.title, { description: n.body ?? undefined });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, isOwner]);
  return null;
}
