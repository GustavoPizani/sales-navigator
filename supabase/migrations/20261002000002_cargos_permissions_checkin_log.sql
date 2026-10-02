-- Cargos cadastráveis, matriz de permissões (Cargo x Módulo) com histórico,
-- bloqueio por módulo no banco e log imutável de check-ins (ADM e RH).
--
-- Dois eixos independentes:
--   * QUAIS MÓDULOS o usuário acessa  → cargo_permissions (hidden | view | edit)
--   * QUAIS DADOS ele vê nos módulos  → tipo base do cargo (profiles.role):
--       admin = tudo | master = a própria equipe | broker = só os seus | hr = nenhum lead
-- As duas regras valem juntas (políticas RESTRICTIVE somam-se às existentes).

-- ── Cargos ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cargos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  -- tipo base: define o alcance dos dados (ver cabeçalho)
  base_role public.app_role NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,   -- ADM, RH, Gestor, Corretor: não podem ser excluídos
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.cargos (name, base_role, is_system) VALUES
  ('ADM', 'admin', true),
  ('RH', 'hr', true),
  ('Gestor', 'master', true),
  ('Corretor', 'broker', true)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cargo_id UUID REFERENCES public.cargos(id);

-- Cargo padrão (de sistema) de cada tipo base.
CREATE OR REPLACE FUNCTION public.crm_default_cargo(_role public.app_role)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.cargos
  WHERE is_system AND base_role = (CASE WHEN _role = 'director' THEN 'admin'::public.app_role ELSE _role END)
  LIMIT 1;
$$;

UPDATE public.profiles SET cargo_id = public.crm_default_cargo(role) WHERE cargo_id IS NULL;

-- Mantém cargo e tipo base sincronizados: trocar o cargo ajusta o tipo; trocar
-- o tipo (cadastro, rotinas antigas) aplica o cargo padrão daquele tipo.
-- (nome com "a_" para rodar antes de profiles_protect_privileged)
CREATE OR REPLACE FUNCTION public.profiles_sync_cargo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cargo_id IS NULL THEN
      NEW.cargo_id := public.crm_default_cargo(NEW.role);
    ELSE
      SELECT base_role INTO NEW.role FROM public.cargos WHERE id = NEW.cargo_id;
    END IF;
  ELSIF NEW.cargo_id IS DISTINCT FROM OLD.cargo_id AND NEW.cargo_id IS NOT NULL THEN
    SELECT base_role INTO NEW.role FROM public.cargos WHERE id = NEW.cargo_id;
  ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
    NEW.cargo_id := public.crm_default_cargo(NEW.role);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_a_sync_cargo ON public.profiles;
CREATE TRIGGER profiles_a_sync_cargo BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_sync_cargo();

