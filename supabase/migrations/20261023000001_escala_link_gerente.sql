-- Escala: sobras da Central e link do gerente.
--   1. Plantões, pré-cadastros e check-ins que ainda estavam nas vagas da Central
--      (criados depois de 20261019000003) passam para a vaga do Plantão do mesmo
--      turno. As vagas da Central que ficarem vazias são apagadas.
--   2. Vaga da Central não é mais criada, e plantão novo numa vaga da Central vai
--      para a do Plantão (qualquer tela antiga ou rotina que ainda use a Central).
--   3. Link do gerente: mostra os corretores da equipe que já têm conta, além dos
--      pré-cadastrados, e deixa escalar/tirar todos dentro das vagas da regra
--      (crm_vagas_padrao). As semanas sem vaga são preenchidas ao abrir o link.
--      Dias que já passaram não mudam.
--   4. Cada usuário lê os próprios avisos (notification_outbox): o app mostra ao
--      admin o aviso de cada check-in, mesmo sem o push.
-- Pode rodar de novo sem erro. Requer 20261019000003_plantao_unico.sql.

BEGIN;

-- ── 1. Sobras da Central vão para o Plantão ─────────────────────────────────
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
  FROM _mapa_vagas m
 WHERE sh.slot_id = m.central_slot AND m.plantao_slot IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.shifts x WHERE x.slot_id = m.plantao_slot AND x.broker_id = sh.broker_id);
ALTER TABLE public.shifts ENABLE TRIGGER shifts_enforce_slot_capacity;

UPDATE public.pending_shifts ps SET slot_id = m.plantao_slot
  FROM _mapa_vagas m
 WHERE ps.slot_id = m.central_slot AND m.plantao_slot IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.pending_shifts x
                    WHERE x.slot_id = m.plantao_slot AND x.pending_broker_id = ps.pending_broker_id);

UPDATE public.roulette_checkins rc SET slot_id = m.plantao_slot
  FROM _mapa_vagas m WHERE rc.slot_id = m.central_slot AND m.plantao_slot IS NOT NULL;

-- vagas da Central sem ninguém (os pré-cadastros repetidos saem junto)
DELETE FROM public.shift_slots ss USING public.shift_configs sc
 WHERE sc.id = ss.config_id AND sc.modality = 'online'
   AND NOT EXISTS (SELECT 1 FROM public.shifts sh WHERE sh.slot_id = ss.id)
   AND NOT EXISTS (SELECT 1 FROM public.roulette_checkins rc WHERE rc.slot_id = ss.id);

-- ── 2. A Central não volta ──────────────────────────────────────────────────
-- vaga nova da Central é ignorada (crm_set_team_quota e telas antigas ainda tentam criar)
CREATE OR REPLACE FUNCTION public.shift_slots_sem_central()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.shift_configs WHERE id = NEW.config_id AND modality = 'online') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS shift_slots_sem_central ON public.shift_slots;
CREATE TRIGGER shift_slots_sem_central BEFORE INSERT ON public.shift_slots
  FOR EACH ROW EXECUTE FUNCTION public.shift_slots_sem_central();

-- vaga da Plantão equivalente a uma vaga da Central (mesma equipe, dia e turno)
CREATE OR REPLACE FUNCTION public.crm_slot_plantao(_slot_id UUID)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
    SELECT p.id
      FROM public.shift_slots s JOIN public.shift_configs c ON c.id = s.config_id AND c.modality = 'online'
      JOIN public.shift_configs pc ON pc.manager_id = c.manager_id AND pc.week_start_date = c.week_start_date
                                  AND pc.modality = 'salao'
      JOIN public.shift_slots p ON p.config_id = pc.id AND p.date = s.date AND p.period IS NOT DISTINCT FROM s.period
     WHERE s.id = _slot_id), _slot_id);
