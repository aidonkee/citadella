
-- Audit log
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads audit" ON public.audit_log FOR SELECT TO authenticated USING (public.is_owner(auth.uid()));
CREATE POLICY "service inserts audit" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (false);
CREATE INDEX audit_log_created_at_idx ON public.audit_log (created_at DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_log;

-- Notifications for owner
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications read" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own notifications update" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE INDEX notifications_user_idx ON public.notifications (user_id, created_at DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Order claim status (pending/confirmed/rejected)
ALTER TABLE public.order_claims ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected'));
UPDATE public.order_claims SET status = 'confirmed';
-- Allow multiple claims over time per order (drop unique if exists, replace with partial unique on non-rejected)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_claims_order_id_key') THEN
    ALTER TABLE public.order_claims DROP CONSTRAINT order_claims_order_id_key;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS order_claims_active_unique ON public.order_claims (order_id) WHERE status <> 'rejected';
