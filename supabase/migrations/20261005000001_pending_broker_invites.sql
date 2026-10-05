-- Corretores pré-cadastrados pelo link do gerente ficam salvos no sistema e
-- recebem um convite individual para finalizar o cadastro. Ao se cadastrar
-- pelo convite, o corretor entra na equipe do gerente e os turnos que o
-- gerente já tinha escalado para ele viram plantões da conta nova.
-- O gerente informa o e-mail corporativo (@pgvendas.com.br) no pré-cadastro;
-- o cadastro pelo convite usa esse mesmo e-mail.

ALTER TABLE public.pending_brokers
  ADD COLUMN IF NOT EXISTS invite_token TEXT;
UPDATE public.pending_brokers SET invite_token = replace(gen_random_uuid()::text, '-', '')
 WHERE invite_token IS NULL;
ALTER TABLE public.pending_brokers
  ALTER COLUMN invite_token SET DEFAULT replace(gen_random_uuid()::text, '-', ''),
  ALTER COLUMN invite_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pending_brokers_invite_token ON public.pending_brokers (invite_token);

ALTER TABLE public.pending_brokers ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS pending_brokers_email ON public.pending_brokers (lower(email));

-- E-mail corporativo: só a parte antes do @ é digitada; o domínio é fixo.
CREATE OR REPLACE FUNCTION public.crm_corporate_email(_input TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE
  _local TEXT := lower(trim(split_part(coalesce(_input, ''), '@', 1)));
BEGIN
  IF _local !~ '^[a-z0-9][a-z0-9._-]*$' THEN
    RAISE EXCEPTION 'Informe o e-mail do corretor (o que vem antes de @pgvendas.com.br).';
  END IF;
  IF position('@' IN coalesce(_input, '')) > 0 AND lower(split_part(_input, '@', 2)) <> 'pgvendas.com.br' THEN
    RAISE EXCEPTION 'O e-mail precisa ser @pgvendas.com.br.';
  END IF;
  RETURN _local || '@pgvendas.com.br';
END;
$f$;

-- O convite não fica visível para quem só enxerga a escala (ex.: corretores).
REVOKE SELECT ON public.pending_brokers FROM authenticated;
GRANT SELECT (id, manager_id, full_name, email, created_at) ON public.pending_brokers TO authenticated;

-- Convites da equipe: admin vê todos; gerente, os da própria equipe.
DROP FUNCTION IF EXISTS public.crm_pending_invites();
CREATE OR REPLACE FUNCTION public.crm_pending_invites()
RETURNS TABLE (id UUID, manager_id UUID, full_name TEXT, email TEXT, invite_token TEXT, shifts INT, created_at TIMESTAMPTZ)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pb.id, pb.manager_id, pb.full_name, pb.email, pb.invite_token,
         (SELECT count(*)::int FROM public.pending_shifts ps WHERE ps.pending_broker_id = pb.id),
         pb.created_at
    FROM public.pending_brokers pb
   WHERE public.is_admin(auth.uid())
      OR (public.is_manager(auth.uid()) AND pb.manager_id = auth.uid())
   ORDER BY lower(pb.full_name);
$$;
REVOKE ALL ON FUNCTION public.crm_pending_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_pending_invites() TO authenticated;

-- Página de cadastro (sem login): nome e equipe do convite.
CREATE OR REPLACE FUNCTION public.crm_pending_invite(p_token TEXT)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'full_name', pb.full_name,
    'email', pb.email,
    'manager_id', pb.manager_id,
    'manager_name', p.full_name,
    'team_name', coalesce(p.team_name, p.full_name),
    'shifts', (SELECT count(*) FROM public.pending_shifts ps WHERE ps.pending_broker_id = pb.id))
    FROM public.pending_brokers pb
    JOIN public.profiles p ON p.id = pb.manager_id AND p.is_active
   WHERE pb.invite_token = p_token;
$$;
REVOKE ALL ON FUNCTION public.crm_pending_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_pending_invite(TEXT) TO anon, authenticated;

