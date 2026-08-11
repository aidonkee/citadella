-- Create order_assignments table
CREATE TABLE public.order_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  responsible_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.order_status NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, chat_id)
);

-- Enable RLS
ALTER TABLE public.order_assignments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_assignments TO authenticated;
GRANT ALL ON public.order_assignments TO service_role;

-- Policies for order_assignments
CREATE POLICY "assignments_select" ON public.order_assignments FOR SELECT TO authenticated
  USING (
    public.is_owner(auth.uid())
    OR responsible_user_id = auth.uid()
    OR public.is_chat_member(chat_id, auth.uid())
  );

CREATE POLICY "assignments_manage" ON public.order_assignments FOR ALL TO authenticated
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "assignments_responsible_update" ON public.order_assignments FOR UPDATE TO authenticated
  USING (
    responsible_user_id = auth.uid() 
    OR public.is_chat_member(chat_id, auth.uid())
  );

-- Trigger for updated_at
CREATE TRIGGER assignments_touch BEFORE UPDATE ON public.order_assignments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Add chat_id to order_claims
ALTER TABLE public.order_claims ADD COLUMN chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE;

-- We need to drop the old unique constraint on order_claims.
-- The name of the constraint is usually "order_claims_order_id_key". Let's attempt to drop it safely.
DO $$
DECLARE
    conname text;
BEGIN
    SELECT constraint_name INTO conname
    FROM information_schema.table_constraints
    WHERE table_name = 'order_claims' AND constraint_type = 'UNIQUE';
    
    IF conname IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.order_claims DROP CONSTRAINT ' || conname;
    END IF;
END $$;

ALTER TABLE public.order_claims ADD CONSTRAINT order_claims_order_id_chat_id_key UNIQUE(order_id, chat_id);

-- Update realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_assignments;
