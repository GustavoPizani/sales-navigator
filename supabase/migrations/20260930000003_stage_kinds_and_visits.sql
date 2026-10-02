-- Função fixa de cada etapa (independente do nome exibido), novos nomes das
-- etapas do funil padrão e registro de "visita realizada" a partir do
-- agendamento, que move o lead automaticamente.

-- ── Função da etapa ─────────────────────────────────────────────────────────
-- new = Cliente novo | contact = Em contato | visit_scheduled = Visita agendada
-- visit_done = Visita realizada | proposal = Proposta | sale = Venda
ALTER TABLE public.funnel_stages ADD COLUMN IF NOT EXISTS kind TEXT
  CHECK (kind IN ('new', 'contact', 'visit_scheduled', 'visit_done', 'proposal', 'sale'));
CREATE UNIQUE INDEX IF NOT EXISTS funnel_stages_kind_per_funnel
  ON public.funnel_stages (funnel_id, kind) WHERE kind IS NOT NULL;

UPDATE public.funnel_stages SET kind = 'new',             name = 'Cliente novo'     WHERE kind IS NULL AND name = 'Contato';
UPDATE public.funnel_stages SET kind = 'contact',         name = 'Em contato'       WHERE kind IS NULL AND name = 'Qualificação';
UPDATE public.funnel_stages SET kind = 'visit_scheduled', name = 'Visita agendada'  WHERE kind IS NULL AND name = 'Agendamento';
UPDATE public.funnel_stages SET kind = 'visit_done',      name = 'Visita realizada' WHERE kind IS NULL AND name = 'Visita';
UPDATE public.funnel_stages SET kind = 'proposal'                                   WHERE kind IS NULL AND name = 'Proposta';
UPDATE public.funnel_stages SET kind = 'sale'                                       WHERE kind IS NULL AND name = 'Venda';

-- ── Visitas vinculadas ao lead ──────────────────────────────────────────────
ALTER TABLE public.visitas
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS visitas_lead_idx ON public.visitas (lead_id);
-- um agendamento gera no máximo uma visita
CREATE UNIQUE INDEX IF NOT EXISTS visitas_one_per_appointment
  ON public.visitas (appointment_id) WHERE appointment_id IS NOT NULL;

-- Quem enxerga o lead enxerga as visitas dele (gestores em qualquer camada).
DROP POLICY IF EXISTS "visitas_lead_hierarchy_read" ON public.visitas;
CREATE POLICY "visitas_lead_hierarchy_read" ON public.visitas
  FOR SELECT TO authenticated
  USING (public.crm_can_access_broker(broker_id));

-- ── Marcar agendamento como visita realizada ────────────────────────────────
-- Registra a visita (uma por agendamento) e, se o lead ainda está antes da
-- etapa "Visita realizada", move-o para ela. Nunca retrocede o lead.
CREATE OR REPLACE FUNCTION public.crm_mark_visit_done(p_appointment_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _appt public.appointments%ROWTYPE;
  _lead public.leads%ROWTYPE;
  _target public.funnel_stages%ROWTYPE;
  _current_order INT;
  _produto TEXT;
BEGIN
  SELECT * INTO _appt FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF _appt.lead_id IS NULL THEN
    RAISE EXCEPTION 'Este agendamento não está vinculado a um lead. Agende a visita pela página do lead.';
  END IF;

  SELECT * INTO _lead FROM public.leads WHERE id = _appt.lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado.'; END IF;

  IF NOT (_appt.owner_id = auth.uid() OR public.crm_can_access_broker(_lead.broker_id)) THEN
    RAISE EXCEPTION 'Sem permissão para registrar esta visita.' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO _produto FROM public.projects WHERE id = coalesce(_appt.project_id, _lead.project_id);

  INSERT INTO public.visitas (lead_id, appointment_id, broker_id, id_cliente, nome_cliente, produto, data_visita)
  VALUES (_lead.id, _appt.id, _lead.broker_id, _lead.client_code, _lead.full_name, _produto, _appt.date)
  ON CONFLICT DO NOTHING;

  IF FOUND THEN
    INSERT INTO public.lead_notes (lead_id, author_id, kind, content)
    VALUES (_lead.id, auth.uid(), 'system',
            format('Visita realizada em %s%s', to_char(_appt.date, 'DD/MM/YYYY'), coalesce(' — ' || _produto, '')));
  END IF;

  SELECT * INTO _target FROM public.funnel_stages WHERE funnel_id = _lead.funnel_id AND kind = 'visit_done';
  SELECT sort_order INTO _current_order FROM public.funnel_stages WHERE id = _lead.stage_id;
  IF _target.id IS NOT NULL AND _lead.status = 'active' AND _current_order < _target.sort_order THEN
    UPDATE public.leads SET stage_id = _target.id WHERE id = _lead.id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_mark_visit_done(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_mark_visit_done(UUID) TO authenticated;
