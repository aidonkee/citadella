-- =============================================================================
-- NERVA: Security hardening + missing tables (20260819)
--
-- 1. RLS: закрываем эскалацию привилегий
--    - order_assignments: обновлять assignment может только его ответственный
--      (is_chat_member давал ЛЮБОМУ участнику чата менять чужой assignment:
--      статус, ответственного, отметку completed).
--    - messages: запрещаем подделку AI-сообщений клиентским кодом
--      (sender_user_id IS NULL удалён — AI-сообщения пишутся service_role).
-- 2. custom_tables / custom_table_rows: недостающие таблицы для страницы
--    «Таблицы (Excel/CRM)» + owner-only RLS.
-- 3. Realtime publication: добавляем chats / chat_members (сайдбар и страницы
--    подписываются на них, без этого изменения не доезжают).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1a. order_assignments: только ответственный (или owner через assignments_manage)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS assignments_responsible_update ON public.order_assignments;
CREATE POLICY assignments_responsible_update ON public.order_assignments
  FOR UPDATE TO authenticated
  USING (responsible_user_id = auth.uid())
  WITH CHECK (responsible_user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 1b. messages: нельзя подделывать сообщения Nerva AI (sender_user_id IS NULL)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS messages_insert_member ON public.messages;
CREATE POLICY messages_insert_member ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.is_owner(auth.uid()) OR public.is_chat_member(chat_id, auth.uid()))
    AND sender_user_id = auth.uid()
  );

-- -----------------------------------------------------------------------------
-- 2. custom_tables / custom_table_rows (страница «Таблицы») — owner-only
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.custom_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.custom_table_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID NOT NULL REFERENCES public.custom_tables(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custom_table_rows_table_idx ON public.custom_table_rows (table_id);

ALTER TABLE public.custom_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_table_rows ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_tables TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_table_rows TO authenticated;
GRANT ALL ON public.custom_tables TO service_role;
GRANT ALL ON public.custom_table_rows TO service_role;

DROP POLICY IF EXISTS custom_tables_owner_all ON public.custom_tables;
CREATE POLICY custom_tables_owner_all ON public.custom_tables FOR ALL TO authenticated
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

DROP POLICY IF EXISTS custom_table_rows_owner_all ON public.custom_table_rows;
CREATE POLICY custom_table_rows_owner_all ON public.custom_table_rows FOR ALL TO authenticated
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

-- -----------------------------------------------------------------------------
-- 3. Realtime: chats и chat_members в publication
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chats'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chats;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_members;
  END IF;
END $$;