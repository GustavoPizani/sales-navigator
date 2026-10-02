-- Escala pelo link do gerente, sem login.
--
-- O admin gera um link individual por gerente. O gerente abre sem login,
-- digita o nome dos corretores (pré-cadastro: ainda não são usuários) e os
-- distribui nos turnos, dentro das vagas que o admin definiu para a equipe
-- (crm_set_team_quota). Esses plantões ficam em pending_shifts e ocupam vaga
-- como os plantões de usuários cadastrados.

-- ── Link individual do gerente ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_schedule_links (
  manager_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.team_schedule_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "team_schedule_links_admin_read" ON public.team_schedule_links;
CREATE POLICY "team_schedule_links_admin_read" ON public.team_schedule_links FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
GRANT SELECT ON public.team_schedule_links TO authenticated;

-- Admin pega (ou troca) o link de um gerente. Trocar invalida o link anterior.
CREATE OR REPLACE FUNCTION public.crm_team_schedule_link(p_manager_id UUID, p_regenerate BOOLEAN DEFAULT false)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _token TEXT;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Somente o administrador gera o link da escala.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_manager_id AND role = 'master') THEN
    RAISE EXCEPTION 'Gerente inválido.';
  END IF;
  INSERT INTO public.team_schedule_links (manager_id, token)
  VALUES (p_manager_id, replace(gen_random_uuid()::text, '-', ''))
  ON CONFLICT (manager_id) DO UPDATE
    SET token = CASE WHEN p_regenerate THEN EXCLUDED.token ELSE public.team_schedule_links.token END
  RETURNING token INTO _token;
  RETURN _token;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_team_schedule_link(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_team_schedule_link(UUID, BOOLEAN) TO authenticated;

-- Gerente (ativo) dono do link; NULL se o link não existe.
CREATE OR REPLACE FUNCTION public.crm_schedule_link_manager(p_token TEXT)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.manager_id FROM public.team_schedule_links l
  JOIN public.profiles p ON p.id = l.manager_id AND p.is_active
  WHERE l.token = p_token;
$$;
REVOKE ALL ON FUNCTION public.crm_schedule_link_manager(TEXT) FROM PUBLIC, anon, authenticated;

-- ── Corretores pré-cadastrados (só o nome) e seus plantões ──────────────────
CREATE TABLE IF NOT EXISTS public.pending_brokers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pending_brokers_name_per_team
  ON public.pending_brokers (manager_id, lower(full_name));

CREATE TABLE IF NOT EXISTS public.pending_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES public.shift_slots(id) ON DELETE CASCADE,
  pending_broker_id UUID NOT NULL REFERENCES public.pending_brokers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slot_id, pending_broker_id)
);
CREATE INDEX IF NOT EXISTS pending_shifts_broker_idx ON public.pending_shifts (pending_broker_id);

ALTER TABLE public.pending_brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_shifts ENABLE ROW LEVEL SECURITY;
-- Quem vê a Escala vê os pré-cadastrados; a escrita é só pelo link (RPCs abaixo).
DROP POLICY IF EXISTS "pending_brokers_read" ON public.pending_brokers;
CREATE POLICY "pending_brokers_read" ON public.pending_brokers FOR SELECT TO authenticated
  USING (public.crm_can('schedule', 'view'));
DROP POLICY IF EXISTS "pending_shifts_read" ON public.pending_shifts;
CREATE POLICY "pending_shifts_read" ON public.pending_shifts FOR SELECT TO authenticated
  USING (public.crm_can('schedule', 'view'));
-- Admin e o gerente da equipe podem remover um pré-cadastrado (e seus plantões).
DROP POLICY IF EXISTS "pending_brokers_delete" ON public.pending_brokers;
CREATE POLICY "pending_brokers_delete" ON public.pending_brokers FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR (public.is_manager(auth.uid()) AND manager_id = auth.uid()));
GRANT SELECT, DELETE ON public.pending_brokers TO authenticated;
GRANT SELECT ON public.pending_shifts TO authenticated;

-- ── As vagas contam cadastrados + pré-cadastrados ───────────────────────────
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
  SELECT (SELECT count(*) FROM public.shifts WHERE slot_id = NEW.slot_id AND id <> NEW.id)
       + (SELECT count(*) FROM public.pending_shifts WHERE slot_id = NEW.slot_id) INTO _used;
  IF _used >= coalesce(_cap, 0) THEN
    RAISE EXCEPTION 'Vagas esgotadas para esse turno.';
  END IF;
  RETURN NEW;
END;
$$;

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
          'capacity', ss.capacity,
          'start_time', ss.start_time,
          'end_time', ss.end_time,
          'claimed_count', (
            (SELECT COUNT(*) FROM public.shifts sh WHERE sh.slot_id = ss.id)
            + (SELECT COUNT(*) FROM public.pending_shifts ps WHERE ps.slot_id = ss.id)
          )
        ) ORDER BY ss.date, ss.start_time
      )
      FROM public.shift_slots ss
      WHERE ss.config_id = sc.id
    ), '[]'::json)
  )
  INTO v_result
  FROM public.shift_configs sc
  WHERE sc.link_token = p_token;

  RETURN v_result;