$$;
REVOKE ALL ON FUNCTION public.crm_slot_plantao(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.shifts_vaga_plantao()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.slot_id IS NOT NULL THEN
    NEW.slot_id := public.crm_slot_plantao(NEW.slot_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.shifts_vaga_plantao() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS shifts_vaga_plantao ON public.shifts;
CREATE TRIGGER shifts_vaga_plantao BEFORE INSERT OR UPDATE OF slot_id ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_vaga_plantao();
DROP TRIGGER IF EXISTS pending_shifts_vaga_plantao ON public.pending_shifts;
CREATE TRIGGER pending_shifts_vaga_plantao BEFORE INSERT OR UPDATE OF slot_id ON public.pending_shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_vaga_plantao();

-- ── 3. Link do gerente ──────────────────────────────────────────────────────
-- Corretor com conta, da equipe do gerente (a conta de teste fica de fora).
CREATE OR REPLACE FUNCTION public.crm_schedule_link_broker(_m UUID, _broker UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles
                  WHERE id = _broker AND manager_id = _m AND role = 'broker' AND is_active AND NOT is_test);
$$;
REVOKE ALL ON FUNCTION public.crm_schedule_link_broker(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- brokers: pré-cadastrados (registered = false) e corretores com conta (registered = true)
-- slots[].assigned: ids dos dois tipos; slots[].registered: outros plantões na vaga
CREATE OR REPLACE FUNCTION public.crm_public_schedule(p_token TEXT, p_week DATE DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m UUID := public.crm_schedule_link_manager(p_token);
  _today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _seg DATE;
  _w INT;
  _weeks DATE[];
  _week DATE;
BEGIN
  IF _m IS NULL THEN RETURN NULL; END IF;

  -- semana atual e as 4 seguintes com as vagas da regra
  _seg := _today - ((extract(isodow FROM _today)::int) - 1);
  FOR _w IN 0..4 LOOP
    IF NOT EXISTS (SELECT 1 FROM public.shift_configs sc JOIN public.shift_slots ss ON ss.config_id = sc.id
                    WHERE sc.manager_id = _m AND sc.week_start_date = _seg + _w * 7 AND sc.modality = 'salao') THEN
      PERFORM public.crm_aplicar_vagas_padrao_interno(_seg + _w * 7);
    END IF;
  END LOOP;

  SELECT coalesce(array_agg(DISTINCT sc.week_start_date ORDER BY sc.week_start_date), '{}') INTO _weeks
  FROM public.shift_configs sc
  WHERE sc.manager_id = _m AND sc.week_start_date >= _seg AND sc.modality = 'salao'
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
      'today', _today,
      'weeks', to_jsonb(_weeks),
      'week', _week,
      'brokers', coalesce((
        SELECT jsonb_agg(b.j ORDER BY b.registered DESC, lower(b.name)) FROM (
          SELECT pb.full_name AS name, false AS registered,
                 jsonb_build_object('id', pb.id, 'name', pb.full_name, 'email', pb.email,
                                    'invite_token', pb.invite_token, 'registered', false) AS j
            FROM public.pending_brokers pb WHERE pb.manager_id = _m
          UNION ALL
          SELECT pr.full_name, true,
                 jsonb_build_object('id', pr.id, 'name', pr.full_name, 'registered', true)
            FROM public.profiles pr
           WHERE pr.manager_id = _m AND pr.role = 'broker' AND pr.is_active AND NOT pr.is_test
        ) b), '[]'::jsonb),
      'slots', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ss.id, 'modality', sc.modality, 'date', ss.date, 'period', ss.period,
          'start_time', ss.start_time, 'end_time', ss.end_time,
          'capacity', coalesce(q.total, ss.capacity),
          'used_total', CASE WHEN q.total IS NOT NULL
            THEN public.crm_period_used(_m, ss.date, ss.period)
            ELSE (SELECT count(*) FROM public.shifts sh WHERE sh.slot_id = ss.id)
               + (SELECT count(*) FROM public.pending_shifts ps WHERE ps.slot_id = ss.id) END,
          'registered', (SELECT count(*) FROM public.shifts sh
                          WHERE sh.slot_id = ss.id AND NOT public.crm_schedule_link_broker(_m, sh.broker_id)),
          'assigned', coalesce((SELECT jsonb_agg(ps.pending_broker_id) FROM public.pending_shifts ps
                                WHERE ps.slot_id = ss.id), '[]'::jsonb)
                   || coalesce((SELECT jsonb_agg(sh.broker_id) FROM public.shifts sh
                                WHERE sh.slot_id = ss.id AND public.crm_schedule_link_broker(_m, sh.broker_id)), '[]'::jsonb)
        ) ORDER BY ss.date, ss.start_time)
        FROM public.shift_slots ss JOIN public.shift_configs sc ON sc.id = ss.config_id
        LEFT JOIN public.team_period_quotas q
          ON q.manager_id = _m AND q.date = ss.date AND q.period = ss.period
        WHERE sc.manager_id = _m AND sc.week_start_date = _week AND sc.modality = 'salao'), '[]'::jsonb)
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
  _registered BOOLEAN;
  _total INT;
  _used INT;
