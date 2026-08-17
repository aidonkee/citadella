-- =============================================================================
-- Extend order_status enum for the multi-sector (per-assignment) architecture.
--
-- Order-level statuses:   new | distributed | in_progress | stalled | completed | overdue | cancelled
-- Assignment statuses:    new | in_progress | stalled | blocked | completed | cancelled
--
-- 'distributed' — заказ отправлен в цеха, но ни один сектор ещё не взял в работу.
-- 'blocked'     — сектор заблокирован (проблема), заказ в целом помечается 'stalled'.
-- 'cancelled'   — заказ/назначение отменено.
-- =============================================================================

ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'distributed';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'blocked';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'cancelled';
-- =============================================================================
-- NERVA: Multi-sector order assignments architecture
--
-- Один Order ≠ один ответственный.
-- Один Order = несколько order_assignments (по одному на производственный сектор),
-- у каждого свой responsible_user_id и свой независимый статус.
--
-- Миграция идемпотентна: безопасно применяется и к старой схеме (где нет
-- order_assignments), и поверх частично применённой 20260810010000.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. orders: нативные колонки stage / priority / barcode / delivery_address
-- -----------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'Новый',
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'Обычный',
  ADD COLUMN IF NOT EXISTS barcode TEXT,
  ADD COLUMN IF NOT EXISTS delivery_address TEXT;

-- Бэкфилл stage/priority из JSON-метаданных в comment (старый формат хранения)
UPDATE public.orders o
SET
  stage = COALESCE((o.comment::jsonb)->>'stage', 'Новый'),
  priority = COALESCE((o.comment::jsonb)->>'priority', 'Обычный')
WHERE o.comment IS NOT NULL
  AND left(btrim(o.comment), 1) = '{'
  AND o.comment LIKE '%__nerva_meta%';

-- -----------------------------------------------------------------------------
-- 2. order_claims: chat_id (отклик привязан к сектору) + снятие глобального lock
-- -----------------------------------------------------------------------------
ALTER TABLE public.order_claims ADD COLUMN IF NOT EXISTS chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE;

-- Бэкфилл chat_id для старых откликов из заказа
UPDATE public.order_claims c
SET chat_id = COALESCE(
  (SELECT o.chat_id FROM public.orders o WHERE o.id = c.order_id),
  (SELECT (o.dispatched_chat_ids)[1] FROM public.orders o WHERE o.id = c.order_id AND o.dispatched_chat_ids IS NOT NULL AND array_length(o.dispatched_chat_ids, 1) >= 1)
)
WHERE c.chat_id IS NULL;

-- КРИТИЧНО: старый частичный уникальный индекс допускал только ОДИН активный
-- отклик на весь заказ — это и был глобальный lock. Удаляем его.
DROP INDEX IF EXISTS public.order_claims_active_unique;

-- Устаревший UNIQUE(order_id) constraint (если остался)
DO $$
DECLARE conname text;
BEGIN
  SELECT constraint_name INTO conname
  FROM information_schema.table_constraints
  WHERE table_schema = 'public' AND table_name = 'order_claims'
    AND constraint_type = 'UNIQUE' AND constraint_name <> 'order_claims_order_id_chat_id_key';
  IF conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.order_claims DROP CONSTRAINT ' || quote_ident(conname);
  END IF;
END $$;

-- Уникальность теперь на пару (заказ, сектор)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_claims_order_id_chat_id_key') THEN
    ALTER TABLE public.order_claims ADD CONSTRAINT order_claims_order_id_chat_id_key UNIQUE(order_id, chat_id);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. order_assignments: полная схема (sector-level ответственность)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  responsible_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.order_status NOT NULL DEFAULT 'new',
  order_index INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Если таблица уже существовала (частичная миграция) — доводим схему
ALTER TABLE public.order_assignments ADD COLUMN IF NOT EXISTS order_index INT NOT NULL DEFAULT 0;
ALTER TABLE public.order_assignments ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.order_assignments ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_assignments_order_id_chat_id_key') THEN
    ALTER TABLE public.order_assignments ADD CONSTRAINT order_assignments_order_id_chat_id_key UNIQUE(order_id, chat_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS order_assignments_order_idx ON public.order_assignments (order_id);
CREATE INDEX IF NOT EXISTS order_assignments_chat_idx ON public.order_assignments (chat_id);
CREATE INDEX IF NOT EXISTS order_assignments_responsible_idx ON public.order_assignments (responsible_user_id);

ALTER TABLE public.order_assignments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_assignments TO authenticated;
GRANT ALL ON public.order_assignments TO service_role;

DROP POLICY IF EXISTS assignments_select ON public.order_assignments;
CREATE POLICY assignments_select ON public.order_assignments FOR SELECT TO authenticated
  USING (
    public.is_owner(auth.uid())
    OR responsible_user_id = auth.uid()
    OR public.is_chat_member(chat_id, auth.uid())
  );

DROP POLICY IF EXISTS assignments_manage ON public.order_assignments;
CREATE POLICY assignments_manage ON public.order_assignments FOR ALL TO authenticated
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));

DROP POLICY IF EXISTS assignments_responsible_update ON public.order_assignments;
CREATE POLICY assignments_responsible_update ON public.order_assignments FOR UPDATE TO authenticated
  USING (responsible_user_id = auth.uid() OR public.is_chat_member(chat_id, auth.uid()));

