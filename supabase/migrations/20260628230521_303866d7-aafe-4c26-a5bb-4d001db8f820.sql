
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
