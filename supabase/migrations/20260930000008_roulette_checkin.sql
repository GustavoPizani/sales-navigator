-- Check-in da roleta com GPS e alocação de vagas por turno.
--
-- Turno  = (data, início, fim) das vagas (shift_slots) das escalas dos gerentes.
-- Local  = modalidade da escala: 'online' → Central, 'salao' → Plantão.
--          Central e Plantão são dois pontos fixos (roulette_settings).
-- Vaga   = capacidade de cada shift_slot (uma escala por gerente = equipe).
--
-- Check-in (abre N min antes do início e fecha no fim da tolerância):
--   * escalado: valida se o GPS confirma o local da vaga dele → 'validated';
--   * não escalado: vira stand-by no local onde o GPS o encontrou → 'standby'.
-- No fim da tolerância o turno é processado uma única vez:
--   vagas abertas = capacidade − escalados validados (falta + vaga não preenchida)
--   1) equipe: vaga aberta da equipe X vai para stand-by da equipe X no mesmo
--      local, por ordem de check-in;
--   2) geral: se stand-by restantes <= vagas restantes, todos são alocados numa
--      vaga do próprio local (quem não tiver vaga no seu local vai para o admin);
--   3) se stand-by restantes > vagas restantes, ninguém é alocado
--      automaticamente: o admin é avisado e decide.
-- Escalados sem check-in são marcados como falta e o gerente é avisado.

-- ── Configuração (linha única) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.roulette_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  checkin_open_before_min INT NOT NULL DEFAULT 30 CHECK (checkin_open_before_min BETWEEN 0 AND 240),
  tolerance_min INT NOT NULL DEFAULT 15 CHECK (tolerance_min BETWEEN 0 AND 240),
  max_accuracy_m INT NOT NULL DEFAULT 100 CHECK (max_accuracy_m > 0),
  central_lat DOUBLE PRECISION,
  central_lng DOUBLE PRECISION,
  central_radius_m INT NOT NULL DEFAULT 150 CHECK (central_radius_m > 0),
  plantao_lat DOUBLE PRECISION,
  plantao_lng DOUBLE PRECISION,
  plantao_radius_m INT NOT NULL DEFAULT 150 CHECK (plantao_radius_m > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.roulette_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.roulette_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "roulette_settings_read" ON public.roulette_settings;
CREATE POLICY "roulette_settings_read" ON public.roulette_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "roulette_settings_admin_update" ON public.roulette_settings;
CREATE POLICY "roulette_settings_admin_update" ON public.roulette_settings FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
GRANT SELECT, UPDATE ON public.roulette_settings TO authenticated;

-- ── Check-ins ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.roulette_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  broker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_manager_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('scheduled', 'standby')),
  location TEXT NOT NULL CHECK (location IN ('central', 'plantao')),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy_m DOUBLE PRECISION,
  distance_m INT,
  -- validated: escalado presente | standby: aguardando alocação |
  -- allocated: stand-by alocado | waiting_admin: aguardando decisão do admin |
  -- not_allocated: ficou de fora
  status TEXT NOT NULL CHECK (status IN ('validated', 'standby', 'allocated', 'waiting_admin', 'not_allocated')),
  slot_id UUID REFERENCES public.shift_slots(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (turn_date, start_time, end_time, broker_id)
);
CREATE INDEX IF NOT EXISTS roulette_checkins_turn_idx ON public.roulette_checkins (turn_date, start_time, end_time, status);

ALTER TABLE public.roulette_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "roulette_checkins_read" ON public.roulette_checkins;
CREATE POLICY "roulette_checkins_read" ON public.roulette_checkins FOR SELECT TO authenticated
  USING (public.crm_can_access_broker(broker_id));
GRANT SELECT ON public.roulette_checkins TO authenticated;

