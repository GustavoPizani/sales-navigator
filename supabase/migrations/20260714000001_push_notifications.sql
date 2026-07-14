-- Web Push notifications for appointments: subscriptions, per-manager reminder
-- lead time, and a flag to avoid sending the same reminder twice.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subscriptions_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_own" ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON public.push_subscriptions (user_id);

-- How many minutes before an appointment its manager (and the broker) get a
-- reminder push. Only meaningful for manager accounts, but kept on every
-- profile for simplicity; NULL/0 means reminders are off.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER NOT NULL DEFAULT 30;

-- Marks when the reminder push was already dispatched for an appointment,
-- so the reminder cron job never sends it twice.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS appointments_reminder_pending_idx
  ON public.appointments (date, start_time)
  WHERE reminder_sent_at IS NULL;
