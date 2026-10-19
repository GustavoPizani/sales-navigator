-- Plantão único: a Central deixa de existir. Todo turno é do Plantão (312 JAM).
--   1. As vagas de cada turno vão inteiras para o Plantão (a Central fica com 0).
--   2. As semanas novas só criam a vaga do Plantão.
--   3. Plantões escalados na Central (e pré-cadastrados pelo link) passam para o Plantão.
--   4. Check-ins registrados na Central passam para o Plantão; check-ins novos
--      sempre ficam no Plantão (inclusive stand-by e turno sem GPS). O log de
--      check-in é imutável: não muda, e a tela mostra a Central como o Plantão.
-- Pode rodar de novo sem erro. Requer 20261019000002_vagas_padrao_aplicar.sql.

BEGIN;

-- ── 1. Toda vaga do turno é do Plantão ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_rebalance_period(_manager UUID, _date DATE, _period TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _total INT;
BEGIN
  SELECT total INTO _total FROM public.team_period_quotas
   WHERE manager_id = _manager AND date = _date AND period = _period;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.shift_slots ss
     SET capacity = CASE WHEN sc.modality = 'salao' THEN _total ELSE 0 END
    FROM public.shift_configs sc
   WHERE sc.id = ss.config_id AND sc.manager_id = _manager AND ss.date = _date AND ss.period = _period
     AND ss.capacity IS DISTINCT FROM (CASE WHEN sc.modality = 'salao' THEN _total ELSE 0 END);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_rebalance_period(UUID, DATE, TEXT) FROM PUBLIC, anon, authenticated;

-- O local de qualquer vaga é o Plantão.
CREATE OR REPLACE FUNCTION public.crm_slot_location(_slot_id UUID)
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'plantao'::text;
$$;

-- ── 2. Semanas novas: só a vaga do Plantão ──────────────────────────────────
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
  _feitos INT := 0;
BEGIN
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

        SELECT id INTO _cfg FROM public.shift_configs
         WHERE manager_id = _mgr AND week_start_date = p_week_start AND modality = 'salao';
        IF _cfg IS NULL THEN
          INSERT INTO public.shift_configs (manager_id, week_start_date, modality, link_token)
          VALUES (_mgr, p_week_start, 'salao',
                  replace(gen_random_uuid()::text, '-', '') || to_char(clock_timestamp(), 'SSMS'))
          RETURNING id INTO _cfg;
        END IF;
        INSERT INTO public.shift_slots (config_id, date, period, capacity, start_time, end_time)
        VALUES (_cfg, _date, _r.period, 0, _r.start_time, _r.end_time)
        ON CONFLICT (config_id, date, period) DO NOTHING;
        _cfg := NULL;

        PERFORM public.crm_rebalance_period(_mgr, _date, _r.period);
        _feitos := _feitos + 1;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('turnos', _feitos);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_aplicar_vagas_padrao_interno(DATE) FROM PUBLIC, anon, authenticated;

-- ── 3. Plantões da Central passam para o Plantão ────────────────────────────
-- vaga do Plantão correspondente a cada vaga da Central (cria quando falta)
CREATE TEMP TABLE _mapa_vagas ON COMMIT DROP AS
SELECT ss.id AS central_slot, sc.manager_id, sc.week_start_date, ss.date, ss.period, ss.start_time, ss.end_time,
       NULL::uuid AS plantao_slot
  FROM public.shift_slots ss JOIN public.shift_configs sc ON sc.id = ss.config_id
 WHERE sc.modality = 'online';

INSERT INTO public.shift_configs (manager_id, week_start_date, modality, link_token)
SELECT DISTINCT m.manager_id, m.week_start_date, 'salao',
       replace(gen_random_uuid()::text, '-', '') || to_char(clock_timestamp(), 'SSMS')
  FROM _mapa_vagas m
 WHERE NOT EXISTS (SELECT 1 FROM public.shift_configs c
                    WHERE c.manager_id = m.manager_id AND c.week_start_date = m.week_start_date AND c.modality = 'salao');

INSERT INTO public.shift_slots (config_id, date, period, capacity, start_time, end_time)
SELECT c.id, m.date, m.period, 0, m.start_time, m.end_time
  FROM _mapa_vagas m
  JOIN public.shift_configs c ON c.manager_id = m.manager_id AND c.week_start_date = m.week_start_date AND c.modality = 'salao'
ON CONFLICT (config_id, date, period) DO NOTHING;

UPDATE _mapa_vagas m SET plantao_slot = ss.id
  FROM public.shift_configs c JOIN public.shift_slots ss ON ss.config_id = c.id
 WHERE c.manager_id = m.manager_id AND c.week_start_date = m.week_start_date AND c.modality = 'salao'
   AND ss.date = m.date AND ss.period IS NOT DISTINCT FROM m.period;

-- a troca não muda o total do turno: a checagem de vagas não precisa rodar aqui
ALTER TABLE public.shifts DISABLE TRIGGER shifts_enforce_slot_capacity;
UPDATE public.shifts sh SET slot_id = m.plantao_slot
  FROM _mapa_vagas m WHERE sh.slot_id = m.central_slot AND m.plantao_slot IS NOT NULL;
ALTER TABLE public.shifts ENABLE TRIGGER shifts_enforce_slot_capacity;

UPDATE public.pending_shifts ps SET slot_id = m.plantao_slot
  FROM _mapa_vagas m WHERE ps.slot_id = m.central_slot AND m.plantao_slot IS NOT NULL;

-- ── 4. Check-ins e log: Central vira Plantão ────────────────────────────────
UPDATE public.roulette_checkins rc SET slot_id = m.plantao_slot
  FROM _mapa_vagas m WHERE rc.slot_id = m.central_slot AND m.plantao_slot IS NOT NULL;
UPDATE public.roulette_checkins SET location = 'plantao' WHERE location = 'central';
-- o log de check-in é histórico imutável (só aceita ajustes): ele não muda aqui;
-- a tela e a exportação do log mostram os registros da Central como o Plantão

-- check-in novo sempre no Plantão (stand-by e turno sem GPS também)
CREATE OR REPLACE FUNCTION public.roulette_checkins_sempre_plantao()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.location := 'plantao';
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS roulette_checkins_sempre_plantao ON public.roulette_checkins;
CREATE TRIGGER roulette_checkins_sempre_plantao BEFORE INSERT OR UPDATE OF location ON public.roulette_checkins
  FOR EACH ROW EXECUTE FUNCTION public.roulette_checkins_sempre_plantao();

-- ── 5. Recalcula as vagas de todos os turnos de hoje em diante ──────────────
SELECT count(*) AS turnos_recalculados FROM (
  SELECT public.crm_rebalance_period(q.manager_id, q.date, q.period)
    FROM public.team_period_quotas q
   WHERE q.date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
) r;

COMMIT;

-- Conferência: as duas primeiras devem dar 0 (o log guarda o histórico como foi)
SELECT
  (SELECT count(*) FROM public.shifts sh JOIN public.shift_slots ss ON ss.id = sh.slot_id
     JOIN public.shift_configs sc ON sc.id = ss.config_id WHERE sc.modality = 'online') AS plantoes_na_central,
  (SELECT count(*) FROM public.roulette_checkins WHERE location = 'central') AS checkins_na_central,
  (SELECT count(*) FROM public.checkin_log WHERE location = 'central') AS registros_antigos_no_log;
