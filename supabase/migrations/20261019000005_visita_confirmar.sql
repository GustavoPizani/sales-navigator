-- Confirmação da visita: quando termina o horário de uma visita agendada pelo
-- lead e ninguém respondeu se ela aconteceu, o dono do agendamento recebe um
-- push ("A visita com Fulano terminou. Ela aconteceu?"). No app, um aviso pede
-- a resposta (Aconteceu / Não aconteceu) até ela ser dada.
-- Pode rodar de novo sem erro.

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS visit_confirm_reminded_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.crm_send_visit_confirm_reminders()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _now TIMESTAMP := public.crm_now_local();
  _count INT := 0;
BEGIN
  WITH due AS (
    SELECT a.id, a.owner_id, a.title, a.client_name, a.start_time
      FROM public.appointments a
      JOIN public.profiles p ON p.id = a.owner_id AND p.is_active
     WHERE a.type = 'visit'
       AND a.lead_id IS NOT NULL
       AND a.visit_status IS NULL
       AND a.visit_confirm_reminded_at IS NULL
       -- terminou há pouco (até 12 h): visitas antigas não geram aviso atrasado
       AND (a.date + a.end_time) <= _now
       AND (a.date + a.end_time) > _now - interval '12 hours'
       FOR UPDATE OF a SKIP LOCKED
  ), marked AS (
    UPDATE public.appointments x SET visit_confirm_reminded_at = now()
      FROM due WHERE x.id = due.id
    RETURNING due.*
  )
  INSERT INTO public.notification_outbox (user_id, title, body, url)
  SELECT owner_id,
         'A visita aconteceu?',
         'A visita com ' || coalesce(nullif(client_name, ''), regexp_replace(title, '^Visita\s*[–-]\s*', ''))
           || ' (' || to_char(start_time, 'HH24:MI') || ') terminou. Toque para dizer se ela aconteceu.',
         '/appointments'
    FROM marked;
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_send_visit_confirm_reminders() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('visit-confirm-reminders');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
SELECT cron.schedule('visit-confirm-reminders', '* * * * *', $$
  SELECT public.crm_send_visit_confirm_reminders();
$$);