END;
$$;

-- (igual à versão anterior; só a contagem de escalados inclui os pré-cadastrados)
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
      SELECT (SELECT count(*) FROM public.shifts WHERE slot_id = _slot.id)
           + (SELECT count(*) FROM public.pending_shifts WHERE slot_id = _slot.id) INTO _used;
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

-- ── Página pública (sem login): tudo passa pelo token do link ───────────────
-- Dados da escala de uma semana. p_week NULL = próxima semana com vagas definidas.
CREATE OR REPLACE FUNCTION public.crm_public_schedule(p_token TEXT, p_week DATE DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m UUID := public.crm_schedule_link_manager(p_token);
  _today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _weeks DATE[];
  _week DATE;
BEGIN
  IF _m IS NULL THEN RETURN NULL; END IF;

  SELECT coalesce(array_agg(DISTINCT week_start_date ORDER BY week_start_date), '{}') INTO _weeks
  FROM public.shift_configs
  WHERE manager_id = _m AND week_start_date >= date_trunc('week', _today)::date;

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
          'start_time', ss.start_time, 'end_time', ss.end_time, 'capacity', ss.capacity,
          'registered', (SELECT count(*) FROM public.shifts sh WHERE sh.slot_id = ss.id),
          'assigned', coalesce((SELECT jsonb_agg(ps.pending_broker_id) FROM public.pending_shifts ps
                                WHERE ps.slot_id = ss.id), '[]'::jsonb)
        ) ORDER BY ss.date, ss.start_time)
        FROM public.shift_slots ss JOIN public.shift_configs sc ON sc.id = ss.config_id
        WHERE sc.manager_id = _m AND sc.week_start_date = _week), '[]'::jsonb)
    )
    FROM public.profiles p WHERE p.id = _m
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_public_schedule_add_broker(p_token TEXT, p_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m UUID := public.crm_schedule_link_manager(p_token);
  _name TEXT := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  _id UUID;
BEGIN
  IF _m IS NULL THEN RAISE EXCEPTION 'Link inválido.'; END IF;
  IF length(_name) < 2 OR length(_name) > 80 THEN
    RAISE EXCEPTION 'Informe o nome do corretor.';
  END IF;
  SELECT id INTO _id FROM public.pending_brokers WHERE manager_id = _m AND lower(full_name) = lower(_name);
  IF _id IS NOT NULL THEN RAISE EXCEPTION 'Esse corretor já está na lista.'; END IF;
  IF (SELECT count(*) FROM public.pending_brokers WHERE manager_id = _m) >= 100 THEN
    RAISE EXCEPTION 'Limite de corretores da equipe atingido.';
  END IF;
  INSERT INTO public.pending_brokers (manager_id, full_name) VALUES (_m, _name) RETURNING id INTO _id;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_public_schedule_remove_broker(p_token TEXT, p_broker_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m UUID := public.crm_schedule_link_manager(p_token);
BEGIN
  IF _m IS NULL THEN RAISE EXCEPTION 'Link inválido.'; END IF;
  DELETE FROM public.pending_brokers WHERE id = p_broker_id AND manager_id = _m;
END;
$$;

-- Coloca o corretor em um turno, respeitando as vagas definidas pelo admin.
CREATE OR REPLACE FUNCTION public.crm_public_schedule_assign(p_token TEXT, p_slot_id UUID, p_broker_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m UUID := public.crm_schedule_link_manager(p_token);
  _slot public.shift_slots%ROWTYPE;
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
    RAISE EXCEPTION 'Esse corretor já está escalado nesse dia e turno.';
  END IF;
  SELECT (SELECT count(*) FROM public.shifts WHERE slot_id = p_slot_id)
       + (SELECT count(*) FROM public.pending_shifts WHERE slot_id = p_slot_id) INTO _used;
  IF _used >= _slot.capacity THEN
    RAISE EXCEPTION 'Vagas esgotadas para esse turno.';
  END IF;
  INSERT INTO public.pending_shifts (slot_id, pending_broker_id) VALUES (p_slot_id, p_broker_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_public_schedule_unassign(p_token TEXT, p_slot_id UUID, p_broker_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m UUID := public.crm_schedule_link_manager(p_token);
BEGIN
  IF _m IS NULL THEN RAISE EXCEPTION 'Link inválido.'; END IF;
  DELETE FROM public.pending_shifts ps
  USING public.pending_brokers pb
  WHERE ps.slot_id = p_slot_id AND ps.pending_broker_id = p_broker_id
    AND pb.id = ps.pending_broker_id AND pb.manager_id = _m;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_public_schedule(TEXT, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_public_schedule_add_broker(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_public_schedule_remove_broker(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_public_schedule_assign(TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_public_schedule_unassign(TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_public_schedule(TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_public_schedule_add_broker(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_public_schedule_remove_broker(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_public_schedule_assign(TEXT, UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_public_schedule_unassign(TEXT, UUID, UUID) TO anon, authenticated;
