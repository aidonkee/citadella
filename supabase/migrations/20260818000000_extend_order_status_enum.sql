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
