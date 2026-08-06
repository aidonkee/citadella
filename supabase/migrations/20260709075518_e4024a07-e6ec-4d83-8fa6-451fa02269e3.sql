
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_dispatched boolean NOT NULL DEFAULT true;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS dispatched_chat_ids uuid[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.is_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.has_role(_user_id, 'manager'::public.app_role) $$;

DROP POLICY IF EXISTS orders_select ON public.orders;
CREATE POLICY orders_select ON public.orders FOR SELECT USING (
  public.is_owner(auth.uid())
  OR (created_by = auth.uid() AND public.is_manager(auth.uid()))
  OR responsible_user_id = auth.uid()
  OR (chat_id IS NOT NULL AND public.is_chat_member(chat_id, auth.uid()))
);

DROP POLICY IF EXISTS orders_manager_insert ON public.orders;
CREATE POLICY orders_manager_insert ON public.orders FOR INSERT
TO authenticated
WITH CHECK (
  public.is_manager(auth.uid())
  AND created_by = auth.uid()
  AND is_dispatched = false
);
