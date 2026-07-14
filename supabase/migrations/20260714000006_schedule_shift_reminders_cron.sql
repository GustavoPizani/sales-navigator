-- Schedules the shift ("escala") reminder cron, every 10 minutes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-shift-reminders') THEN
    PERFORM cron.unschedule('send-shift-reminders');
  END IF;
END $$;

SELECT cron.schedule(
  'send-shift-reminders',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hzklulatkvczwisyvsvn.supabase.co/functions/v1/send-shift-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
