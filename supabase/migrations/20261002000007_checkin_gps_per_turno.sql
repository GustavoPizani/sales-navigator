-- O admin escolhe quais check-ins (turnos) exigem localização. Sem a exigência,
-- o corretor faz o check-in de qualquer lugar: o escalado é validado na vaga
-- dele e o stand-by entra pela Central.

ALTER TABLE public.roulette_settings
  ADD COLUMN IF NOT EXISTS manha_require_gps BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tarde_require_gps BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS noite_require_gps BOOLEAN NOT NULL DEFAULT true;

-- check-in sem localização não tem coordenadas
ALTER TABLE public.roulette_checkins ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE public.roulette_checkins ALTER COLUMN lng DROP NOT NULL;

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
  _period TEXT;
  _need_gps BOOLEAN;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT * INTO _me FROM public.profiles WHERE id = _uid;
  IF NOT FOUND OR _me.role <> 'broker' OR NOT _me.is_active THEN
    RAISE EXCEPTION 'Só corretores ativos fazem check-in na roleta.';
  END IF;
  SELECT * INTO _cfg FROM public.roulette_settings WHERE id = 1;

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

  -- O admin escolhe quais turnos exigem localização no check-in.
  SELECT ss.period INTO _period FROM public.shift_slots ss
   WHERE ss.date = _turn.turn_date AND ss.start_time = _turn.start_time AND ss.end_time = _turn.end_time
   LIMIT 1;
  _need_gps := CASE _period
    WHEN 'Manhã' THEN _cfg.manha_require_gps
    WHEN 'Tarde' THEN _cfg.tarde_require_gps
    WHEN 'Noite' THEN _cfg.noite_require_gps
    ELSE true END;

  IF _need_gps THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN RAISE EXCEPTION 'Localização não recebida. Permita o acesso ao GPS.'; END IF;
    IF p_accuracy IS NOT NULL AND p_accuracy > _cfg.max_accuracy_m THEN
      RAISE EXCEPTION 'Sinal de GPS impreciso (± % m). Tente novamente em local aberto ou com o GPS ativado.', round(p_accuracy);
    END IF;
  END IF;

  IF _cfg.central_lat IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    _d_central := public.crm_distance_m(p_lat, p_lng, _cfg.central_lat, _cfg.central_lng);
  END IF;
  IF _cfg.plantao_lat IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    _d_plantao := public.crm_distance_m(p_lat, p_lng, _cfg.plantao_lat, _cfg.plantao_lng);
  END IF;

  IF _turn.shift_id IS NOT NULL THEN
    -- Escalado: precisa estar no local da vaga dele.
    SELECT * INTO _shift FROM public.shifts WHERE id = _turn.shift_id;
    _loc := coalesce(public.crm_slot_location(_shift.slot_id), 'central');
    _dist := CASE _loc WHEN 'plantao' THEN _d_plantao ELSE _d_central END;
    IF _need_gps AND _dist IS NULL THEN
      RAISE EXCEPTION 'A localização % ainda não foi configurada pelo administrador.', public.crm_location_of(_loc);
    END IF;
    IF _need_gps AND _dist > (CASE _loc WHEN 'plantao' THEN _cfg.plantao_radius_m ELSE _cfg.central_radius_m END) THEN
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
    ELSIF NOT _need_gps THEN
      -- turno sem localização: o stand-by entra pela Central
      _loc := 'central'; _dist := NULL;
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
    'gps_required', _need_gps,
    'allocation_at', (_turn.turn_date + _turn.start_time) + make_interval(mins => _cfg.tolerance_min)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.crm_roulette_checkin(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_roulette_checkin(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