-- Só o admin altera papel, cargo e equipe; e o sistema nunca fica sem admin ativo.
CREATE OR REPLACE FUNCTION public.profiles_protect_privileged()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.role = 'admin' AND OLD.is_active
     AND (NEW.role <> 'admin' OR NOT NEW.is_active)
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin' AND is_active AND id <> OLD.id) THEN
    RAISE EXCEPTION 'O sistema precisa de pelo menos um administrador ativo.';
  END IF;

  IF auth.uid() IS NULL OR coalesce(current_setting('app.crm_member_setup', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.manager_id IS DISTINCT FROM OLD.manager_id
      OR NEW.cargo_id IS DISTINCT FROM OLD.cargo_id)
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Somente o administrador pode alterar o cargo ou a equipe de um usuário.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_hr(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND role = 'hr' AND is_active = true);
$$;
REVOKE ALL ON FUNCTION public.is_hr(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_hr(UUID) TO authenticated;

ALTER TABLE public.cargos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cargos_read" ON public.cargos;
CREATE POLICY "cargos_read" ON public.cargos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cargos_admin_write" ON public.cargos;
CREATE POLICY "cargos_admin_write" ON public.cargos FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cargos TO authenticated;

-- Cargos de sistema não são excluídos nem mudam de tipo; ninguém cria outro cargo admin.
CREATE OR REPLACE FUNCTION public.cargos_protect()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- migrations e rotinas de serviço (sem usuário logado) não passam pela trava
  IF auth.uid() IS NULL THEN RETURN coalesce(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN RAISE EXCEPTION 'Cargos do sistema não podem ser excluídos.'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_system
     AND (NEW.base_role <> OLD.base_role OR NOT NEW.is_system OR NOT NEW.is_active) THEN
    RAISE EXCEPTION 'Cargos do sistema não podem ser alterados dessa forma.';
  END IF;
  IF NEW.base_role IN ('admin', 'director') AND NOT (TG_OP = 'UPDATE' AND OLD.is_system) THEN
    RAISE EXCEPTION 'Não é possível criar outro cargo com acesso total. Use o cargo ADM.';
  END IF;
  IF TG_OP = 'INSERT' THEN NEW.is_system := false; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cargos_protect ON public.cargos;
CREATE TRIGGER cargos_protect BEFORE INSERT OR UPDATE OR DELETE ON public.cargos
  FOR EACH ROW EXECUTE FUNCTION public.cargos_protect();

-- ── Matriz de permissões ────────────────────────────────────────────────────
-- Módulos: dashboard, leads, schedule, checkin, appointments, projects, team.
-- Fixos (fora da matriz): "Permissões" = só ADM; "Log de check-ins" = ADM e RH.
CREATE TABLE IF NOT EXISTS public.cargo_permissions (
  cargo_id UUID NOT NULL REFERENCES public.cargos(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('hidden', 'view', 'edit')),
  PRIMARY KEY (cargo_id, module)
);

INSERT INTO public.cargo_permissions (cargo_id, module, level)
SELECT c.id, m.module, m.level
FROM public.cargos c
JOIN (VALUES
  ('master', 'dashboard', 'view'), ('master', 'leads', 'edit'), ('master', 'schedule', 'edit'),
  ('master', 'checkin', 'view'), ('master', 'appointments', 'edit'), ('master', 'projects', 'view'),
  ('master', 'team', 'edit'),
  ('broker', 'dashboard', 'view'), ('broker', 'leads', 'edit'), ('broker', 'schedule', 'edit'),
  ('broker', 'checkin', 'edit'), ('broker', 'appointments', 'edit'), ('broker', 'projects', 'view'),
  ('broker', 'team', 'hidden'),
  ('hr', 'dashboard', 'hidden'), ('hr', 'leads', 'hidden'), ('hr', 'schedule', 'hidden'),
  ('hr', 'checkin', 'hidden'), ('hr', 'appointments', 'hidden'), ('hr', 'projects', 'hidden'),
  ('hr', 'team', 'hidden')
) AS m(base, module, level) ON m.base = c.base_role::text
WHERE c.is_system
ON CONFLICT (cargo_id, module) DO NOTHING;

ALTER TABLE public.cargo_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cargo_permissions_read" ON public.cargo_permissions;
CREATE POLICY "cargo_permissions_read" ON public.cargo_permissions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cargo_permissions_admin_write" ON public.cargo_permissions;
CREATE POLICY "cargo_permissions_admin_write" ON public.cargo_permissions FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cargo_permissions TO authenticated;

-- Histórico de toda alteração de permissão (quem, o quê, quando).
CREATE TABLE IF NOT EXISTS public.permission_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_by UUID,
  changed_by_name TEXT,
  cargo_id UUID,
  cargo_name TEXT,
  module TEXT NOT NULL,
  old_level TEXT,
  new_level TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.permission_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "permission_audit_admin_read" ON public.permission_audit;
CREATE POLICY "permission_audit_admin_read" ON public.permission_audit FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
GRANT SELECT ON public.permission_audit TO authenticated;

CREATE OR REPLACE FUNCTION public.cargo_permissions_guard_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cargo public.cargos%ROWTYPE;
  _old TEXT;
  _new TEXT;
BEGIN
  SELECT * INTO _cargo FROM public.cargos WHERE id = coalesce(NEW.cargo_id, OLD.cargo_id);
  -- o ADM tem sempre acesso total: não entra na matriz
  IF _cargo.base_role IN ('admin', 'director') THEN
    RAISE EXCEPTION 'O cargo ADM tem sempre acesso total e não pode ser alterado.';
  END IF;
  _old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.level END;
  _new := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.level END;
  IF _old IS DISTINCT FROM _new AND auth.uid() IS NOT NULL THEN
    INSERT INTO public.permission_audit (changed_by, changed_by_name, cargo_id, cargo_name, module, old_level, new_level)
    VALUES (auth.uid(), (SELECT full_name FROM public.profiles WHERE id = auth.uid()),
            _cargo.id, _cargo.name, coalesce(NEW.module, OLD.module), _old, _new);
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS cargo_permissions_guard_audit ON public.cargo_permissions;
CREATE TRIGGER cargo_permissions_guard_audit BEFORE INSERT OR UPDATE OR DELETE ON public.cargo_permissions
  FOR EACH ROW EXECUTE FUNCTION public.cargo_permissions_guard_audit();

-- Nível do usuário logado em um módulo.
CREATE OR REPLACE FUNCTION public.crm_module_level(_module TEXT)
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT CASE
        WHEN p.role IN ('admin', 'director') THEN 'edit'
        ELSE coalesce((SELECT cp.level FROM public.cargo_permissions cp
                       WHERE cp.cargo_id = p.cargo_id AND cp.module = _module), 'hidden')
      END
     FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active),
    'hidden');
$$;
-- _min: 'view' (visualização ou edição) | 'edit' (só edição)
CREATE OR REPLACE FUNCTION public.crm_can(_module TEXT, _min TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE public.crm_module_level(_module)
    WHEN 'edit' THEN true
    WHEN 'view' THEN _min = 'view'
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.crm_module_level(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_can(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_module_level(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_can(TEXT, TEXT) TO authenticated;

-- ── Bloqueio por módulo no banco (somado às regras de equipe já existentes) ──
-- Atendimentos (leads e anotações)
DROP POLICY IF EXISTS "mod_leads_select" ON public.leads;
CREATE POLICY "mod_leads_select" ON public.leads AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.crm_can('leads', 'view'));
DROP POLICY IF EXISTS "mod_leads_insert" ON public.leads;
CREATE POLICY "mod_leads_insert" ON public.leads AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.crm_can('leads', 'edit'));
DROP POLICY IF EXISTS "mod_leads_update" ON public.leads;
CREATE POLICY "mod_leads_update" ON public.leads AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.crm_can('leads', 'edit'));
DROP POLICY IF EXISTS "mod_leads_delete" ON public.leads;
CREATE POLICY "mod_leads_delete" ON public.leads AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.crm_can('leads', 'edit'));

DROP POLICY IF EXISTS "mod_lead_notes_select" ON public.lead_notes;
CREATE POLICY "mod_lead_notes_select" ON public.lead_notes AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.crm_can('leads', 'view'));
DROP POLICY IF EXISTS "mod_lead_notes_insert" ON public.lead_notes;
CREATE POLICY "mod_lead_notes_insert" ON public.lead_notes AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.crm_can('leads', 'edit'));
DROP POLICY IF EXISTS "mod_lead_notes_update" ON public.lead_notes;
CREATE POLICY "mod_lead_notes_update" ON public.lead_notes AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.crm_can('leads', 'edit'));
DROP POLICY IF EXISTS "mod_lead_notes_delete" ON public.lead_notes;
CREATE POLICY "mod_lead_notes_delete" ON public.lead_notes AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.crm_can('leads', 'edit'));

