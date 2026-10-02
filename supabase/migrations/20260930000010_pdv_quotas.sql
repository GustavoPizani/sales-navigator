-- PDVs e cotas de vagas por gerente.
--
-- Sempre 2 PDVs: a Central (endereço editável) e o Plantão de um produto
-- específico (imóvel escolhido pelo admin, também trocável). Na escala:
-- modalidade 'online' = Central, 'salao' = Plantão do produto.
-- O admin define as vagas de cada gerente por PDV, dia e turno; o gerente só
-- distribui os corretores nessas vagas (link ou escala manual).

-- ── PDV Plantão = produto ───────────────────────────────────────────────────
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE public.roulette_settings
  ADD COLUMN IF NOT EXISTS plantao_project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

-- Rótulos com o nome do produto: "Plantão Eterno", "do Plantão Eterno"...
CREATE OR REPLACE FUNCTION public.crm_plantao_name()
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce('Plantão ' || p.name, 'Plantão')
  FROM public.roulette_settings s LEFT JOIN public.projects p ON p.id = s.plantao_project_id
  WHERE s.id = 1;
$$;
CREATE OR REPLACE FUNCTION public.crm_location_label(_loc TEXT)
RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT CASE _loc WHEN 'plantao' THEN public.crm_plantao_name() ELSE 'Central' END;
$$;
CREATE OR REPLACE FUNCTION public.crm_location_of(_loc TEXT)
RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT CASE _loc WHEN 'plantao' THEN 'do ' || public.crm_plantao_name() ELSE 'da Central' END;
$$;
CREATE OR REPLACE FUNCTION public.crm_location_in(_loc TEXT)
RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT CASE _loc WHEN 'plantao' THEN 'no ' || public.crm_plantao_name() ELSE 'na Central' END;
$$;

-- ── Uma configuração por gerente/semana/PDV; um registro por dia/turno ──────
CREATE UNIQUE INDEX IF NOT EXISTS shift_configs_one_per_week
  ON public.shift_configs (manager_id, week_start_date, modality);
CREATE UNIQUE INDEX IF NOT EXISTS shift_slots_one_per_period
  ON public.shift_slots (config_id, date, period);

-- ── Gerente só lê as cotas (quem define é o admin) ──────────────────────────
DROP POLICY IF EXISTS "shift_configs_manager_own" ON public.shift_configs;
DROP POLICY IF EXISTS "shift_configs_manager_read" ON public.shift_configs;
CREATE POLICY "shift_configs_manager_read" ON public.shift_configs
  FOR SELECT TO authenticated
  USING (public.is_manager(auth.uid()) AND manager_id = auth.uid());

DROP POLICY IF EXISTS "shift_slots_manager_own" ON public.shift_slots;
DROP POLICY IF EXISTS "shift_slots_manager_read" ON public.shift_slots;
CREATE POLICY "shift_slots_manager_read" ON public.shift_slots
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shift_configs sc
                 WHERE sc.id = config_id AND sc.manager_id = auth.uid() AND public.is_manager(auth.uid())));

-- ── Capacidade nunca é ultrapassada (link, escala manual, importação) ───────
CREATE OR REPLACE FUNCTION public.shifts_enforce_slot_capacity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cap INT;
  _used INT;
BEGIN
  IF NEW.slot_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.slot_id IS NOT DISTINCT FROM OLD.slot_id) THEN
    RETURN NEW;
  END IF;
  SELECT capacity INTO _cap FROM public.shift_slots WHERE id = NEW.slot_id FOR UPDATE;
  SELECT count(*) INTO _used FROM public.shifts WHERE slot_id = NEW.slot_id AND id <> NEW.id;
  IF _used >= coalesce(_cap, 0) THEN
    RAISE EXCEPTION 'Vagas esgotadas para esse turno.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS shifts_enforce_slot_capacity ON public.shifts;
CREATE TRIGGER shifts_enforce_slot_capacity BEFORE INSERT OR UPDATE OF slot_id ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_enforce_slot_capacity();

-- ── Admin define as vagas de um gerente na semana ───────────────────────────
-- p_quota: [{ "modality": "online"|"salao", "date": "AAAA-MM-DD", "period": "Manhã",
--             "start": "09:00", "end": "14:00", "capacity": 3 }, ...]
-- Envie a grade completa da semana (inclusive zeros): vaga com 0 e sem ninguém
-- escalado é removida; não dá para reduzir abaixo do número de já escalados.
CREATE OR REPLACE FUNCTION public.crm_set_team_quota(p_manager_id UUID, p_week_start DATE, p_quota JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _q JSONB;
  _cfg UUID;
  _slot public.shift_slots%ROWTYPE;
  _cap INT;
  _used INT;
  _saved INT := 0;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Somente o administrador define as vagas das equipes.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_manager_id AND role = 'master') THEN
    RAISE EXCEPTION 'Gerente inválido.';
  END IF;

  FOR _q IN SELECT * FROM jsonb_array_elements(p_quota) LOOP
    IF (_q->>'modality') NOT IN ('online', 'salao') THEN RAISE EXCEPTION 'PDV inválido.'; END IF;
    _cap := GREATEST(0, coalesce((_q->>'capacity')::int, 0));

    SELECT id INTO _cfg FROM public.shift_configs
     WHERE manager_id = p_manager_id AND week_start_date = p_week_start AND modality = _q->>'modality';
    IF _cfg IS NULL THEN
      IF _cap = 0 THEN CONTINUE; END IF;
      INSERT INTO public.shift_configs (manager_id, week_start_date, modality, link_token)
      VALUES (p_manager_id, p_week_start, _q->>'modality',
              replace(gen_random_uuid()::text, '-', '') || to_char(clock_timestamp(), 'SSMS'))
      RETURNING id INTO _cfg;
    END IF;

    SELECT * INTO _slot FROM public.shift_slots
     WHERE config_id = _cfg AND date = (_q->>'date')::date AND period = _q->>'period' FOR UPDATE;

    IF _slot.id IS NULL THEN
      IF _cap > 0 THEN
        INSERT INTO public.shift_slots (config_id, date, period, capacity, start_time, end_time)
        VALUES (_cfg, (_q->>'date')::date, _q->>'period', _cap, (_q->>'start')::time, (_q->>'end')::time);
        _saved := _saved + 1;
      END IF;
    ELSE
      SELECT count(*) INTO _used FROM public.shifts WHERE slot_id = _slot.id;
      IF _cap < _used THEN
        RAISE EXCEPTION 'Em % (%), já há % corretor(es) escalado(s); não dá para deixar % vaga(s).',
          to_char((_q->>'date')::date, 'DD/MM'), _q->>'period', _used, _cap;
      END IF;
      IF _cap = 0 THEN
        DELETE FROM public.shift_slots WHERE id = _slot.id;
      ELSE
        UPDATE public.shift_slots SET capacity = _cap WHERE id = _slot.id;
        _saved := _saved + 1;
      END IF;
    END IF;
    _slot := NULL;
    _cfg := NULL;
  END LOOP;

  RETURN jsonb_build_object('slots', _saved);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_set_team_quota(UUID, DATE, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_set_team_quota(UUID, DATE, JSONB) TO authenticated;
