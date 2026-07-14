-- Wires the appointments table to the push-notification Edge Functions:
-- an immediate notification when an appointment is created, and a cron job
-- that checks every minute for upcoming appointments needing a reminder.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- ── Immediate notification on INSERT ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_appointment_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://hzklulatkvczwisyvsvn.supabase.co/functions/v1/notify-appointment-created',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('appointment_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_appointment_created ON public.appointments;
CREATE TRIGGER trg_notify_appointment_created
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.notify_appointment_created();

-- ── Reminder cron, every minute ─────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-appointment-reminders') THEN
    PERFORM cron.unschedule('send-appointment-reminders');
  END IF;
END $$;

SELECT cron.schedule(
  'send-appointment-reminders',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hzklulatkvczwisyvsvn.supabase.co/functions/v1/send-appointment-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