-- Estado de processamento de cada turno.
CREATE TABLE IF NOT EXISTS public.roulette_turns (
  turn_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  processed_at TIMESTAMPTZ,
  needs_admin BOOLEAN NOT NULL DEFAULT false,
  standby_count INT,
  open_count INT,
  PRIMARY KEY (turn_date, start_time, end_time)
);
ALTER TABLE public.roulette_turns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "roulette_turns_read" ON public.roulette_turns;
CREATE POLICY "roulette_turns_read" ON public.roulette_turns FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.roulette_turns TO authenticated;

-- Falta do escalado (sem check-in até o fim da tolerância).
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS missed_at TIMESTAMPTZ;

-- Fila de notificações push (enviada pela Edge Function send-notification-outbox).
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx ON public.notification_outbox (created_at) WHERE sent_at IS NULL;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY; -- sem políticas: só service role

-- ── Utilitários ─────────────────────────────────────────────────────────────
-- Hora local de Brasília (as escalas usam data/hora locais).
CREATE OR REPLACE FUNCTION public.crm_now_local()
RETURNS TIMESTAMP LANGUAGE SQL STABLE AS $$
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo');
$$;

-- Distância em metros (haversine).
CREATE OR REPLACE FUNCTION public.crm_distance_m(lat1 DOUBLE PRECISION, lng1 DOUBLE PRECISION, lat2 DOUBLE PRECISION, lng2 DOUBLE PRECISION)
RETURNS DOUBLE PRECISION LANGUAGE SQL IMMUTABLE AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

CREATE OR REPLACE FUNCTION public.crm_slot_location(_slot_id UUID)
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN sc.modality = 'salao' THEN 'plantao' ELSE 'central' END
  FROM public.shift_slots ss JOIN public.shift_configs sc ON sc.id = ss.config_id
  WHERE ss.id = _slot_id;
$$;

