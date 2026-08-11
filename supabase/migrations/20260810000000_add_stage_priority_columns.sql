-- Migration: 20260810000000_add_stage_priority_columns.sql
-- Add native columns for order stage, priority, barcode, and delivery address

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'Новый',
ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'Обычный',
ADD COLUMN IF NOT EXISTS barcode TEXT,
ADD COLUMN IF NOT EXISTS delivery_address TEXT;