BEGIN
  IF _m IS NULL THEN RAISE EXCEPTION 'Link inválido.'; END IF;
  _registered := public.crm_schedule_link_broker(_m, p_broker_id);
  IF NOT _registered
     AND NOT EXISTS (SELECT 1 FROM public.pending_brokers WHERE id = p_broker_id AND manager_id = _m) THEN
    RAISE EXCEPTION 'Corretor não encontrado.';
  END IF;
  SELECT ss.* INTO _slot FROM public.shift_slots ss
  JOIN public.shift_configs sc ON sc.id = ss.config_id
  WHERE ss.id = public.crm_slot_plantao(p_slot_id) AND sc.manager_id = _m FOR UPDATE OF ss;
  IF NOT FOUND THEN RAISE EXCEPTION 'Turno não encontrado.'; END IF;
  IF _slot.date < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Esse dia já passou.';
  END IF;

  -- o mesmo corretor não fica duas vezes no mesmo dia e turno
  IF _registered THEN
    IF EXISTS (SELECT 1 FROM public.shifts sh WHERE sh.slot_id = _slot.id AND sh.broker_id = p_broker_id) THEN
      RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.shifts sh JOIN public.shift_slots s2 ON s2.id = sh.slot_id
               WHERE sh.broker_id = p_broker_id AND s2.date = _slot.date AND s2.period = _slot.period) THEN
      RAISE EXCEPTION 'Esse corretor já está escalado nesse dia e turno.';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.pending_shifts WHERE slot_id = _slot.id AND pending_broker_id = p_broker_id) THEN
      RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.pending_shifts ps JOIN public.shift_slots s2 ON s2.id = ps.slot_id
               WHERE ps.pending_broker_id = p_broker_id AND s2.date = _slot.date AND s2.period = _slot.period) THEN
      RAISE EXCEPTION 'Esse corretor já está escalado nesse dia e turno.';
    END IF;
  END IF;

  -- limite: vagas do turno, definidas pelo admin
  SELECT total INTO _total FROM public.team_period_quotas
   WHERE manager_id = _m AND date = _slot.date AND period = _slot.period FOR UPDATE;
  IF FOUND THEN
    _used := public.crm_period_used(_m, _slot.date, _slot.period);
  ELSE
    _total := _slot.capacity;
    SELECT (SELECT count(*) FROM public.shifts WHERE slot_id = _slot.id)
         + (SELECT count(*) FROM public.pending_shifts WHERE slot_id = _slot.id) INTO _used;
  END IF;
  IF _used >= _total THEN
    RAISE EXCEPTION 'Vagas esgotadas para esse turno.';
  END IF;

  IF _registered THEN
    INSERT INTO public.shifts (broker_id, manager_id, date, start_time, end_time, slot_id)
    VALUES (p_broker_id, _m, _slot.date, _slot.start_time, _slot.end_time, _slot.id);
  ELSE
    INSERT INTO public.pending_shifts (slot_id, pending_broker_id) VALUES (_slot.id, p_broker_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_public_schedule_unassign(p_token TEXT, p_slot_id UUID, p_broker_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m UUID := public.crm_schedule_link_manager(p_token);
  _shift UUID;
BEGIN
  IF _m IS NULL THEN RAISE EXCEPTION 'Link inválido.'; END IF;
  IF EXISTS (SELECT 1 FROM public.shift_slots
              WHERE id = p_slot_id AND date < (now() AT TIME ZONE 'America/Sao_Paulo')::date) THEN
    RAISE EXCEPTION 'Esse dia já passou.';
  END IF;

  IF public.crm_schedule_link_broker(_m, p_broker_id) THEN
    SELECT sh.id INTO _shift FROM public.shifts sh
     WHERE sh.slot_id = p_slot_id AND sh.broker_id = p_broker_id;
    IF _shift IS NULL THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.roulette_checkins WHERE shift_id = _shift) THEN
      RAISE EXCEPTION 'Esse corretor já fez check-in nesse turno.';
    END IF;
    DELETE FROM public.shifts WHERE id = _shift;
    RETURN;
  END IF;

  DELETE FROM public.pending_shifts ps
  USING public.pending_brokers pb
  WHERE ps.slot_id = p_slot_id AND ps.pending_broker_id = p_broker_id
    AND pb.id = ps.pending_broker_id AND pb.manager_id = _m;
END;
$$;

-- ── 4. Cada usuário lê os próprios avisos ───────────────────────────────────
DROP POLICY IF EXISTS "notification_outbox_own_read" ON public.notification_outbox;
CREATE POLICY "notification_outbox_own_read" ON public.notification_outbox FOR SELECT TO authenticated
  USING (user_id = auth.uid());
GRANT SELECT ON public.notification_outbox TO authenticated;
CREATE INDEX IF NOT EXISTS notification_outbox_user_idx ON public.notification_outbox (user_id, created_at DESC);

COMMIT;

-- Conferência: as duas devem dar 0
SELECT
  (SELECT count(*) FROM public.shifts sh JOIN public.shift_slots ss ON ss.id = sh.slot_id
     JOIN public.shift_configs sc ON sc.id = ss.config_id
    WHERE sc.modality = 'online' AND ss.date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS plantoes_na_central,
  (SELECT count(*) FROM public.shift_slots ss JOIN public.shift_configs sc ON sc.id = ss.config_id
    WHERE sc.modality = 'online' AND ss.date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS vagas_da_central;