-- Agendamentos
DROP POLICY IF EXISTS "mod_appt_select" ON public.appointments;
CREATE POLICY "mod_appt_select" ON public.appointments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.crm_can('appointments', 'view'));
DROP POLICY IF EXISTS "mod_appt_insert" ON public.appointments;
CREATE POLICY "mod_appt_insert" ON public.appointments AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.crm_can('appointments', 'edit'));
DROP POLICY IF EXISTS "mod_appt_update" ON public.appointments;
CREATE POLICY "mod_appt_update" ON public.appointments AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.crm_can('appointments', 'edit'));
DROP POLICY IF EXISTS "mod_appt_delete" ON public.appointments;
CREATE POLICY "mod_appt_delete" ON public.appointments AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.crm_can('appointments', 'edit'));

-- Escala (a leitura também serve à tela de Check-in)
DROP POLICY IF EXISTS "mod_shifts_select" ON public.shifts;
CREATE POLICY "mod_shifts_select" ON public.shifts AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.crm_can('schedule', 'view') OR public.crm_can('checkin', 'view'));
DROP POLICY IF EXISTS "mod_shifts_insert" ON public.shifts;
CREATE POLICY "mod_shifts_insert" ON public.shifts AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.crm_can('schedule', 'edit'));
DROP POLICY IF EXISTS "mod_shifts_update" ON public.shifts;
CREATE POLICY "mod_shifts_update" ON public.shifts AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.crm_can('schedule', 'edit'));
DROP POLICY IF EXISTS "mod_shifts_delete" ON public.shifts;
CREATE POLICY "mod_shifts_delete" ON public.shifts AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.crm_can('schedule', 'edit'));

DROP POLICY IF EXISTS "mod_shift_configs_select" ON public.shift_configs;
CREATE POLICY "mod_shift_configs_select" ON public.shift_configs AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.crm_can('schedule', 'view') OR public.crm_can('checkin', 'view'));
DROP POLICY IF EXISTS "mod_shift_slots_select" ON public.shift_slots;
CREATE POLICY "mod_shift_slots_select" ON public.shift_slots AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.crm_can('schedule', 'view') OR public.crm_can('checkin', 'view'));

