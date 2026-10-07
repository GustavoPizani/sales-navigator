-- Ajuste do log de check-ins: só o admin.
--
-- Antes, o RH também podia registrar ajustes. Agora o RH continua lendo o log
-- e exportando relatórios, mas só o admin corrige (presença/falta, horário,
-- justificativa). O registro original segue imutável.
-- Pode rodar de novo sem erro.

CREATE OR REPLACE FUNCTION public.crm_checkin_log_adjust(
  p_log_id UUID,
  p_justification TEXT,
  p_event_override TEXT DEFAULT NULL,
  p_occurred_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _o public.checkin_log%ROWTYPE;
  _id UUID;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Somente o ADM pode ajustar o log de check-ins.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(p_justification), '') = '' THEN
    RAISE EXCEPTION 'Informe a justificativa do ajuste.';
  END IF;
  IF p_event_override IS NOT NULL AND p_event_override NOT IN ('presente', 'falta') THEN
    RAISE EXCEPTION 'Ajuste inválido.';
  END IF;
  SELECT * INTO _o FROM public.checkin_log WHERE id = p_log_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado.'; END IF;

  INSERT INTO public.checkin_log
    (occurred_at, turn_date, start_time, end_time, user_id, user_name, team_manager_id, team_name, event,
     location, location_label, adjusts_id, event_override, justification, created_by, created_by_name)
  VALUES
    (coalesce(p_occurred_at, _o.occurred_at), _o.turn_date, _o.start_time, _o.end_time, _o.user_id, _o.user_name,
     _o.team_manager_id, _o.team_name, 'ajuste', _o.location, _o.location_label,
     coalesce(_o.adjusts_id, _o.id), p_event_override, trim(p_justification), auth.uid(),
     (SELECT full_name FROM public.profiles WHERE id = auth.uid()))
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_checkin_log_adjust(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_checkin_log_adjust(UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
