-- Lembrete de check-in: push para cada corretor escalado que ainda não fez
-- check-in, X minutos antes do início do turno (padrão 10; 0 desliga).
-- Tocar na notificação abre a tela de Check-in.

ALTER TABLE public.roulette_settings
  ADD COLUMN IF NOT EXISTS checkin_reminder_min INT NOT NULL DEFAULT 10
    CHECK (checkin_reminder_min BETWEEN 0 AND 240);

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS checkin_reminded_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.crm_send_checkin_reminders()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cfg public.roulette_settings%ROWTYPE;
  _now TIMESTAMP := public.crm_now_local();
  _lead INT;
  _count INT := 0;
BEGIN
  SELECT * INTO _cfg FROM public.roulette_settings WHERE id = 1;
  IF NOT FOUND OR _cfg.checkin_reminder_min = 0 THEN RETURN 0; END IF;
  -- o lembrete não sai antes de o check-in abrir
  _lead := LEAST(_cfg.checkin_reminder_min, _cfg.checkin_open_before_min);

  WITH due AS (
    SELECT sh.id, sh.broker_id, sh.start_time, sh.end_time,
           coalesce(public.crm_slot_location(sh.slot_id), 'central') AS loc
      FROM public.shifts sh
      JOIN public.profiles p ON p.id = sh.broker_id AND p.is_active AND p.role = 'broker'
     WHERE sh.date = _now::date
       AND sh.checkin_reminded_at IS NULL
       AND sh.missed_at IS NULL
       AND _now >= (sh.date + sh.start_time) - make_interval(mins => _lead)
       AND _now <  (sh.date + sh.start_time) + make_interval(mins => _cfg.tolerance_min)
       AND NOT EXISTS (SELECT 1 FROM public.roulette_checkins rc
                        WHERE rc.broker_id = sh.broker_id AND rc.turn_date = sh.date
                          AND rc.start_time = sh.start_time AND rc.end_time = sh.end_time)
       FOR UPDATE OF sh SKIP LOCKED
  ), marked AS (
    UPDATE public.shifts s SET checkin_reminded_at = now()
      FROM due WHERE s.id = due.id
    RETURNING due.*
  )
  INSERT INTO public.notification_outbox (user_id, title, body, url)
  SELECT broker_id,
         'Hora do check-in',
         'Seu turno ' || public.crm_location_in(loc) || ' começa às ' || to_char(start_time, 'HH24:MI')
           || '. Toque aqui para fazer o check-in.',
         '/checkin'
    FROM marked;
  GET DIAGNOSTICS _count = ROW_COUNT;

  -- envia na hora, sem esperar o próximo ciclo do envio de avisos
  IF _count > 0 THEN
    BEGIN
      PERFORM net.http_post(
        url := 'https://nuvzzckagxmmucyqvpou.supabase.co/functions/v1/send-notification-outbox',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb
      );
    EXCEPTION WHEN OTHERS THEN
      NULL; -- o envio periódico (a cada minuto) cobre
    END;
  END IF;
  RETURN _count;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_send_checkin_reminders() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('checkin-reminders');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
SELECT cron.schedule('checkin-reminders', '* * * * *', $$
  SELECT public.crm_send_checkin_reminders();
$$);
