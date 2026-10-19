-- Vagas por turno: preenche as semanas com a regra (3 vagas por equipe em cada
-- turno) e separa a lógica numa função interna, chamada pelo sistema depois de
-- conferir o acesso e por esta migration (que roda sem login de usuário).
-- Pode rodar de novo sem erro. Requer 20261019000001_vagas_padrao.sql.

-- 1. A lógica, sem checagem de acesso: só o banco (e as funções abaixo) chamam.
CREATE OR REPLACE FUNCTION public.crm_aplicar_vagas_padrao_interno(p_week_start DATE)
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
REVOKE ALL ON FUNCTION public.crm_aplicar_vagas_padrao_interno(DATE) FROM PUBLIC, anon, authenticated;

-- 2. O que o sistema chama ao abrir uma semana: confere o acesso e aplica.
CREATE OR REPLACE FUNCTION public.crm_aplicar_vagas_padrao(p_week_start DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.crm_can('schedule', 'view') OR public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Sem acesso à escala.' USING ERRCODE = '42501';
  END IF;
  RETURN public.crm_aplicar_vagas_padrao_interno(p_week_start);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_aplicar_vagas_padrao(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_aplicar_vagas_padrao(DATE) TO authenticated;

-- 3. O admin salvando a regra também usa a função interna.
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
    _turnos := _turnos + coalesce((public.crm_aplicar_vagas_padrao_interno(_seg + _w * 7)->>'turnos')::int, 0);
  END LOOP;
  RETURN jsonb_build_object('turnos', _turnos);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_set_vagas_padrao(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_set_vagas_padrao(JSONB) TO authenticated;

-- 4. A regra: 3 vagas por equipe em cada turno (horários das regras de check-in).
INSERT INTO public.crm_vagas_padrao (period, start_time, end_time, total, updated_at)
SELECT p.period,
       coalesce(p.ini, p.ini_padrao), coalesce(p.fim, p.fim_padrao), 3, now()
  FROM (
    SELECT 'Manhã' AS period, (SELECT manha_start FROM public.roulette_settings WHERE id = 1)::time AS ini,
           (SELECT manha_end FROM public.roulette_settings WHERE id = 1)::time AS fim, '09:00'::time AS ini_padrao, '14:00'::time AS fim_padrao
    UNION ALL
    SELECT 'Tarde', (SELECT tarde_start FROM public.roulette_settings WHERE id = 1)::time,
           (SELECT tarde_end FROM public.roulette_settings WHERE id = 1)::time, '14:00', '19:00'
    UNION ALL
    SELECT 'Noite', (SELECT noite_start FROM public.roulette_settings WHERE id = 1)::time,
           (SELECT noite_end FROM public.roulette_settings WHERE id = 1)::time, '19:00', '23:00'
  ) p
ON CONFLICT (period) DO UPDATE
  SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, total = 3, updated_at = now();

-- 5. Preenche da semana atual até 8 semanas à frente e mostra quantos turnos ficaram com vagas.
SELECT s.semana, (public.crm_aplicar_vagas_padrao_interno(s.semana)->>'turnos')::int AS turnos
  FROM (
    SELECT (d - ((extract(isodow FROM d)::int) - 1)) + w * 7 AS semana
      FROM (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d) hoje, generate_series(0, 8) w
  ) s
 ORDER BY s.semana;
