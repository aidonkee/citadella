DROP POLICY IF EXISTS orders_select ON public.orders;

CREATE POLICY orders_select
ON public.orders
FOR SELECT
TO authenticated
USING (
  public.is_owner(auth.uid())
  OR (created_by = auth.uid() AND public.is_manager(auth.uid()))
  OR responsible_user_id = auth.uid()
  OR (chat_id IS NOT NULL AND public.is_chat_member(chat_id, auth.uid()))
  OR EXISTS (
    SELECT 1
    FROM public.chat_members cm
    WHERE cm.user_id = auth.uid()
      AND cm.chat_id = ANY(public.orders.dispatched_chat_ids)
  )
);