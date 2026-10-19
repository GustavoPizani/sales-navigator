-- Vagas padrão por turno: o admin define UM número de vagas por turno (Manhã,
-- Tarde, Noite) que vale para TODAS as equipes, TODOS os dias e TODA semana,
-- até ser mudado. Substitui a grade por equipe × dia × semana.
--
-- A escala, os links e o check-in continuam lendo team_period_quotas e
-- shift_slots: as semanas são preenchidas a partir da regra (agora e sempre que
-- alguém abre uma semana da escala). Nunca corta quem já está escalado: se um
-- turno já tem mais gente do que a nova regra, ele fica com esse número.
-- Pode rodar de novo sem erro.

CREATE TABLE IF NOT EXISTS public.crm_vagas_padrao (
  period TEXT PRIMARY KEY,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  total INT NOT NULL DEFAULT 0 CHECK (total >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_vagas_padrao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crm_vagas_padrao_read" ON public.crm_vagas_padrao;
CREATE POLICY "crm_vagas_padrao_read" ON public.crm_vagas_padrao FOR SELECT TO authenticated
  USING (public.crm_can('schedule', 'view') OR public.crm_can('checkin', 'view'));
GRANT SELECT ON public.crm_vagas_padrao TO authenticated;

-- Aplica a regra numa semana (segunda-feira), para todas as equipes ativas.
-- Semanas que já passaram não mudam.
CREATE OR REPLACE FUNCTION public.crm_aplicar_vagas_padrao(p_week_start DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _mgr UUID;
  _r RECORD;
  _d INT;
  _date DATE;
  _used INT;
  _cap INT;
  _cfg UUID;
  _mod TEXT;
  _feitos INT := 0;
BEGIN
  IF NOT (public.crm_can('schedule', 'view') OR public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Sem acesso à escala.' USING ERRCODE = '42501';
  END IF;
  -- sempre a segunda-feira da semana
  p_week_start := p_week_start - ((extract(isodow FROM p_week_start)::int) - 1);
  IF p_week_start + 6 < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RETURN jsonb_build_object('turnos', 0, 'motivo', 'semana passada');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_vagas_padrao) THEN
    RETURN jsonb_build_object('turnos', 0, 'motivo', 'sem regra');
  END IF;

  FOR _mgr IN SELECT id FROM public.profiles WHERE role = 'master' AND is_active LOOP
    FOR _r IN SELECT * FROM public.crm_vagas_padrao LOOP
      FOR _d IN 0..6 LOOP
        _date := p_week_start + _d;
        -- dias que já passaram ficam como estão
        IF _date < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN CONTINUE; END IF;
        _used := public.crm_period_used(_mgr, _date, _r.period);
        _cap := GREATEST(_r.total, _used);

        IF _cap = 0 THEN
          DELETE FROM public.team_period_quotas
           WHERE manager_id = _mgr AND date = _date AND period = _r.period;
          DELETE FROM public.shift_slots ss USING public.shift_configs sc
           WHERE sc.id = ss.config_id AND sc.manager_id = _mgr AND ss.date = _date AND ss.period = _r.period;
          CONTINUE;
        END IF;

        INSERT INTO public.team_period_quotas (manager_id, date, period, start_time, end_time, total)
        VALUES (_mgr, _date, _r.period, _r.start_time, _r.end_time, _cap)
        ON CONFLICT (manager_id, date, period) DO UPDATE
          SET total = EXCLUDED.total, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time
          WHERE team_period_quotas.total IS DISTINCT FROM EXCLUDED.total
             OR team_period_quotas.start_time IS DISTINCT FROM EXCLUDED.start_time
             OR team_period_quotas.end_time IS DISTINCT FROM EXCLUDED.end_time;

        -- as duas vagas (Central e Plantão) do turno, como em crm_set_team_quota
        FOREACH _mod IN ARRAY ARRAY['online', 'salao'] LOOP
          SELECT id INTO _cfg FROM public.shift_configs
           WHERE manager_id = _mgr AND week_start_date = p_week_start AND modality = _mod;
          IF _cfg IS NULL THEN
            INSERT INTO public.shift_configs (manager_id, week_start_date, modality, link_token)
            VALUES (_mgr, p_week_start, _mod,
                    replace(gen_random_uuid()::text, '-', '') || to_char(clock_timestamp(), 'SSMS'))
            RETURNING id INTO _cfg;
          END IF;
          INSERT INTO public.shift_slots (config_id, date, period, capacity, start_time, end_time)
          VALUES (_cfg, _date, _r.period, 0, _r.start_time, _r.end_time)
          ON CONFLICT (config_id, date, period) DO NOTHING;
          _cfg := NULL;
        END LOOP;

        PERFORM public.crm_rebalance_period(_mgr, _date, _r.period);
        _feitos := _feitos + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('turnos', _feitos);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_aplicar_vagas_padrao(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_aplicar_vagas_padrao(DATE) TO authenticated;

-- Admin grava a regra e ela já vale da semana atual até 8 semanas à frente
-- (as semanas seguintes são preenchidas quando alguém abre a escala).
-- p_regra: [{ "period": "Manhã", "start": "09:00", "end": "14:00", "total": 3 }, ...]
CREATE OR REPLACE FUNCTION public.crm_set_vagas_padrao(p_regra JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _q JSONB;
  _w INT;
  _seg DATE;
  _turnos INT := 0;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Somente o administrador define as vagas.' USING ERRCODE = '42501';
  END IF;
  IF p_regra IS NULL OR jsonb_typeof(p_regra) <> 'array' THEN
    RAISE EXCEPTION 'Regra de vagas inválida.';
  END IF;

  DELETE FROM public.crm_vagas_padrao
   WHERE period NOT IN (SELECT q->>'period' FROM jsonb_array_elements(p_regra) q);
  FOR _q IN SELECT * FROM jsonb_array_elements(p_regra) LOOP
    INSERT INTO public.crm_vagas_padrao (period, start_time, end_time, total, updated_at)
    VALUES (_q->>'period', (_q->>'start')::time, (_q->>'end')::time,
            GREATEST(0, coalesce((_q->>'total')::int, 0)), now())
    ON CONFLICT (period) DO UPDATE
      SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
          total = EXCLUDED.total, updated_at = now();
  END LOOP;

  _seg := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _seg := _seg - ((extract(isodow FROM _seg)::int) - 1);
  FOR _w IN 0..8 LOOP
    _turnos := _turnos + coalesce((public.crm_aplicar_vagas_padrao(_seg + _w * 7)->>'turnos')::int, 0);
  END LOOP;
  RETURN jsonb_build_object('turnos', _turnos);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_set_vagas_padrao(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_set_vagas_padrao(JSONB) TO authenticated;