-- Passa os turnos do pré-cadastro para a conta nova e apaga o pré-cadastro.
CREATE OR REPLACE FUNCTION public.crm_claim_pending_broker(_pending_id UUID, _user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r RECORD;
BEGIN
  FOR _r IN
    SELECT ps.id AS pending_shift_id, ss.id AS slot_id, ss.date, ss.start_time, ss.end_time, sc.manager_id, sc.modality
      FROM public.pending_shifts ps
      JOIN public.shift_slots ss ON ss.id = ps.slot_id
      JOIN public.shift_configs sc ON sc.id = ss.config_id
     WHERE ps.pending_broker_id = _pending_id
  LOOP
    -- libera a vaga do pré-cadastro e a ocupa com o plantão do usuário
    DELETE FROM public.pending_shifts WHERE id = _r.pending_shift_id;
    INSERT INTO public.shifts (broker_id, manager_id, date, start_time, end_time, slot_id, notes)
    VALUES (_user_id, _r.manager_id, _r.date, _r.start_time, _r.end_time, _r.slot_id,
            public.crm_location_label(CASE WHEN _r.modality = 'salao' THEN 'plantao' ELSE 'central' END));
  END LOOP;
  DELETE FROM public.pending_brokers WHERE id = _pending_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_claim_pending_broker(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _count INT;
  _role public.app_role;
  _manager UUID;
  _pending public.pending_brokers%ROWTYPE;
BEGIN
  SELECT COUNT(*) INTO _count FROM public.profiles;
  IF _count = 0 THEN _role := 'admin'; ELSE _role := 'broker'; END IF;

  BEGIN
    _manager := nullif(NEW.raw_user_meta_data->>'manager_id', '')::uuid;
  EXCEPTION WHEN others THEN _manager := NULL;
  END;
  IF _manager IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _manager AND role IN ('master', 'admin', 'director') AND is_active = true
  ) THEN
    _manager := NULL;
  END IF;

  -- Convite de um corretor pré-cadastrado pelo link do gerente: entra na equipe
  -- dele e herda os turnos já escalados.
  IF _count > 0 AND nullif(NEW.raw_user_meta_data->>'pending_token', '') IS NOT NULL THEN
    SELECT pb.* INTO _pending FROM public.pending_brokers pb
      JOIN public.profiles p ON p.id = pb.manager_id AND p.is_active
     WHERE pb.invite_token = NEW.raw_user_meta_data->>'pending_token'
       -- o convite só vale para o e-mail que o gerente cadastrou
       AND (pb.email IS NULL OR lower(pb.email) = lower(NEW.email));
    IF FOUND THEN _manager := _pending.manager_id; END IF;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, phone, manager_id)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(nullif(NEW.raw_user_meta_data->>'full_name', ''), _pending.full_name, ''),
    _role,
    nullif(NEW.raw_user_meta_data->>'phone', ''),
    _manager
  );

  IF _pending.id IS NOT NULL THEN
    PERFORM public.crm_claim_pending_broker(_pending.id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Link do gerente: cada corretor da lista traz o convite de cadastro.
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
        SELECT jsonb_agg(jsonb_build_object('id', pb.id, 'name', pb.full_name, 'email', pb.email, 'invite_token', pb.invite_token) ORDER BY lower(pb.full_name))
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

-- Pré-cadastro pelo link do gerente: nome + e-mail corporativo.
DROP FUNCTION IF EXISTS public.crm_public_schedule_add_broker(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.crm_public_schedule_add_broker(p_token TEXT, p_name TEXT, p_email TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m UUID := public.crm_schedule_link_manager(p_token);
  _name TEXT := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  _email TEXT;
  _id UUID;
BEGIN
  IF _m IS NULL THEN RAISE EXCEPTION 'Link inválido.'; END IF;
  IF length(_name) < 2 OR length(_name) > 80 THEN
    RAISE EXCEPTION 'Informe o nome do corretor.';
  END IF;
  _email := public.crm_corporate_email(p_email);
  IF EXISTS (SELECT 1 FROM public.pending_brokers WHERE manager_id = _m AND lower(full_name) = lower(_name)) THEN
    RAISE EXCEPTION 'Esse corretor já está na lista.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pending_brokers WHERE lower(email) = _email)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = _email) THEN
    RAISE EXCEPTION 'O e-mail % já está cadastrado.', _email;
  END IF;
  IF (SELECT count(*) FROM public.pending_brokers WHERE manager_id = _m) >= 100 THEN
    RAISE EXCEPTION 'Limite de corretores da equipe atingido.';
  END IF;
  INSERT INTO public.pending_brokers (manager_id, full_name, email) VALUES (_m, _name, _email) RETURNING id INTO _id;
  RETURN _id;
END;
$$;

-- Completar o e-mail de quem foi pré-cadastrado antes dessa exigência.
CREATE OR REPLACE FUNCTION public.crm_public_schedule_set_email(p_token TEXT, p_broker_id UUID, p_email TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m UUID := public.crm_schedule_link_manager(p_token);
  _email TEXT;
BEGIN
  IF _m IS NULL THEN RAISE EXCEPTION 'Link inválido.'; END IF;
  _email := public.crm_corporate_email(p_email);
  IF EXISTS (SELECT 1 FROM public.pending_brokers WHERE lower(email) = _email AND id <> p_broker_id)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = _email) THEN
    RAISE EXCEPTION 'O e-mail % já está cadastrado.', _email;
  END IF;
  UPDATE public.pending_brokers SET email = _email WHERE id = p_broker_id AND manager_id = _m;
  IF NOT FOUND THEN RAISE EXCEPTION 'Corretor não encontrado.'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_public_schedule_add_broker(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_public_schedule_set_email(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_public_schedule_add_broker(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_public_schedule_set_email(TEXT, UUID, TEXT) TO anon, authenticated;