DROP TRIGGER IF EXISTS assignments_touch ON public.order_assignments;
CREATE TRIGGER assignments_touch BEFORE UPDATE ON public.order_assignments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Единая функция синхронизации статуса заказа из статусов его assignments
--
-- Правила:
--   - нет assignments                     -> статус заказа не трогаем
--   - все активные COMPLETED              -> COMPLETED
--   - все assignments CANCELLED           -> CANCELLED
--   - есть BLOCKED/STALLED среди активных -> STALLED (проблемный сектор виден
--                                            в своём assignment, инфо не теряется)
--   - все активные NEW (PENDING)          -> DISTRIBUTED
--   - иначе (хотя бы один IN_PROGRESS или COMPLETED, но не все) -> IN_PROGRESS
-- 'cancelled' и 'overdue' у заказа не затираются автоматически.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_order_status_from_assignments(p_order_id UUID)
RETURNS public.order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.order_status;
  v_statuses public.order_status[];
  v_active public.order_status[];
  v_new public.order_status;
BEGIN
  SELECT status INTO v_current FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT array_agg(status) INTO v_statuses
  FROM public.order_assignments WHERE order_id = p_order_id;

  -- Нет назначений — заказ ещё не распределён, статус не меняем
  IF v_statuses IS NULL OR array_length(v_statuses, 1) IS NULL THEN
    RETURN v_current;
  END IF;

  -- Активные назначения (cancelled исключаем из расчёта)
  SELECT array_agg(s) INTO v_active FROM unnest(v_statuses) AS s WHERE s <> 'cancelled';

  IF v_active IS NULL OR array_length(v_active, 1) IS NULL THEN
    v_new := 'cancelled';
  ELSIF (SELECT bool_and(s = 'completed') FROM unnest(v_active) AS s) THEN
    v_new := 'completed';
  ELSIF (SELECT bool_or(s IN ('blocked', 'stalled')) FROM unnest(v_active) AS s) THEN
    v_new := 'stalled';
  ELSIF (SELECT bool_and(s = 'new') FROM unnest(v_active) AS s) THEN
    v_new := 'distributed';
  ELSE
    v_new := 'in_progress';
  END IF;

  -- Ручную отмену и просрочку автоматически не затираем
  IF v_current = 'cancelled' AND v_new <> 'cancelled' THEN
    RETURN v_current;
  END IF;
  IF v_current = 'overdue' AND v_new NOT IN ('completed', 'cancelled') THEN
    RETURN v_current;
  END IF;

  UPDATE public.orders
  SET status = v_new, last_update_at = now()
  WHERE id = p_order_id AND status IS DISTINCT FROM v_new;

  RETURN v_new;
END $$;

REVOKE EXECUTE ON FUNCTION public.sync_order_status_from_assignments(UUID) FROM PUBLIC, anon, authenticated;

-- Триггер: любое изменение assignment автоматически пересчитывает статус заказа.
-- Это гарантирует консистентность независимо от того, откуда пришло изменение
-- (веб-UI, AI-агент, cron, прямой SQL).
CREATE OR REPLACE FUNCTION public.trg_sync_order_status_from_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_order_status_from_assignments(COALESCE(NEW.order_id, OLD.order_id));
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS order_assignments_sync_status ON public.order_assignments;
CREATE TRIGGER order_assignments_sync_status
AFTER INSERT OR UPDATE OF status OR DELETE ON public.order_assignments
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_order_status_from_assignments();

-- -----------------------------------------------------------------------------
-- 5. Миграция существующих заказов: Order.responsible_user_id -> assignments
-- -----------------------------------------------------------------------------
INSERT INTO public.order_assignments (order_id, chat_id, responsible_user_id, status, order_index, started_at, completed_at)
SELECT DISTINCT ON (o.id, t.cid)
  o.id,
  t.cid,
  o.responsible_user_id,
  CASE
    WHEN o.status = 'completed' THEN 'completed'::public.order_status
    WHEN o.status = 'stalled' THEN 'stalled'::public.order_status
    WHEN o.status = 'cancelled' THEN 'cancelled'::public.order_status
    WHEN o.responsible_user_id IS NOT NULL THEN 'in_progress'::public.order_status
    ELSE 'new'::public.order_status
  END,
  t.ord - 1,
  CASE WHEN o.responsible_user_id IS NOT NULL
        THEN COALESCE(o.last_update_at, o.updated_at, o.dispatched_at, o.created_at) END,
  CASE WHEN o.status = 'completed'
        THEN COALESCE(o.last_update_at, o.updated_at) END
FROM public.orders o
CROSS JOIN LATERAL unnest(
  COALESCE(o.dispatched_chat_ids, '{}'::uuid[]) || ARRAY[o.chat_id]
) WITH ORDINALITY AS t(cid, ord)
WHERE t.cid IS NOT NULL
ON CONFLICT (order_id, chat_id) DO NOTHING;

-- Пересчитать статусы всех заказов, у которых появились assignments
SELECT public.sync_order_status_from_assignments(id)
FROM public.orders
WHERE is_dispatched = true;

-- -----------------------------------------------------------------------------
-- 6. Realtime
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_assignments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_assignments;
  END IF;
END $$;
