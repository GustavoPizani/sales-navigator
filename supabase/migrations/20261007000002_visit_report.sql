-- Relatório de visitas realizadas.
--
-- O admin envia um link geral aos corretores. Cada corretor (logado) informa
-- o ID do cliente, o produto visitado e uma observação. O sistema:
--   * cria o compromisso no calendário do corretor, já como visita realizada;
--   * registra a visita (conta nos dashboards);
--   * se o ID for de um lead do próprio corretor, vincula ao lead, grava a
--     observação no histórico e avança o lead para "Visita realizada".
-- Só corretores preenchem. O admin (e o gerente, da própria equipe) vê quem
-- preencheu e quando: appointments.reported_at marca as visitas relatadas.

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS appointments_reported_idx ON public.appointments (reported_at DESC)
  WHERE reported_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_report_visit(
  p_client_code TEXT,
  p_project_id UUID,
  p_note TEXT DEFAULT NULL,
  p_date DATE DEFAULT NULL,
  p_time TIME DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _me public.profiles%ROWTYPE;
  _code TEXT := trim(coalesce(p_client_code, ''));
  _note TEXT := nullif(trim(coalesce(p_note, '')), '');
  _now TIMESTAMP := (now() AT TIME ZONE 'America/Sao_Paulo');
  _date DATE := coalesce(p_date, _now::date);
  _start TIME := coalesce(p_time, date_trunc('minute', _now)::time);
  _end TIME;
  _produto TEXT;
  _lead public.leads%ROWTYPE;
  _appt UUID;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT * INTO _me FROM public.profiles WHERE id = _uid;
  IF NOT FOUND OR NOT _me.is_active THEN RAISE EXCEPTION 'Conta inativa.'; END IF;
  IF _me.role <> 'broker' THEN
    RAISE EXCEPTION 'Só corretores registram visitas no relatório.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.crm_can('appointments', 'edit') THEN
    RAISE EXCEPTION 'Seu cargo não tem permissão para registrar visitas.' USING ERRCODE = '42501';
  END IF;
  IF _code = '' THEN RAISE EXCEPTION 'Informe o ID do cliente.'; END IF;
  IF length(_code) > 60 THEN RAISE EXCEPTION 'ID do cliente muito longo.'; END IF;
  IF _date > _now::date THEN RAISE EXCEPTION 'A visita realizada não pode ter data futura.'; END IF;
  IF _date < _now::date - 60 THEN RAISE EXCEPTION 'Só é possível relatar visitas dos últimos 60 dias.'; END IF;

  SELECT name INTO _produto FROM public.projects WHERE id = p_project_id AND is_active;
  IF _produto IS NULL THEN RAISE EXCEPTION 'Escolha o produto da visita.'; END IF;

  -- mesma visita relatada duas vezes (mesmo cliente, produto e dia)
  IF EXISTS (SELECT 1 FROM public.appointments
              WHERE owner_id = _uid AND client_id = _code AND project_id = p_project_id
                AND date = _date AND visit_status = 'done') THEN
    RAISE EXCEPTION 'Você já relatou a visita desse cliente a esse produto nesse dia.';
  END IF;

  -- lead do próprio corretor com esse ID (o mais recente, se houver mais de um)
  SELECT * INTO _lead FROM public.leads
   WHERE broker_id = _uid AND lower(client_code) = lower(_code)
   ORDER BY created_at DESC LIMIT 1;

  _end := CASE WHEN _start >= TIME '23:00' THEN TIME '23:59' ELSE _start + interval '1 hour' END;

  INSERT INTO public.appointments
    (owner_id, title, date, start_time, end_time, type, project_id, client_id, client_name,
     lead_id, description, visit_status, include_manager, reported_at)
  VALUES
    (_uid, 'Visita realizada — ' || _produto, _date, _start, _end, 'visit', p_project_id, _code,
     _lead.full_name, _lead.id, _note, 'done', false, now())
  RETURNING id INTO _appt;

  INSERT INTO public.visitas (lead_id, appointment_id, broker_id, id_cliente, nome_cliente, produto, data_visita)
  VALUES (_lead.id, _appt, _uid, _code, _lead.full_name, _produto, _date)
  ON CONFLICT DO NOTHING;

  IF _lead.id IS NOT NULL THEN
    INSERT INTO public.lead_notes (lead_id, author_id, kind, content)
    VALUES (_lead.id, _uid, 'system',
            format('Visita realizada em %s — %s (relatório de visitas)', to_char(_date, 'DD/MM/YYYY'), _produto));
    IF _note IS NOT NULL THEN
      INSERT INTO public.lead_notes (lead_id, author_id, kind, content) VALUES (_lead.id, _uid, 'note', _note);
    END IF;
    -- avança só quem está antes de "Visita realizada"
    PERFORM public.crm_move_lead_to_kind(
      _lead.id, 'visit_done', -2147483648,
      coalesce(public.crm_stage_order(_lead.funnel_id, 'visit_done') - 1, -2147483648));
  END IF;

  RETURN jsonb_build_object(
    'appointment_id', _appt,
    'linked', _lead.id IS NOT NULL,
    'lead_name', _lead.full_name,
    'produto', _produto,
    'date', _date);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_report_visit(TEXT, UUID, TEXT, DATE, TIME) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_report_visit(TEXT, UUID, TEXT, DATE, TIME) TO authenticated;

-- A visita relatada já entra como realizada: não deve registrar "Visita
-- agendada" no lead nem recuá-lo para essa etapa.
CREATE OR REPLACE FUNCTION public.appointments_after_insert_lead()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _lead public.leads%ROWTYPE;
BEGIN
  IF NEW.lead_id IS NULL OR NEW.type <> 'visit' OR NEW.visit_status = 'done' THEN RETURN NULL; END IF;
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

-- Visitas da conta de teste não aparecem para os outros usuários.
DROP POLICY IF EXISTS "test_visitas_hidden" ON public.visitas;
CREATE POLICY "test_visitas_hidden" ON public.visitas AS RESTRICTIVE FOR SELECT TO authenticated
  USING (broker_id = auth.uid() OR NOT public.crm_is_test(broker_id));
