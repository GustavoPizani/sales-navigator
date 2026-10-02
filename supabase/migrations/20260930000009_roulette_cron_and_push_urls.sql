-- Agendamentos (pg_cron) da roleta e correção das URLs das Edge Functions,
-- que ainda apontavam para o projeto Supabase antigo (hzklulatkvczwisyvsvn).
-- Projeto atual: nuvzzckagxmmucyqvpou.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- ── Push: aviso imediato de agendamento criado ──────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_appointment_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://nuvzzckagxmmucyqvpou.supabase.co/functions/v1/notify-appointment-created',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('appointment_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

-- ── (Re)agenda os jobs ──────────────────────────────────────────────────────
DO $$
DECLARE _j TEXT;
BEGIN
  FOREACH _j IN ARRAY ARRAY['send-appointment-reminders', 'send-shift-reminders',
                            'process-roulette-turns', 'send-notification-outbox'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = _j) THEN
      PERFORM cron.unschedule(_j);
    END IF;
  END LOOP;
END $$;

SELECT cron.schedule('send-appointment-reminders', '* * * * *', $$
  SELECT net.http_post(
    url := 'https://nuvzzckagxmmucyqvpou.supabase.co/functions/v1/send-appointment-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

SELECT cron.schedule('send-shift-reminders', '*/10 * * * *', $$
  SELECT net.http_post(
    url := 'https://nuvzzckagxmmucyqvpou.supabase.co/functions/v1/send-shift-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

-- Fecha os turnos cuja tolerância terminou e aloca as vagas (SQL puro).
SELECT cron.schedule('process-roulette-turns', '* * * * *', $$
  SELECT public.crm_process_due_roulette_turns();
$$);

-- Envia os avisos push enfileirados (faltas, alocações, decisão do admin).
SELECT cron.schedule('send-notification-outbox', '* * * * *', $$
  SELECT net.http_post(
    url := 'https://nuvzzckagxmmucyqvpou.supabase.co/functions/v1/send-notification-outbox',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
