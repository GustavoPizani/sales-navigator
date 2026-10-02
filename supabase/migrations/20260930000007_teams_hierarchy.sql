-- Equipes: Admin → Gerentes (role 'master') → Corretores (role 'broker').
--   Admin    vê e gerencia tudo; cadastra gerentes e corretores; move corretores.
--   Gerente  vê só a própria equipe; cadastra corretores nela; faz a escala dela.
--   Corretor vê só o que é dele.
--
-- Também fecha brechas antigas:
--   * profiles_self_update permitia a qualquer usuário alterar o próprio role
--     e manager_id (virar admin pela API);
--   * is_admin() tratava 'master' como admin (gerente via/alterava tudo);
--   * admin_reset_password deixava qualquer gerente trocar a senha de qualquer um;
--   * claim_shift_slot aceitava criar plantão em nome de qualquer corretor.

-- ── Papéis ──────────────────────────────────────────────────────────────────
-- Admin global = 'admin' (e 'director', legado). 'master' deixa de ser admin.
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role IN ('admin', 'director') AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_manager(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND role = 'master' AND is_active = true
  );
$$;
REVOKE ALL ON FUNCTION public.is_manager(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_manager(UUID) TO authenticated;

-- ── Perfis ──────────────────────────────────────────────────────────────────
-- Só o admin altera papel e equipe (manager_id). Rotinas sem usuário (service
-- role, gatilhos de cadastro) e as RPCs abaixo (que validam permissões e
-- marcam app.crm_member_setup) continuam podendo.
CREATE OR REPLACE FUNCTION public.profiles_protect_privileged()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(current_setting('app.crm_member_setup', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.manager_id IS DISTINCT FROM OLD.manager_id)
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Somente o administrador pode alterar o papel ou a equipe de um usuário.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_protect_privileged ON public.profiles;
CREATE TRIGGER profiles_protect_privileged BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_privileged();

-- Cadastro: todo novo usuário nasce corretor (o 1º usuário do sistema é admin).
-- Pelo link de convite (metadata manager_id), entra na equipe do gerente/admin
-- que convidou, se ele existir e estiver ativo.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _count INT;
  _role public.app_role;
  _manager UUID;
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

  INSERT INTO public.profiles (id, email, full_name, role, phone, manager_id)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    _role,
    nullif(NEW.raw_user_meta_data->>'phone', ''),
    _manager
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Configura um usuário recém-cadastrado (signUp) como gerente ou corretor.
--   Admin:   gerente (fica abaixo do admin) ou corretor em qualquer equipe.
--   Gerente: só corretor, e sempre na própria equipe.
-- Só vale para contas criadas há pouco e ainda sem equipe, para não permitir
-- "sequestrar" usuários existentes.
CREATE OR REPLACE FUNCTION public.crm_setup_member(
  p_user_id UUID,
  p_role public.app_role,
  p_manager_id UUID DEFAULT NULL,
  p_team_name TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller UUID := auth.uid();
  _target public.profiles%ROWTYPE;
  _created TIMESTAMPTZ;
  _manager UUID;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT * INTO _target FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuário não encontrado.'; END IF;
  SELECT created_at INTO _created FROM auth.users WHERE id = p_user_id;
  IF _target.role <> 'broker' OR _target.manager_id IS NOT NULL
     OR _created IS NULL OR _created < now() - interval '30 minutes' THEN
    RAISE EXCEPTION 'Este usuário já está configurado.';
  END IF;

  IF public.is_admin(_caller) THEN
    IF p_role = 'master' THEN
      _manager := _caller;
    ELSIF p_role = 'broker' THEN
      _manager := coalesce(p_manager_id, _caller);
      IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _manager
                     AND role IN ('master', 'admin', 'director') AND is_active = true) THEN
        RAISE EXCEPTION 'Equipe inválida.';
      END IF;
    ELSE
      RAISE EXCEPTION 'Papel inválido.';
    END IF;
  ELSIF public.is_manager(_caller) THEN
    IF p_role <> 'broker' THEN
      RAISE EXCEPTION 'Gerentes só podem cadastrar corretores.' USING ERRCODE = '42501';
    END IF;
    _manager := _caller;
  ELSE
    RAISE EXCEPTION 'Sem permissão para cadastrar usuários.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.crm_member_setup', 'on', true);
  UPDATE public.profiles
     SET role = p_role,
         manager_id = _manager,
         team_name = CASE WHEN p_role = 'master' THEN nullif(trim(p_team_name), '') ELSE team_name END
   WHERE id = p_user_id;
  PERFORM set_config('app.crm_member_setup', 'off', true);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_setup_member(UUID, public.app_role, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_setup_member(UUID, public.app_role, UUID, TEXT) TO authenticated;

-- Leitura de perfis: você, seu gestor, quem está abaixo de você (qualquer nível)
-- e — para o admin — todos. Corretor não vê mais os colegas de equipe.
DROP POLICY IF EXISTS "profiles_team_view" ON public.profiles;
CREATE POLICY "profiles_team_view" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR id = public.my_manager_id() OR manager_id = auth.uid());

-- Gerente edita dados dos corretores da própria equipe (papel/equipe: só admin, via gatilho).
DROP POLICY IF EXISTS "profiles_team_lead_update" ON public.profiles;
CREATE POLICY "profiles_team_lead_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_manager(auth.uid()) AND manager_id = auth.uid())
  WITH CHECK (public.is_manager(auth.uid()) AND manager_id = auth.uid());

-- ── Redefinir senha ─────────────────────────────────────────────────────────
-- Admin: qualquer usuário não-admin. Gerente: só corretores da própria equipe.
CREATE OR REPLACE FUNCTION public.admin_reset_password(p_user_id uuid, p_new_password text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT (
    (public.is_admin(v_caller) AND NOT public.is_admin(p_user_id))
    OR (public.is_manager(v_caller) AND public.crm_is_subordinate(v_caller, p_user_id))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para redefinir senha';
  END IF;
  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RAISE EXCEPTION 'Senha inválida';
  END IF;
  UPDATE auth.users
     SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"force_password_change": true}'::jsonb,
         updated_at = now()
   WHERE id = p_user_id;
  RETURN TRUE;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_reset_password(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(uuid, text) TO authenticated;

-- ── Agendamentos: por hierarquia ────────────────────────────────────────────
DROP POLICY IF EXISTS "appt_admin_read_all" ON public.appointments;
DROP POLICY IF EXISTS "appt_admin_update_all" ON public.appointments;
DROP POLICY IF EXISTS "appt_admin_delete_all" ON public.appointments;
DROP POLICY IF EXISTS "appt_hierarchy_read" ON public.appointments;
DROP POLICY IF EXISTS "appt_hierarchy_update" ON public.appointments;
DROP POLICY IF EXISTS "appt_hierarchy_delete" ON public.appointments;
CREATE POLICY "appt_hierarchy_read" ON public.appointments
  FOR SELECT TO authenticated USING (public.crm_can_access_broker(owner_id));
CREATE POLICY "appt_hierarchy_update" ON public.appointments
  FOR UPDATE TO authenticated
  USING (public.crm_can_access_broker(owner_id)) WITH CHECK (public.crm_can_access_broker(owner_id));
CREATE POLICY "appt_hierarchy_delete" ON public.appointments
  FOR DELETE TO authenticated USING (public.crm_can_access_broker(owner_id));

-- ── Visitas: leitura por hierarquia (já existe); escrita livre só do admin ──
DROP POLICY IF EXISTS "visitas_admin_all" ON public.visitas;
CREATE POLICY "visitas_admin_all" ON public.visitas
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ── Escala: cada gerente gerencia a da própria equipe; admin vê/gerencia todas ─
DROP POLICY IF EXISTS "shift_configs_manager_own" ON public.shift_configs;
CREATE POLICY "shift_configs_manager_own" ON public.shift_configs
  FOR ALL TO authenticated
  USING (public.is_manager(auth.uid()) AND manager_id = auth.uid())
  WITH CHECK (public.is_manager(auth.uid()) AND manager_id = auth.uid());

DROP POLICY IF EXISTS "shift_slots_manager_own" ON public.shift_slots;
CREATE POLICY "shift_slots_manager_own" ON public.shift_slots
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shift_configs sc WHERE sc.id = config_id
                 AND sc.manager_id = auth.uid() AND public.is_manager(auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.shift_configs sc WHERE sc.id = config_id
                 AND sc.manager_id = auth.uid() AND public.is_manager(auth.uid())));

DROP POLICY IF EXISTS "shifts_manager_team" ON public.shifts;
CREATE POLICY "shifts_manager_team" ON public.shifts
  FOR ALL TO authenticated
  USING (public.is_manager(auth.uid()) AND public.crm_is_subordinate(auth.uid(), broker_id))
  WITH CHECK (public.is_manager(auth.uid()) AND public.crm_is_subordinate(auth.uid(), broker_id));

-- Pegar vaga: o corretor só pega para si, e só vagas da escala do próprio gerente.
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

  SELECT COUNT(*) INTO v_count FROM public.shifts WHERE slot_id = p_slot_id;
  IF v_count >= v_slot.capacity THEN RAISE EXCEPTION 'Vaga esgotada.'; END IF;

  INSERT INTO public.shifts (broker_id, manager_id, date, start_time, end_time, slot_id)
  VALUES (p_broker_id, v_mgr, v_slot.date, v_slot.start_time, v_slot.end_time, p_slot_id);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_shift_slot(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_shift_slot(UUID, UUID) TO authenticated;

-- ── Leads: gerente não atende (lead é sempre de corretor ou do admin) ───────
CREATE OR REPLACE FUNCTION public.leads_broker_must_attend()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.broker_id IS DISTINCT FROM OLD.broker_id)
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.broker_id AND role = 'master') THEN
    RAISE EXCEPTION 'Gerentes não recebem leads: escolha um corretor da equipe.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS leads_broker_must_attend ON public.leads;
CREATE TRIGGER leads_broker_must_attend BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_broker_must_attend();
