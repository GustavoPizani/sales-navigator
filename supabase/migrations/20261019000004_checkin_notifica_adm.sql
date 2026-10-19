-- Aviso ao ADM a cada check-in: quem fez, turno, local, equipe e se entrou
-- escalado (validado) ou como stand-by. Vai pela mesma fila de push dos outros
-- avisos (notification_outbox), que já ignora a conta de teste.
-- Pode rodar de novo sem erro.

CREATE OR REPLACE FUNCTION public.roulette_checkin_notify_admin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _nome TEXT;
  _equipe TEXT;
  _local TEXT;
  _situacao TEXT;
BEGIN
  SELECT full_name INTO _nome FROM public.profiles WHERE id = NEW.broker_id;
  SELECT coalesce(nullif(team_name, ''), full_name) INTO _equipe FROM public.profiles WHERE id = NEW.team_manager_id;
  -- nome do PDV: "Plantão <produto>" (produto das regras de check-in)
  SELECT 'Plantão' || coalesce(' ' || p.name, '') INTO _local
    FROM public.roulette_settings rs LEFT JOIN public.projects p ON p.id = rs.plantao_project_id
   WHERE rs.id = 1;
  _situacao := CASE NEW.status
    WHEN 'validated' THEN 'escalado, validado'
    WHEN 'standby' THEN 'stand-by'
    WHEN 'allocated' THEN 'alocado'
    ELSE NEW.status END;

  INSERT INTO public.notification_outbox (user_id, title, body, url)
  SELECT a.id,
         'Check-in: ' || coalesce(_nome, 'corretor'),
         coalesce(_nome, 'Corretor') || ' fez check-in no turno ' ||
           to_char(NEW.start_time, 'HH24:MI') || '–' || to_char(NEW.end_time, 'HH24:MI') ||
           ' (' || coalesce(_local, 'Plantão') || ') · ' || _situacao ||
           coalesce(' · equipe ' || _equipe, '') || '.',
         '/checkin'
    FROM public.profiles a
   WHERE a.role = 'admin' AND a.is_active AND a.id <> NEW.broker_id;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.roulette_checkin_notify_admin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS roulette_checkin_notify_admin ON public.roulette_checkins;
CREATE TRIGGER roulette_checkin_notify_admin AFTER INSERT ON public.roulette_checkins
  FOR EACH ROW EXECUTE FUNCTION public.roulette_checkin_notify_admin();
