-- Vagas por turno: o admin define só o TOTAL de vagas de cada gerente por dia
-- e turno. Quem decide quantas ficam na Central e quantas no Plantão é o
-- gerente, ao escalar cada corretor em um PDV.
--
-- As vagas por PDV (shift_slots) continuam existindo — a roleta e o check-in
-- dependem delas —, mas a capacidade de cada uma passa a ser calculada:
--   Plantão = quantos o gerente escalou no Plantão
--   Central = total do turno − Plantão   (as vagas ainda livres ficam na Central)

CREATE TABLE IF NOT EXISTS public.team_period_quotas (
  manager_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  period TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  total INT NOT NULL CHECK (total > 0),
  PRIMARY KEY (manager_id, date, period)
);
ALTER TABLE public.team_period_quotas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "team_period_quotas_read" ON public.team_period_quotas;
CREATE POLICY "team_period_quotas_read" ON public.team_period_quotas FOR SELECT TO authenticated
  USING (public.crm_can('schedule', 'view') OR public.crm_can('checkin', 'view'));
GRANT SELECT ON public.team_period_quotas TO authenticated;

-- Escalados no turno de uma equipe, somando os dois PDVs (cadastrados + pré-cadastrados).
CREATE OR REPLACE FUNCTION public.crm_period_used(_manager UUID, _date DATE, _period TEXT, _except_shift UUID DEFAULT NULL)
RETURNS INT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (
    (SELECT count(*) FROM public.shifts sh
       JOIN public.shift_slots ss ON ss.id = sh.slot_id
       JOIN public.shift_configs sc ON sc.id = ss.config_id
      WHERE sc.manager_id = _manager AND ss.date = _date AND ss.period = _period
        AND (_except_shift IS NULL OR sh.id <> _except_shift))
    +
    (SELECT count(*) FROM public.pending_shifts ps
       JOIN public.shift_slots ss ON ss.id = ps.slot_id
       JOIN public.shift_configs sc ON sc.id = ss.config_id
      WHERE sc.manager_id = _manager AND ss.date = _date AND ss.period = _period)
  )::int;
$$;
REVOKE ALL ON FUNCTION public.crm_period_used(UUID, DATE, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_period_used(UUID, DATE, TEXT, UUID) TO authenticated;

-- Recalcula a capacidade das duas vagas (Central / Plantão) de um turno.
CREATE OR REPLACE FUNCTION public.crm_rebalance_period(_manager UUID, _date DATE, _period TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _total INT;
  _plantao INT;
BEGIN
  SELECT total INTO _total FROM public.team_period_quotas
   WHERE manager_id = _manager AND date = _date AND period = _period;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT (SELECT count(*) FROM public.shifts sh WHERE sh.slot_id = ss.id)
       + (SELECT count(*) FROM public.pending_shifts ps WHERE ps.slot_id = ss.id)
    INTO _plantao
    FROM public.shift_slots ss JOIN public.shift_configs sc ON sc.id = ss.config_id
   WHERE sc.manager_id = _manager AND sc.modality = 'salao' AND ss.date = _date AND ss.period = _period;
  _plantao := LEAST(coalesce(_plantao, 0), _total);

  UPDATE public.shift_slots ss
     SET capacity = CASE WHEN sc.modality = 'salao' THEN _plantao ELSE _total - _plantao END
    FROM public.shift_configs sc
   WHERE sc.id = ss.config_id AND sc.manager_id = _manager AND ss.date = _date AND ss.period = _period
     AND ss.capacity IS DISTINCT FROM (CASE WHEN sc.modality = 'salao' THEN _plantao ELSE _total - _plantao END);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_rebalance_period(UUID, DATE, TEXT) FROM PUBLIC, anon, authenticated;

-- ── O limite é o total do turno (os dois PDVs somados) ──────────────────────
CREATE OR REPLACE FUNCTION public.shifts_enforce_slot_capacity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cap INT;
  _mgr UUID;
  _date DATE;
  _period TEXT;
  _total INT;
  _used INT;
BEGIN
  IF NEW.slot_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.slot_id IS NOT DISTINCT FROM OLD.slot_id) THEN
    RETURN NEW;
  END IF;
  SELECT ss.capacity, sc.manager_id, ss.date, ss.period INTO _cap, _mgr, _date, _period
    FROM public.shift_slots ss JOIN public.shift_configs sc ON sc.id = ss.config_id
   WHERE ss.id = NEW.slot_id FOR UPDATE OF ss;
  SELECT total INTO _total FROM public.team_period_quotas
   WHERE manager_id = _mgr AND date = _date AND period = _period FOR UPDATE;
  IF FOUND THEN
    IF public.crm_period_used(_mgr, _date, _period, NEW.id) >= _total THEN
      RAISE EXCEPTION 'Vagas esgotadas para esse turno.';
    END IF;
    RETURN NEW;
  END IF;
  -- vaga antiga, sem total definido: vale a capacidade da própria vaga
  SELECT (SELECT count(*) FROM public.shifts WHERE slot_id = NEW.slot_id AND id <> NEW.id)
       + (SELECT count(*) FROM public.pending_shifts WHERE slot_id = NEW.slot_id) INTO _used;
  IF _used >= coalesce(_cap, 0) THEN
    RAISE EXCEPTION 'Vagas esgotadas para esse turno.';
  END IF;
  RETURN NEW;
END;
$$;

-- Depois de escalar/remover alguém, a divisão Central/Plantão é recalculada.
CREATE OR REPLACE FUNCTION public.shifts_rebalance_period()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _slot UUID;
  _r RECORD;
BEGIN
  FOREACH _slot IN ARRAY ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.slot_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.slot_id END
  ] LOOP
    IF _slot IS NULL THEN CONTINUE; END IF;
    SELECT sc.manager_id, ss.date, ss.period INTO _r
      FROM public.shift_slots ss JOIN public.shift_configs sc ON sc.id = ss.config_id
     WHERE ss.id = _slot;
    IF FOUND THEN PERFORM public.crm_rebalance_period(_r.manager_id, _r.date, _r.period); END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS shifts_rebalance_period ON public.shifts;