CREATE OR REPLACE FUNCTION public.crm_location_label(_loc TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE _loc WHEN 'plantao' THEN 'Plantão' ELSE 'Central' END;
$$;
-- "do Plantão" / "da Central"
CREATE OR REPLACE FUNCTION public.crm_location_of(_loc TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE _loc WHEN 'plantao' THEN 'do Plantão' ELSE 'da Central' END;
$$;
-- "no Plantão" / "na Central"
CREATE OR REPLACE FUNCTION public.crm_location_in(_loc TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE _loc WHEN 'plantao' THEN 'no Plantão' ELSE 'na Central' END;
$$;

-- Vagas abertas de uma vaga (slot): capacidade − ocupantes (validados + alocados).
CREATE OR REPLACE FUNCTION public.crm_slot_open(_slot_id UUID)
RETURNS INT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(0, ss.capacity - (
    SELECT count(*) FROM public.roulette_checkins rc
    WHERE rc.slot_id = ss.id AND rc.status IN ('validated', 'allocated')
  ))::int
  FROM public.shift_slots ss WHERE ss.id = _slot_id;
$$;

REVOKE ALL ON FUNCTION public.crm_slot_location(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_slot_open(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_slot_location(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_slot_open(UUID) TO authenticated;

-- ── Check-in ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_roulette_checkin(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_accuracy DOUBLE PRECISION)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _me public.profiles%ROWTYPE;
  _cfg public.roulette_settings%ROWTYPE;
  _now TIMESTAMP := public.crm_now_local();
  _turn RECORD;
  _shift public.shifts%ROWTYPE;
  _loc TEXT;
  _dist DOUBLE PRECISION;
  _d_central DOUBLE PRECISION;
  _d_plantao DOUBLE PRECISION;
  _status TEXT;
  _kind TEXT;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT * INTO _me FROM public.profiles WHERE id = _uid;
  IF NOT FOUND OR _me.role <> 'broker' OR NOT _me.is_active THEN
    RAISE EXCEPTION 'Só corretores ativos fazem check-in na roleta.';
  END IF;
  SELECT * INTO _cfg FROM public.roulette_settings WHERE id = 1;

  IF p_lat IS NULL OR p_lng IS NULL THEN RAISE EXCEPTION 'Localização não recebida. Permita o acesso ao GPS.'; END IF;
  IF p_accuracy IS NOT NULL AND p_accuracy > _cfg.max_accuracy_m THEN
    RAISE EXCEPTION 'Sinal de GPS impreciso (± % m). Tente novamente em local aberto ou com o GPS ativado.', round(p_accuracy);
  END IF;

  -- Turnos de hoje com check-in aberto agora (preferência: o turno em que estou escalado).
  SELECT t.turn_date, t.start_time, t.end_time, sh.id AS shift_id INTO _turn
  FROM (
    SELECT DISTINCT ss.date AS turn_date, ss.start_time, ss.end_time
    FROM public.shift_slots ss
    WHERE ss.date = _now::date
      AND _now >= (ss.date + ss.start_time) - make_interval(mins => _cfg.checkin_open_before_min)
      AND _now <= (ss.date + ss.start_time) + make_interval(mins => _cfg.tolerance_min)
  ) t
  LEFT JOIN public.shifts sh
    ON sh.broker_id = _uid AND sh.date = t.turn_date AND sh.start_time = t.start_time AND sh.end_time = t.end_time
  LEFT JOIN public.roulette_turns rt
    ON rt.turn_date = t.turn_date AND rt.start_time = t.start_time AND rt.end_time = t.end_time
  WHERE rt.processed_at IS NULL
  ORDER BY (sh.id IS NULL), t.start_time
  LIMIT 1;

  IF _turn.turn_date IS NULL THEN
    RAISE EXCEPTION 'Nenhum turno com check-in aberto agora.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.roulette_checkins
             WHERE broker_id = _uid AND turn_date = _turn.turn_date
               AND start_time = _turn.start_time AND end_time = _turn.end_time) THEN
    RAISE EXCEPTION 'Você já fez check-in neste turno.';
  END IF;

  IF _cfg.central_lat IS NOT NULL THEN
    _d_central := public.crm_distance_m(p_lat, p_lng, _cfg.central_lat, _cfg.central_lng);
  END IF;
  IF _cfg.plantao_lat IS NOT NULL THEN
    _d_plantao := public.crm_distance_m(p_lat, p_lng, _cfg.plantao_lat, _cfg.plantao_lng);
  END IF;

  IF _turn.shift_id IS NOT NULL THEN
    -- Escalado: precisa estar no local da vaga dele.
    SELECT * INTO _shift FROM public.shifts WHERE id = _turn.shift_id;
    _loc := coalesce(public.crm_slot_location(_shift.slot_id), 'central');
    _dist := CASE _loc WHEN 'plantao' THEN _d_plantao ELSE _d_central END;
    IF _dist IS NULL THEN
      RAISE EXCEPTION 'A localização % ainda não foi configurada pelo administrador.', public.crm_location_of(_loc);
    END IF;
    IF _dist > (CASE _loc WHEN 'plantao' THEN _cfg.plantao_radius_m ELSE _cfg.central_radius_m END) THEN
      RAISE EXCEPTION 'Você está a % m % (local da sua vaga). Faça o check-in no local.', round(_dist), public.crm_location_of(_loc);
    END IF;
    _kind := 'scheduled';
    _status := 'validated';
  ELSE
    -- Stand-by: fica registrado no local em que o GPS o encontrou.
    IF _d_central IS NOT NULL AND _d_central <= _cfg.central_radius_m
       AND (_d_plantao IS NULL OR _d_plantao > _cfg.plantao_radius_m OR _d_central <= _d_plantao) THEN
      _loc := 'central'; _dist := _d_central;
    ELSIF _d_plantao IS NOT NULL AND _d_plantao <= _cfg.plantao_radius_m THEN
      _loc := 'plantao'; _dist := _d_plantao;
    ELSE
      RAISE EXCEPTION 'Você não está na Central nem no Plantão (distâncias: Central %, Plantão %).',
        coalesce(round(_d_central)::text || ' m', 'não configurada'),
        coalesce(round(_d_plantao)::text || ' m', 'não configurado');
    END IF;
    _kind := 'standby';
    _status := 'standby';
  END IF;

  INSERT INTO public.roulette_checkins
    (turn_date, start_time, end_time, broker_id, team_manager_id, shift_id, kind, location,
     lat, lng, accuracy_m, distance_m, status, slot_id)
  VALUES
    (_turn.turn_date, _turn.start_time, _turn.end_time, _uid, _me.manager_id, _turn.shift_id, _kind, _loc,
     p_lat, p_lng, p_accuracy, round(_dist), _status, _shift.slot_id);

  RETURN jsonb_build_object(
    'kind', _kind, 'status', _status, 'location', _loc, 'distance_m', round(_dist),
    'turn_date', _turn.turn_date, 'start_time', _turn.start_time, 'end_time', _turn.end_time,
    'allocation_at', (_turn.turn_date + _turn.start_time) + make_interval(mins => _cfg.tolerance_min)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.crm_roulette_checkin(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_roulette_checkin(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

-- ── Processamento do turno (no fim da tolerância) ───────────────────────────
CREATE OR REPLACE FUNCTION public.crm_process_roulette_turn(p_date DATE, p_start TIME, p_end TIME)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _c RECORD;
  _slot UUID;
  _standby INT;
  _open INT;
  _waiting INT := 0;
  _label TEXT := to_char(p_start, 'HH24:MI') || '–' || to_char(p_end, 'HH24:MI');
BEGIN
  INSERT INTO public.roulette_turns (turn_date, start_time, end_time)
  VALUES (p_date, p_start, p_end) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.roulette_turns
   WHERE turn_date = p_date AND start_time = p_start AND end_time = p_end AND processed_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('skipped', true); END IF;

  -- 1) Substituição dentro da equipe, mesmo local, por ordem de check-in.
  FOR _c IN
    SELECT * FROM public.roulette_checkins
    WHERE turn_date = p_date AND start_time = p_start AND end_time = p_end AND status = 'standby'
    ORDER BY created_at
  LOOP
    SELECT ss.id INTO _slot
    FROM public.shift_slots ss JOIN public.shift_configs sc ON sc.id = ss.config_id
    WHERE ss.date = p_date AND ss.start_time = p_start AND ss.end_time = p_end
      AND sc.manager_id = _c.team_manager_id
      AND public.crm_slot_location(ss.id) = _c.location
      AND public.crm_slot_open(ss.id) > 0
    ORDER BY ss.id LIMIT 1;
    IF _slot IS NOT NULL THEN
      UPDATE public.roulette_checkins SET status = 'allocated', slot_id = _slot, decided_at = now() WHERE id = _c.id;
    END IF;
    _slot := NULL;
  END LOOP;

  -- 2/3) Bolsão geral.
  SELECT count(*) INTO _standby FROM public.roulette_checkins
   WHERE turn_date = p_date AND start_time = p_start AND end_time = p_end AND status = 'standby';
  SELECT coalesce(sum(public.crm_slot_open(ss.id)), 0) INTO _open FROM public.shift_slots ss
   WHERE ss.date = p_date AND ss.start_time = p_start AND ss.end_time = p_end;

  IF _standby > 0 AND _standby <= _open THEN
    FOR _c IN
      SELECT * FROM public.roulette_checkins
      WHERE turn_date = p_date AND start_time = p_start AND end_time = p_end AND status = 'standby'
      ORDER BY created_at
    LOOP
      SELECT ss.id INTO _slot FROM public.shift_slots ss
      WHERE ss.date = p_date AND ss.start_time = p_start AND ss.end_time = p_end
        AND public.crm_slot_location(ss.id) = _c.location
        AND public.crm_slot_open(ss.id) > 0
      ORDER BY ss.id LIMIT 1;
      IF _slot IS NOT NULL THEN
        UPDATE public.roulette_checkins SET status = 'allocated', slot_id = _slot, decided_at = now() WHERE id = _c.id;
      ELSE
        -- sem vaga no local onde está: decisão do admin
        UPDATE public.roulette_checkins SET status = 'waiting_admin' WHERE id = _c.id;
        _waiting := _waiting + 1;
      END IF;
      _slot := NULL;
    END LOOP;
  ELSIF _standby > _open THEN
    UPDATE public.roulette_checkins SET status = 'waiting_admin'
     WHERE turn_date = p_date AND start_time = p_start AND end_time = p_end AND status = 'standby';
    _waiting := _standby;
  END IF;

  -- Faltas dos escalados (sem check-in) → gerente avisado.
  WITH missed AS (
    UPDATE public.shifts sh SET missed_at = now()
     WHERE sh.date = p_date AND sh.start_time = p_start AND sh.end_time = p_end AND sh.missed_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.roulette_checkins rc
                       WHERE rc.shift_id = sh.id AND rc.status = 'validated')
    RETURNING sh.broker_id
  )
  INSERT INTO public.notification_outbox (user_id, title, body, url)
  SELECT p.manager_id, 'Check-in não realizado',
         p.full_name || ' não fez check-in no turno ' || _label || '.', '/schedule'
  FROM missed m JOIN public.profiles p ON p.id = m.broker_id
  WHERE p.manager_id IS NOT NULL;

  -- Stand-bys: resultado.
  INSERT INTO public.notification_outbox (user_id, title, body, url)
  SELECT rc.broker_id,
         CASE rc.status WHEN 'allocated' THEN 'Você entrou na roleta' ELSE 'Check-in em análise' END,
         CASE rc.status
           WHEN 'allocated' THEN 'Vaga confirmada no turno ' || _label || ' (' || public.crm_location_label(rc.location) || ').'
           ELSE 'Há mais stand-by do que vagas no turno ' || _label || '. O administrador vai decidir.'
         END,
         '/schedule'
  FROM public.roulette_checkins rc
  WHERE rc.turn_date = p_date AND rc.start_time = p_start AND rc.end_time = p_end
    AND rc.kind = 'standby' AND rc.status IN ('allocated', 'waiting_admin');

  -- Admin: decisão manual.
  IF _waiting > 0 THEN
    INSERT INTO public.notification_outbox (user_id, title, body, url)
    SELECT p.id, 'Roleta aguardando sua decisão',
           _waiting || ' corretor(es) em stand-by para o turno ' || _label || ' e ' ||
           (SELECT coalesce(sum(public.crm_slot_open(ss.id)), 0) FROM public.shift_slots ss
             WHERE ss.date = p_date AND ss.start_time = p_start AND ss.end_time = p_end) || ' vaga(s) aberta(s).',
           '/schedule'
    FROM public.profiles p WHERE p.role IN ('admin', 'director') AND p.is_active;
  END IF;

  UPDATE public.roulette_turns
     SET processed_at = now(), needs_admin = (_waiting > 0), standby_count = _standby, open_count = _open
   WHERE turn_date = p_date AND start_time = p_start AND end_time = p_end;

  RETURN jsonb_build_object('standby', _standby, 'open', _open, 'waiting_admin', _waiting);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_process_roulette_turn(DATE, TIME, TIME) FROM PUBLIC, anon, authenticated;

-- Processa todos os turnos cuja tolerância já terminou (chamado pelo cron a cada minuto).
CREATE OR REPLACE FUNCTION public.crm_process_due_roulette_turns()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cfg public.roulette_settings%ROWTYPE;
  _t RECORD;
  _n INT := 0;
BEGIN
  SELECT * INTO _cfg FROM public.roulette_settings WHERE id = 1;
  FOR _t IN
    SELECT DISTINCT ss.date, ss.start_time, ss.end_time
    FROM public.shift_slots ss
    LEFT JOIN public.roulette_turns rt
      ON rt.turn_date = ss.date AND rt.start_time = ss.start_time AND rt.end_time = ss.end_time
    WHERE ss.date BETWEEN public.crm_now_local()::date - 1 AND public.crm_now_local()::date
      AND (ss.date + ss.start_time) + make_interval(mins => _cfg.tolerance_min) <= public.crm_now_local()
      AND rt.processed_at IS NULL
  LOOP
    PERFORM public.crm_process_roulette_turn(_t.date, _t.start_time, _t.end_time);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_process_due_roulette_turns() FROM PUBLIC, anon, authenticated;

-- ── Decisão manual do admin ─────────────────────────────────────────────────
-- p_slot_id = vaga a ocupar (mesmo turno e mesmo local do check-in); NULL = fica de fora.
CREATE OR REPLACE FUNCTION public.crm_roulette_admin_decide(p_checkin_id UUID, p_slot_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _c public.roulette_checkins%ROWTYPE;
  _s public.shift_slots%ROWTYPE;
  _label TEXT;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Somente o administrador decide as vagas da roleta.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _c FROM public.roulette_checkins WHERE id = p_checkin_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Check-in não encontrado.'; END IF;
  IF _c.status NOT IN ('waiting_admin', 'standby') THEN
    RAISE EXCEPTION 'Este check-in já foi decidido.';
  END IF;
  _label := to_char(_c.start_time, 'HH24:MI') || '–' || to_char(_c.end_time, 'HH24:MI');

  IF p_slot_id IS NULL THEN
    UPDATE public.roulette_checkins SET status = 'not_allocated', decided_by = auth.uid(), decided_at = now()
     WHERE id = _c.id;
    INSERT INTO public.notification_outbox (user_id, title, body, url)
    VALUES (_c.broker_id, 'Sem vaga na roleta', 'Você não foi alocado no turno ' || _label || '.', '/schedule');
    RETURN;
  END IF;

  SELECT * INTO _s FROM public.shift_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND OR _s.date <> _c.turn_date OR _s.start_time <> _c.start_time OR _s.end_time <> _c.end_time THEN
    RAISE EXCEPTION 'A vaga escolhida não é deste turno.';
  END IF;
  IF public.crm_slot_location(_s.id) <> _c.location THEN
    RAISE EXCEPTION 'O corretor está %; escolha uma vaga desse local.', public.crm_location_in(_c.location);
  END IF;
  IF public.crm_slot_open(_s.id) <= 0 THEN
    RAISE EXCEPTION 'Esta vaga já está preenchida.';
  END IF;

  UPDATE public.roulette_checkins
     SET status = 'allocated', slot_id = _s.id, decided_by = auth.uid(), decided_at = now()
   WHERE id = _c.id;
  INSERT INTO public.notification_outbox (user_id, title, body, url)
  VALUES (_c.broker_id, 'Você entrou na roleta',
          'Vaga confirmada no turno ' || _label || ' (' || public.crm_location_label(_c.location) || ').', '/schedule');

  UPDATE public.roulette_turns SET needs_admin = EXISTS (
    SELECT 1 FROM public.roulette_checkins
    WHERE turn_date = _c.turn_date AND start_time = _c.start_time AND end_time = _c.end_time AND status = 'waiting_admin')
  WHERE turn_date = _c.turn_date AND start_time = _c.start_time AND end_time = _c.end_time;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_roulette_admin_decide(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_roulette_admin_decide(UUID, UUID) TO authenticated;

-- ── Quem está na roleta agora (usado pela distribuição de leads) ────────────
CREATE OR REPLACE FUNCTION public.crm_roulette_on_duty(p_at TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (broker_id UUID, location TEXT, team_manager_id UUID)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rc.broker_id, rc.location, rc.team_manager_id
  FROM public.roulette_checkins rc
  WHERE rc.status IN ('validated', 'allocated')
    AND (p_at AT TIME ZONE 'America/Sao_Paulo') >= rc.turn_date + rc.start_time
    AND (p_at AT TIME ZONE 'America/Sao_Paulo') < rc.turn_date + rc.end_time;
$$;
REVOKE ALL ON FUNCTION public.crm_roulette_on_duty(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
