-- =============================================================================
-- Nerva (OrderFlow) Complete Database Setup Script
-- Generated: 2026-07-17T08:23:25.181Z
-- =============================================================================

-- =============================================================================
-- Migration: 20260628222242_1411ceae-f36a-4319-a79f-a6cc03abf925.sql
-- =============================================================================

-- Roles enum and roles table
CREATE TYPE public.app_role AS ENUM ('owner', 'worker');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  username TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_owner(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.has_role(_user_id, 'owner') $$;

-- Profiles policies
CREATE POLICY "profiles_select_all_auth" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_owner_all" ON public.profiles FOR ALL TO authenticated USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));

-- User roles policies
CREATE POLICY "user_roles_select_own" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_owner(auth.uid()));
CREATE POLICY "user_roles_owner_manage" ON public.user_roles FOR ALL TO authenticated USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));

-- Chats
CREATE TABLE public.chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_dm BOOLEAN NOT NULL DEFAULT false,
  dm_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chats TO authenticated;
GRANT ALL ON public.chats TO service_role;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.chat_members (
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_members TO authenticated;
GRANT ALL ON public.chat_members TO service_role;
ALTER TABLE public.chat_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_chat_member(_chat_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS(SELECT 1 FROM public.chat_members WHERE chat_id = _chat_id AND user_id = _user_id) $$;

CREATE POLICY "chats_select_member_or_owner" ON public.chats FOR SELECT TO authenticated
  USING (public.is_owner(auth.uid()) OR public.is_chat_member(id, auth.uid()));
CREATE POLICY "chats_owner_manage" ON public.chats FOR ALL TO authenticated
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "chat_members_select" ON public.chat_members FOR SELECT TO authenticated
  USING (public.is_owner(auth.uid()) OR user_id = auth.uid() OR public.is_chat_member(chat_id, auth.uid()));
CREATE POLICY "chat_members_owner_manage" ON public.chat_members FOR ALL TO authenticated
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));

-- Orders
CREATE TYPE public.order_status AS ENUM ('new', 'in_progress', 'stalled', 'completed', 'overdue');

CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number TEXT NOT NULL,
  order_date DATE,
  finish_date DATE,
  nomenclature TEXT NOT NULL DEFAULT '',
  customer_order TEXT,
  comment TEXT,
  chat_id UUID REFERENCES public.chats(id) ON DELETE SET NULL,
  responsible_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.order_status NOT NULL DEFAULT 'new',
  follow_up_interval_minutes INT NOT NULL DEFAULT 120,
  next_follow_up_at TIMESTAMPTZ,
  last_update_at TIMESTAMPTZ,
  ai_message_id UUID,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders_select" ON public.orders FOR SELECT TO authenticated
  USING (
    public.is_owner(auth.uid())
    OR responsible_user_id = auth.uid()
    OR (chat_id IS NOT NULL AND public.is_chat_member(chat_id, auth.uid()))
  );
CREATE POLICY "orders_owner_manage" ON public.orders FOR ALL TO authenticated
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));
CREATE POLICY "orders_responsible_update" ON public.orders FOR UPDATE TO authenticated
  USING (responsible_user_id = auth.uid()) WITH CHECK (responsible_user_id = auth.uid());

-- Messages
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  sender_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_ai BOOLEAN NOT NULL DEFAULT false,
  content TEXT NOT NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'text', -- text | order_card | followup | system
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_select_member" ON public.messages FOR SELECT TO authenticated
  USING (public.is_owner(auth.uid()) OR public.is_chat_member(chat_id, auth.uid()));
CREATE POLICY "messages_insert_member" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    (public.is_owner(auth.uid()) OR public.is_chat_member(chat_id, auth.uid()))
    AND (sender_user_id = auth.uid() OR sender_user_id IS NULL)
  );

-- Order claims / takes
CREATE TABLE public.order_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, chat_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_claims TO authenticated;
GRANT ALL ON public.order_claims TO service_role;
ALTER TABLE public.order_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "claims_select" ON public.order_claims FOR SELECT TO authenticated
  USING (public.is_owner(auth.uid()) OR user_id = auth.uid());
CREATE POLICY "claims_insert_self" ON public.order_claims FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Order Assignments
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_assignments TO authenticated;
GRANT ALL ON public.order_assignments TO service_role;
ALTER TABLE public.order_assignments ENABLE ROW LEVEL SECURITY;

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
CREATE TRIGGER assignments_touch BEFORE UPDATE ON public.order_assignments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_claims;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_assignments;

-- Auto-create profile + DM chat on new user
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _dm_id UUID;
BEGIN
  INSERT INTO public.profiles (id, display_name, username)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  -- Create personal DM chat with AI
  INSERT INTO public.chats (name, is_dm, dm_user_id)
  VALUES ('AI · ' || COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)), true, NEW.id)
  RETURNING id INTO _dm_id;
  INSERT INTO public.chat_members (chat_id, user_id) VALUES (_dm_id, NEW.id);
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- Migration: 20260628222306_f36067eb-39c4-4e78-ad00-9811a5617b63.sql
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_owner(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_chat_member(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- Migration: 20260628225753_419520d6-cda8-47eb-b853-eb446b7effa7.sql
-- =============================================================================

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

-- =============================================================================
-- Migration: 20260628230521_303866d7-aafe-4c26-a5bb-4d001db8f820.sql
-- =============================================================================

UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email = 'zhanakovalmat01@gmail.com';

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'owner'::app_role FROM auth.users WHERE email = 'zhanakovalmat01@gmail.com'
ON CONFLICT DO NOTHING;

CREATE TABLE public.notification_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  realtime_status_changes BOOLEAN NOT NULL DEFAULT true,
  realtime_worker_replies BOOLEAN NOT NULL DEFAULT true,
  realtime_new_claims BOOLEAN NOT NULL DEFAULT true,
  email_status_changes BOOLEAN NOT NULL DEFAULT false,
  email_worker_replies BOOLEAN NOT NULL DEFAULT false,
  email_new_claims BOOLEAN NOT NULL DEFAULT false,
  email_address TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.notification_settings TO authenticated;
GRANT ALL ON public.notification_settings TO service_role;
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings read" ON public.notification_settings FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own settings write" ON public.notification_settings FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own settings update" ON public.notification_settings FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- =============================================================================
-- Migration: 20260709075436_feefa76c-9dd3-423a-b40d-66f25a674e5a.sql
-- =============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';

-- =============================================================================
-- Migration: 20260709075518_e4024a07-e6ec-4d83-8fa6-451fa02269e3.sql
-- =============================================================================

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

-- =============================================================================
-- Migration: 20260711113019_a242e8d6-65e4-407b-b52c-46c14381f912.sql
-- =============================================================================

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

-- =============================================================================
-- Migration: 20260711113107_ef25f0dc-e0c3-4e85-97b3-0c158189b03a.sql
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_owner(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_manager(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_chat_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- Migration: 20260711113354_1da53033-a91b-4717-99f2-b3a5359f0444.sql
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_chat_member(uuid, uuid) TO authenticated;

