-- O check-in pode fechar ANTES do início do turno (ex.: 5 min antes do
-- horário da roleta). tolerance_min passa a aceitar valores negativos:
--   -5 = fecha 5 min antes do início | 15 = fecha 15 min depois do início.
-- O fechamento é também o momento da alocação das vagas (sorteio).
-- O lembrete passa a contar a partir do fechamento ("faltam X min").

ALTER TABLE public.roulette_settings DROP CONSTRAINT IF EXISTS roulette_settings_tolerance_min_check;
ALTER TABLE public.roulette_settings ADD CONSTRAINT roulette_settings_tolerance_min_check
  CHECK (tolerance_min BETWEEN -120 AND 240);
-- o check-in precisa ficar aberto por algum tempo
ALTER TABLE public.roulette_settings DROP CONSTRAINT IF EXISTS roulette_settings_window_check;
ALTER TABLE public.roulette_settings ADD CONSTRAINT roulette_settings_window_check
  CHECK (checkin_open_before_min + tolerance_min > 0);

-- regra pedida: fecha 5 min antes do horário da roleta
UPDATE public.roulette_settings SET tolerance_min = -5 WHERE id = 1;

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
  -- lembrete X min antes de o check-in FECHAR (início + tolerância), mas
  -- nunca antes de o check-in abrir. _lead é medido a partir do início.
  _lead := LEAST(_cfg.checkin_reminder_min - _cfg.tolerance_min, _cfg.checkin_open_before_min);

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
         'O check-in do seu turno ' || public.crm_location_in(loc) || ' fecha às '
           || to_char(start_time + make_interval(mins => _cfg.tolerance_min), 'HH24:MI')
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
