-- SQL миграция для создания табличного редактора (CRM/Excel)
CREATE TABLE IF NOT EXISTS public.custom_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.custom_table_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID REFERENCES public.custom_tables(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.custom_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_table_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read custom_tables" ON public.custom_tables FOR SELECT USING (true);
CREATE POLICY "Allow all insert custom_tables" ON public.custom_tables FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update custom_tables" ON public.custom_tables FOR UPDATE USING (true);
CREATE POLICY "Allow all delete custom_tables" ON public.custom_tables FOR DELETE USING (true);

CREATE POLICY "Allow all read custom_table_rows" ON public.custom_table_rows FOR SELECT USING (true);
CREATE POLICY "Allow all insert custom_table_rows" ON public.custom_table_rows FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update custom_table_rows" ON public.custom_table_rows FOR UPDATE USING (true);
CREATE POLICY "Allow all delete custom_table_rows" ON public.custom_table_rows FOR DELETE USING (true);
