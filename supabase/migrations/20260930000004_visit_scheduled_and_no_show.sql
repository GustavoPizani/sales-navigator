-- Automação de etapas pelos agendamentos de visita:
--   agendou visita pelo lead      → lead vai para "Visita agendada"
--   marcou "visita realizada"     → lead vai para "Visita realizada" (já existia)
--   marcou "visita não realizada" → lead volta para "Em contato"
-- Em nenhum caso um lead que já está em Proposta/Venda (ou encerrado) é movido.

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS visit_status TEXT
  CHECK (visit_status IN ('done', 'not_done'));

-- Move o lead para a etapa de função _kind, se o lead estiver ativo e a etapa
-- atual estiver dentro do intervalo de ordem permitido [_min_order, _max_order].
CREATE OR REPLACE FUNCTION public.crm_move_lead_to_kind(_lead_id UUID, _kind TEXT, _min_order INT, _max_order INT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _lead public.leads%ROWTYPE;
  _target UUID;
  _current_order INT;
BEGIN
  SELECT * INTO _lead FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND OR _lead.status <> 'active' THEN RETURN false; END IF;
  SELECT id INTO _target FROM public.funnel_stages WHERE funnel_id = _lead.funnel_id AND kind = _kind;
  SELECT sort_order INTO _current_order FROM public.funnel_stages WHERE id = _lead.stage_id;
  IF _target IS NULL OR _target = _lead.stage_id OR _current_order < _min_order OR _current_order > _max_order THEN
    RETURN false;
  END IF;
  UPDATE public.leads SET stage_id = _target WHERE id = _lead_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_move_lead_to_kind(UUID, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_stage_order(_funnel_id UUID, _kind TEXT)
RETURNS INT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sort_order FROM public.funnel_stages WHERE funnel_id = _funnel_id AND kind = _kind;
$$;
REVOKE ALL ON FUNCTION public.crm_stage_order(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Valida o agendamento e a permissão de quem marca a visita (dono do
-- agendamento ou quem enxerga o lead) e devolve o id do lead.
CREATE OR REPLACE FUNCTION public.crm_visit_lead_id(p_appointment_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _owner UUID;
  _lead_id UUID;
  _broker UUID;
BEGIN
  SELECT owner_id, lead_id INTO _owner, _lead_id FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF _lead_id IS NULL THEN
    RAISE EXCEPTION 'Este agendamento não está vinculado a um lead. Agende a visita pela página do lead.';
  END IF;
  SELECT broker_id INTO _broker FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado.'; END IF;
  IF NOT (_owner = auth.uid() OR public.crm_can_access_broker(_broker)) THEN
    RAISE EXCEPTION 'Sem permissão para registrar esta visita.' USING ERRCODE = '42501';
  END IF;
  RETURN _lead_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_visit_lead_id(UUID) FROM PUBLIC, anon, authenticated;

-- ── Agendou visita pelo lead → "Visita agendada" ────────────────────────────
CREATE OR REPLACE FUNCTION public.appointments_after_insert_lead()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _lead public.leads%ROWTYPE;
BEGIN
  IF NEW.lead_id IS NULL OR NEW.type <> 'visit' THEN RETURN NULL; END IF;
  SELECT * INTO _lead FROM public.leads WHERE id = NEW.lead_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO public.lead_notes (lead_id, author_id, kind, content)
  VALUES (NEW.lead_id, auth.uid(), 'system',
          format('Visita agendada para %s às %s', to_char(NEW.date, 'DD/MM/YYYY'), to_char(NEW.start_time, 'HH24:MI')));

  -- avança só quem está antes de "Visita agendada"
  PERFORM public.crm_move_lead_to_kind(
    NEW.lead_id, 'visit_scheduled', -2147483648,
    coalesce(public.crm_stage_order(_lead.funnel_id, 'visit_scheduled') - 1, -2147483648));
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS appointments_after_insert_lead ON public.appointments;
CREATE TRIGGER appointments_after_insert_lead AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.appointments_after_insert_lead();

-- ── Visita realizada ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_mark_visit_done(p_appointment_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _appt public.appointments%ROWTYPE;
  _lead public.leads%ROWTYPE;
  _produto TEXT;
BEGIN
  SELECT * INTO _lead FROM public.leads WHERE id = public.crm_visit_lead_id(p_appointment_id);
  SELECT * INTO _appt FROM public.appointments WHERE id = p_appointment_id;

  SELECT name INTO _produto FROM public.projects WHERE id = coalesce(_appt.project_id, _lead.project_id);

  UPDATE public.appointments SET visit_status = 'done' WHERE id = _appt.id;

  INSERT INTO public.visitas (lead_id, appointment_id, broker_id, id_cliente, nome_cliente, produto, data_visita)
  VALUES (_lead.id, _appt.id, _lead.broker_id, _lead.client_code, _lead.full_name, _produto, _appt.date)
  ON CONFLICT DO NOTHING;

  IF FOUND THEN
    INSERT INTO public.lead_notes (lead_id, author_id, kind, content)
    VALUES (_lead.id, auth.uid(), 'system',
            format('Visita realizada em %s%s', to_char(_appt.date, 'DD/MM/YYYY'), coalesce(' — ' || _produto, '')));
  END IF;

  -- avança só quem está antes de "Visita realizada"
  PERFORM public.crm_move_lead_to_kind(
    _lead.id, 'visit_done', -2147483648,
    coalesce(public.crm_stage_order(_lead.funnel_id, 'visit_done') - 1, -2147483648));
END;
$$;

-- ── Visita não realizada → volta para "Em contato" ──────────────────────────
CREATE OR REPLACE FUNCTION public.crm_mark_visit_not_done(p_appointment_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _appt public.appointments%ROWTYPE;
  _lead public.leads%ROWTYPE;
BEGIN
  SELECT * INTO _lead FROM public.leads WHERE id = public.crm_visit_lead_id(p_appointment_id);
  SELECT * INTO _appt FROM public.appointments WHERE id = p_appointment_id;

  UPDATE public.appointments SET visit_status = 'not_done' WHERE id = _appt.id;
  -- se estava marcada como realizada, desfaz o registro da visita
  DELETE FROM public.visitas WHERE appointment_id = _appt.id;

  INSERT INTO public.lead_notes (lead_id, author_id, kind, content)
  VALUES (_lead.id, auth.uid(), 'system',
          format('Visita de %s não realizada', to_char(_appt.date, 'DD/MM/YYYY')));

  -- volta só quem está entre "Visita agendada" e "Visita realizada"
  PERFORM public.crm_move_lead_to_kind(
    _lead.id, 'contact',
    coalesce(public.crm_stage_order(_lead.funnel_id, 'visit_scheduled'), 2147483647),
    coalesce(public.crm_stage_order(_lead.funnel_id, 'visit_done'), -2147483648));
END;
$$;

REVOKE ALL ON FUNCTION public.crm_mark_visit_done(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_mark_visit_not_done(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_mark_visit_done(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_mark_visit_not_done(UUID) TO authenticated;
