-- Aviso ao corretor quando o check-in é validado, e envio imediato dos push.

-- ── Check-in validado → notificação para o corretor ─────────────────────────
-- (Stand-by alocado/recusado já é avisado no processamento do turno e na
-- decisão do admin.)
CREATE OR REPLACE FUNCTION public.roulette_checkin_notify_validated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'validated' THEN
    INSERT INTO public.notification_outbox (user_id, title, body, url)
    VALUES (
      NEW.broker_id,
      'Check-in validado',
      'Você está na roleta do turno ' || to_char(NEW.start_time, 'HH24:MI') || '–' ||
        to_char(NEW.end_time, 'HH24:MI') || ' (' || public.crm_location_label(NEW.location) || ').',
      '/checkin'
    );
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS roulette_checkin_notify_validated ON public.roulette_checkins;
CREATE TRIGGER roulette_checkin_notify_validated AFTER INSERT ON public.roulette_checkins
  FOR EACH ROW EXECUTE FUNCTION public.roulette_checkin_notify_validated();

-- ── Envio imediato ──────────────────────────────────────────────────────────
-- Ao enfileirar avisos, chama a Edge Function na hora (o cron de 1 em 1 minuto
-- continua como garantia). Se o pg_net não estiver disponível, apenas ignora.
CREATE OR REPLACE FUNCTION public.notification_outbox_kick()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://nuvzzckagxmmucyqvpou.supabase.co/functions/v1/send-notification-outbox',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS notification_outbox_kick ON public.notification_outbox;
CREATE TRIGGER notification_outbox_kick AFTER INSERT ON public.notification_outbox
  FOR EACH STATEMENT EXECUTE FUNCTION public.notification_outbox_kick();