-- Check-in da roleta
DROP POLICY IF EXISTS "mod_roulette_checkins_select" ON public.roulette_checkins;
CREATE POLICY "mod_roulette_checkins_select" ON public.roulette_checkins AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.crm_can('checkin', 'view'));

-- Fazer check-in exige "edição" no módulo Check-in.
CREATE OR REPLACE FUNCTION public.roulette_checkins_require_module()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.crm_can('checkin', 'edit') THEN
    RAISE EXCEPTION 'Seu cargo não tem permissão para fazer check-in.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS roulette_checkins_require_module ON public.roulette_checkins;
CREATE TRIGGER roulette_checkins_require_module BEFORE INSERT ON public.roulette_checkins
  FOR EACH ROW EXECUTE FUNCTION public.roulette_checkins_require_module();

-- ── Cadastro de usuários: admin também cadastra RH ──────────────────────────
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
    ELSIF p_role = 'hr' THEN
      _manager := NULL;
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
    IF NOT public.crm_can('team', 'edit') THEN
      RAISE EXCEPTION 'Seu cargo não tem permissão para cadastrar usuários.' USING ERRCODE = '42501';
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

-- ── Log de check-ins (somente ADM e RH; imutável) ───────────────────────────
-- Registra a hora e o local de cada check-in, as faltas e as substituições.
-- Nomes ficam gravados no próprio registro (histórico fiel mesmo se o usuário
-- mudar de equipe ou for removido).
CREATE TABLE IF NOT EXISTS public.checkin_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  turn_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  user_id UUID NOT NULL,
  user_name TEXT NOT NULL,
  team_manager_id UUID,
  team_name TEXT,
  -- checkin: escalado validado | standby: entrou como stand-by | substituicao: stand-by assumiu vaga
  -- aguardando_admin | nao_alocado | falta: escalado sem check-in | ajuste: correção com justificativa
  event TEXT NOT NULL CHECK (event IN ('checkin', 'standby', 'substituicao', 'aguardando_admin', 'nao_alocado', 'falta', 'ajuste')),
  location TEXT,
  location_label TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  accuracy_m DOUBLE PRECISION,
  distance_m INT,
  slot_team_name TEXT,        -- equipe dona da vaga assumida
  replaced_names TEXT,        -- quem faltou na vaga assumida
  checkin_id UUID,
  shift_id UUID,
  adjusts_id UUID,            -- registro corrigido (para event = 'ajuste')
  event_override TEXT CHECK (event_override IN ('presente', 'falta')),
  justification TEXT,
  created_by UUID,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkin_log_date_idx ON public.checkin_log (turn_date, user_id);

ALTER TABLE public.checkin_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "checkin_log_admin_hr_read" ON public.checkin_log;
CREATE POLICY "checkin_log_admin_hr_read" ON public.checkin_log FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_hr(auth.uid()));
GRANT SELECT ON public.checkin_log TO authenticated;

-- Nunca editar nem excluir: correções viram um novo registro de ajuste.
CREATE OR REPLACE FUNCTION public.checkin_log_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'O log de check-ins não pode ser alterado nem excluído. Registre um ajuste.';
END;
$$;
DROP TRIGGER IF EXISTS checkin_log_immutable ON public.checkin_log;
CREATE TRIGGER checkin_log_immutable BEFORE UPDATE OR DELETE ON public.checkin_log
  FOR EACH ROW EXECUTE FUNCTION public.checkin_log_immutable();

CREATE OR REPLACE FUNCTION public.crm_team_name(_manager_id UUID)
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(team_name, full_name) FROM public.profiles WHERE id = _manager_id;
$$;