CREATE TRIGGER shifts_rebalance_period AFTER INSERT OR DELETE OR UPDATE OF slot_id ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_rebalance_period();
DROP TRIGGER IF EXISTS pending_shifts_rebalance_period ON public.pending_shifts;
CREATE TRIGGER pending_shifts_rebalance_period AFTER INSERT OR DELETE ON public.pending_shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_rebalance_period();

-- ── Admin define o total de vagas de um gerente na semana ───────────────────
-- p_quota: [{ "date": "AAAA-MM-DD", "period": "Manhã", "start": "09:00", "end": "14:00", "capacity": 5 }, ...]
-- Envie a grade completa (inclusive zeros). Não dá para reduzir abaixo do
-- número de corretores já escalados no turno (Central + Plantão).
CREATE OR REPLACE FUNCTION public.crm_set_team_quota(p_manager_id UUID, p_week_start DATE, p_quota JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _q JSONB;
  _date DATE;
  _period TEXT;
  _cap INT;
  _used INT;
  _cfg UUID;
  _mod TEXT;
  _saved INT := 0;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Somente o administrador define as vagas das equipes.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_manager_id AND role = 'master') THEN
    RAISE EXCEPTION 'Gerente inválido.';
  END IF;

  FOR _q IN SELECT * FROM jsonb_array_elements(p_quota) LOOP
    _date := (_q->>'date')::date;
    _period := _q->>'period';
    _cap := GREATEST(0, coalesce((_q->>'capacity')::int, 0));
    _used := public.crm_period_used(p_manager_id, _date, _period);
    IF _cap < _used THEN
      RAISE EXCEPTION 'Em % (%), já há % corretor(es) escalado(s); não dá para deixar % vaga(s).',
        to_char(_date, 'DD/MM'), _period, _used, _cap;
    END IF;

    IF _cap = 0 THEN
      DELETE FROM public.team_period_quotas
       WHERE manager_id = p_manager_id AND date = _date AND period = _period;
      DELETE FROM public.shift_slots ss USING public.shift_configs sc
       WHERE sc.id = ss.config_id AND sc.manager_id = p_manager_id AND ss.date = _date AND ss.period = _period;
      CONTINUE;
    END IF;

    INSERT INTO public.team_period_quotas (manager_id, date, period, start_time, end_time, total)
    VALUES (p_manager_id, _date, _period, (_q->>'start')::time, (_q->>'end')::time, _cap)
    ON CONFLICT (manager_id, date, period) DO UPDATE SET total = EXCLUDED.total;

    -- as duas vagas (Central e Plantão) do turno
    FOREACH _mod IN ARRAY ARRAY['online', 'salao'] LOOP
      SELECT id INTO _cfg FROM public.shift_configs
       WHERE manager_id = p_manager_id AND week_start_date = p_week_start AND modality = _mod;
      IF _cfg IS NULL THEN
        INSERT INTO public.shift_configs (manager_id, week_start_date, modality, link_token)
        VALUES (p_manager_id, p_week_start, _mod,
                replace(gen_random_uuid()::text, '-', '') || to_char(clock_timestamp(), 'SSMS'))
        RETURNING id INTO _cfg;
      END IF;
      INSERT INTO public.shift_slots (config_id, date, period, capacity, start_time, end_time)
      VALUES (_cfg, _date, _period, 0, (_q->>'start')::time, (_q->>'end')::time)
      ON CONFLICT (config_id, date, period) DO NOTHING;
      _cfg := NULL;
    END LOOP;

    PERFORM public.crm_rebalance_period(p_manager_id, _date, _period);
    _saved := _saved + 1;
  END LOOP;

  RETURN jsonb_build_object('slots', _saved);