-- Check-in feito / mudança de situação do stand-by → log
CREATE OR REPLACE FUNCTION public.roulette_checkins_to_log()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _event TEXT;
  _slot_team TEXT;
  _replaced TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _event := CASE NEW.status WHEN 'validated' THEN 'checkin' ELSE 'standby' END;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    _event := CASE NEW.status
      WHEN 'allocated' THEN 'substituicao'
      WHEN 'waiting_admin' THEN 'aguardando_admin'
      WHEN 'not_allocated' THEN 'nao_alocado'
      ELSE NULL END;
  END IF;
  IF _event IS NULL THEN RETURN NULL; END IF;

  IF _event = 'substituicao' AND NEW.slot_id IS NOT NULL THEN
    SELECT public.crm_team_name(sc.manager_id) INTO _slot_team
    FROM public.shift_slots ss JOIN public.shift_configs sc ON sc.id = ss.config_id WHERE ss.id = NEW.slot_id;
    -- escalados dessa vaga que não fizeram check-in
    SELECT string_agg(p.full_name, ', ' ORDER BY p.full_name) INTO _replaced
    FROM public.shifts sh JOIN public.profiles p ON p.id = sh.broker_id
    WHERE sh.slot_id = NEW.slot_id
      AND NOT EXISTS (SELECT 1 FROM public.roulette_checkins rc WHERE rc.shift_id = sh.id AND rc.status = 'validated');
  END IF;

  INSERT INTO public.checkin_log
    (occurred_at, turn_date, start_time, end_time, user_id, user_name, team_manager_id, team_name, event,
     location, location_label, lat, lng, accuracy_m, distance_m, slot_team_name, replaced_names,
     checkin_id, shift_id, created_by, created_by_name)
  VALUES
    (CASE WHEN TG_OP = 'INSERT' THEN NEW.created_at ELSE now() END,
     NEW.turn_date, NEW.start_time, NEW.end_time, NEW.broker_id,
     coalesce((SELECT full_name FROM public.profiles WHERE id = NEW.broker_id), '—'),
     NEW.team_manager_id, public.crm_team_name(NEW.team_manager_id), _event,
     NEW.location, public.crm_location_label(NEW.location), NEW.lat, NEW.lng, NEW.accuracy_m, NEW.distance_m,
     _slot_team, _replaced, NEW.id, NEW.shift_id,
     NEW.decided_by, (SELECT full_name FROM public.profiles WHERE id = NEW.decided_by));
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS roulette_checkins_to_log ON public.roulette_checkins;
CREATE TRIGGER roulette_checkins_to_log AFTER INSERT OR UPDATE OF status ON public.roulette_checkins
  FOR EACH ROW EXECUTE FUNCTION public.roulette_checkins_to_log();

-- Falta do escalado → log
CREATE OR REPLACE FUNCTION public.shifts_missed_to_log()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _p public.profiles%ROWTYPE;
  _loc TEXT;
BEGIN
  IF NEW.missed_at IS NULL OR OLD.missed_at IS NOT NULL THEN RETURN NULL; END IF;
  SELECT * INTO _p FROM public.profiles WHERE id = NEW.broker_id;
  _loc := coalesce(public.crm_slot_location(NEW.slot_id), 'central');
  INSERT INTO public.checkin_log
    (occurred_at, turn_date, start_time, end_time, user_id, user_name, team_manager_id, team_name, event,
     location, location_label, shift_id)
  VALUES
    (NEW.missed_at, NEW.date, NEW.start_time, NEW.end_time, NEW.broker_id, coalesce(_p.full_name, '—'),
     _p.manager_id, public.crm_team_name(_p.manager_id), 'falta',
     _loc, public.crm_location_label(_loc), NEW.id);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS shifts_missed_to_log ON public.shifts;
CREATE TRIGGER shifts_missed_to_log AFTER UPDATE OF missed_at ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_missed_to_log();

-- Ajuste (ADM ou RH): novo registro com justificativa e autor.
-- p_event_override: 'presente' | 'falta' | NULL (só observação/horário corrigido)
CREATE OR REPLACE FUNCTION public.crm_checkin_log_adjust(
  p_log_id UUID,
  p_justification TEXT,
  p_event_override TEXT DEFAULT NULL,
  p_occurred_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _o public.checkin_log%ROWTYPE;
  _id UUID;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.is_hr(auth.uid())) THEN
    RAISE EXCEPTION 'Somente ADM e RH podem ajustar o log de check-ins.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(p_justification), '') = '' THEN
    RAISE EXCEPTION 'Informe a justificativa do ajuste.';
  END IF;
  IF p_event_override IS NOT NULL AND p_event_override NOT IN ('presente', 'falta') THEN
    RAISE EXCEPTION 'Ajuste inválido.';
  END IF;
  SELECT * INTO _o FROM public.checkin_log WHERE id = p_log_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado.'; END IF;

  INSERT INTO public.checkin_log
    (occurred_at, turn_date, start_time, end_time, user_id, user_name, team_manager_id, team_name, event,
     location, location_label, adjusts_id, event_override, justification, created_by, created_by_name)
  VALUES
    (coalesce(p_occurred_at, _o.occurred_at), _o.turn_date, _o.start_time, _o.end_time, _o.user_id, _o.user_name,
     _o.team_manager_id, _o.team_name, 'ajuste', _o.location, _o.location_label,
     coalesce(_o.adjusts_id, _o.id), p_event_override, trim(p_justification), auth.uid(),
     (SELECT full_name FROM public.profiles WHERE id = auth.uid()))
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_checkin_log_adjust(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_checkin_log_adjust(UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