END;
$$;

-- ── Pegar vaga pelo link do corretor: limite pelo total do turno ────────────
CREATE OR REPLACE FUNCTION public.claim_shift_slot(p_slot_id UUID, p_broker_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_slot  public.shift_slots%ROWTYPE;
  v_count INT;
  v_mgr   UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF p_broker_id <> auth.uid() AND NOT public.crm_can_access_broker(p_broker_id) THEN
    RAISE EXCEPTION 'Sem permissão para registrar plantão deste corretor.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_slot FROM public.shift_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vaga não encontrada.'; END IF;

  SELECT manager_id INTO v_mgr FROM public.shift_configs WHERE id = v_slot.config_id;
  IF NOT public.is_admin(auth.uid())
     AND v_mgr IS DISTINCT FROM (SELECT manager_id FROM public.profiles WHERE id = p_broker_id) THEN
    RAISE EXCEPTION 'Esta escala é de outra equipe.' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.shifts WHERE slot_id = p_slot_id AND broker_id = p_broker_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'Você já garantiu esta vaga.'; END IF;

  -- o limite de vagas é conferido por shifts_enforce_slot_capacity
  INSERT INTO public.shifts (broker_id, manager_id, date, start_time, end_time, slot_id)
  VALUES (p_broker_id, v_mgr, v_slot.date, v_slot.start_time, v_slot.end_time, p_slot_id);
END;
$$;

-- capacity = total do turno; claimed_count = escalados nos dois PDVs
CREATE OR REPLACE FUNCTION public.get_shift_config_by_token(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'id', sc.id,
    'week_start_date', sc.week_start_date,
    'modality', sc.modality,
    'link_token', sc.link_token,
    'slots', COALESCE((
      SELECT json_agg(
        json_build_object(
          'id', ss.id,
          'date', ss.date,
          'period', ss.period,
          'capacity', coalesce(q.total, ss.capacity),
          'start_time', ss.start_time,
          'end_time', ss.end_time,
          'claimed_count', CASE WHEN q.total IS NOT NULL
            THEN public.crm_period_used(sc.manager_id, ss.date, ss.period)
            ELSE (SELECT COUNT(*) FROM public.shifts sh WHERE sh.slot_id = ss.id)
               + (SELECT COUNT(*) FROM public.pending_shifts ps WHERE ps.slot_id = ss.id) END
        ) ORDER BY ss.date, ss.start_time
      )
      FROM public.shift_slots ss
      LEFT JOIN public.team_period_quotas q
        ON q.manager_id = sc.manager_id AND q.date = ss.date AND q.period = ss.period
      WHERE ss.config_id = sc.id
    ), '[]'::json)
  )
  INTO v_result
  FROM public.shift_configs sc
  WHERE sc.link_token = p_token;

  RETURN v_result;
END;
$$;

-- ── Link do gerente (sem login) ─────────────────────────────────────────────
-- capacity = total do turno; used_total = escalados nos dois PDVs
CREATE OR REPLACE FUNCTION public.crm_public_schedule(p_token TEXT, p_week DATE DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m UUID := public.crm_schedule_link_manager(p_token);
  _today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _weeks DATE[];
  _week DATE;
BEGIN
  IF _m IS NULL THEN RETURN NULL; END IF;

  SELECT coalesce(array_agg(DISTINCT sc.week_start_date ORDER BY sc.week_start_date), '{}') INTO _weeks
  FROM public.shift_configs sc
  WHERE sc.manager_id = _m AND sc.week_start_date >= date_trunc('week', _today)::date
    AND EXISTS (SELECT 1 FROM public.shift_slots ss WHERE ss.config_id = sc.id);

  IF p_week IS NOT NULL AND p_week = ANY(_weeks) THEN
    _week := p_week;
  ELSE
    SELECT coalesce((SELECT min(w) FROM unnest(_weeks) w WHERE w > _today), _weeks[1]) INTO _week;
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'manager_name', p.full_name,
      'team_name', coalesce(p.team_name, p.full_name),
      'central', public.crm_location_label('central'),
      'plantao', public.crm_location_label('plantao'),
      'weeks', to_jsonb(_weeks),
      'week', _week,
      'brokers', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', pb.id, 'name', pb.full_name) ORDER BY lower(pb.full_name))
        FROM public.pending_brokers pb WHERE pb.manager_id = _m), '[]'::jsonb),
      'slots', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ss.id, 'modality', sc.modality, 'date', ss.date, 'period', ss.period,
          'start_time', ss.start_time, 'end_time', ss.end_time,
          'capacity', coalesce(q.total, ss.capacity),
          'used_total', CASE WHEN q.total IS NOT NULL
            THEN public.crm_period_used(_m, ss.date, ss.period)
            ELSE (SELECT count(*) FROM public.shifts sh WHERE sh.slot_id = ss.id)
               + (SELECT count(*) FROM public.pending_shifts ps WHERE ps.slot_id = ss.id) END,
          'registered', (SELECT count(*) FROM public.shifts sh WHERE sh.slot_id = ss.id),
          'assigned', coalesce((SELECT jsonb_agg(ps.pending_broker_id) FROM public.pending_shifts ps
                                WHERE ps.slot_id = ss.id), '[]'::jsonb)
        ) ORDER BY ss.date, ss.start_time)
        FROM public.shift_slots ss JOIN public.shift_configs sc ON sc.id = ss.config_id
        LEFT JOIN public.team_period_quotas q
          ON q.manager_id = _m AND q.date = ss.date AND q.period = ss.period
        WHERE sc.manager_id = _m AND sc.week_start_date = _week), '[]'::jsonb)
    )
    FROM public.profiles p WHERE p.id = _m
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_public_schedule_assign(p_token TEXT, p_slot_id UUID, p_broker_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m UUID := public.crm_schedule_link_manager(p_token);
  _slot public.shift_slots%ROWTYPE;
  _total INT;
  _used INT;
BEGIN
  IF _m IS NULL THEN RAISE EXCEPTION 'Link inválido.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pending_brokers WHERE id = p_broker_id AND manager_id = _m) THEN
    RAISE EXCEPTION 'Corretor não encontrado.';
  END IF;
  SELECT ss.* INTO _slot FROM public.shift_slots ss
  JOIN public.shift_configs sc ON sc.id = ss.config_id
  WHERE ss.id = p_slot_id AND sc.manager_id = _m FOR UPDATE OF ss;
  IF NOT FOUND THEN RAISE EXCEPTION 'Turno não encontrado.'; END IF;

  IF EXISTS (SELECT 1 FROM public.pending_shifts WHERE slot_id = p_slot_id AND pending_broker_id = p_broker_id) THEN
    RETURN;
  END IF;
  -- o mesmo corretor não fica em dois PDVs no mesmo dia e turno
  IF EXISTS (SELECT 1 FROM public.pending_shifts ps JOIN public.shift_slots s2 ON s2.id = ps.slot_id
             WHERE ps.pending_broker_id = p_broker_id AND s2.date = _slot.date AND s2.period = _slot.period) THEN
    RAISE EXCEPTION 'Esse corretor já está escalado nesse dia e turno. Tire-o do outro PDV primeiro.';
  END IF;

  -- limite: total do turno (Central + Plantão), definido pelo admin
  SELECT total INTO _total FROM public.team_period_quotas
   WHERE manager_id = _m AND date = _slot.date AND period = _slot.period FOR UPDATE;
  IF FOUND THEN
    _used := public.crm_period_used(_m, _slot.date, _slot.period);
  ELSE
    _total := _slot.capacity;
    SELECT (SELECT count(*) FROM public.shifts WHERE slot_id = p_slot_id)
         + (SELECT count(*) FROM public.pending_shifts WHERE slot_id = p_slot_id) INTO _used;
  END IF;
  IF _used >= _total THEN
    RAISE EXCEPTION 'Vagas esgotadas para esse turno.';
  END IF;
  INSERT INTO public.pending_shifts (slot_id, pending_broker_id) VALUES (p_slot_id, p_broker_id);
END;
$$;

-- ── Mudança de horário de turno também acompanha o total de vagas ───────────
CREATE OR REPLACE FUNCTION public.roulette_settings_sync_periods()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _p RECORD;
BEGIN
  FOR _p IN
    SELECT * FROM (VALUES
      ('Manhã', OLD.manha_start, OLD.manha_end, NEW.manha_start, NEW.manha_end),
      ('Tarde', OLD.tarde_start, OLD.tarde_end, NEW.tarde_start, NEW.tarde_end),
      ('Noite', OLD.noite_start, OLD.noite_end, NEW.noite_start, NEW.noite_end)
    ) AS v(period, old_start, old_end, new_start, new_end)
    WHERE v.old_start <> v.new_start OR v.old_end <> v.new_end
  LOOP
    UPDATE public.shifts sh
       SET start_time = _p.new_start, end_time = _p.new_end
      FROM public.shift_slots ss
     WHERE sh.slot_id = ss.id AND ss.period = _p.period AND ss.date > _today;
    UPDATE public.shift_slots
       SET start_time = _p.new_start, end_time = _p.new_end
     WHERE period = _p.period AND date > _today;
    UPDATE public.team_period_quotas
       SET start_time = _p.new_start, end_time = _p.new_end
     WHERE period = _p.period AND date > _today;
  END LOOP;
  RETURN NULL;
END;
$$;

-- ── Vagas que já existiam (por PDV) viram total do turno ────────────────────
INSERT INTO public.team_period_quotas (manager_id, date, period, start_time, end_time, total)
SELECT sc.manager_id, ss.date, ss.period, min(ss.start_time), max(ss.end_time), sum(ss.capacity)
  FROM public.shift_slots ss JOIN public.shift_configs sc ON sc.id = ss.config_id
 WHERE sc.manager_id IS NOT NULL
 GROUP BY sc.manager_id, ss.date, ss.period
HAVING sum(ss.capacity) > 0
ON CONFLICT (manager_id, date, period) DO NOTHING;

DO $$
DECLARE
  _q RECORD;
  _mod TEXT;
  _cfg UUID;
  _week DATE;
BEGIN
  FOR _q IN SELECT * FROM public.team_period_quotas LOOP
    _week := date_trunc('week', _q.date)::date;
    FOREACH _mod IN ARRAY ARRAY['online', 'salao'] LOOP
      SELECT id INTO _cfg FROM public.shift_configs
       WHERE manager_id = _q.manager_id AND week_start_date = _week AND modality = _mod;
      IF _cfg IS NULL THEN
        INSERT INTO public.shift_configs (manager_id, week_start_date, modality, link_token)
        VALUES (_q.manager_id, _week, _mod,
                replace(gen_random_uuid()::text, '-', '') || to_char(clock_timestamp(), 'SSMS'))
        RETURNING id INTO _cfg;
      END IF;
      INSERT INTO public.shift_slots (config_id, date, period, capacity, start_time, end_time)
      VALUES (_cfg, _q.date, _q.period, 0, _q.start_time, _q.end_time)
      ON CONFLICT (config_id, date, period) DO NOTHING;
      _cfg := NULL;
    END LOOP;
    PERFORM public.crm_rebalance_period(_q.manager_id, _q.date, _q.period);
  END LOOP;
END;
$$;
