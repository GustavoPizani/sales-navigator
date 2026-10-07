-- Usuário de teste invisível.
--
-- profiles.is_test marca uma conta usada só para testar funções novas. Ela:
--   * não aparece para ninguém (Time, Escala, dashboards, roletas...), nem
--     para o admin — só a própria conta enxerga o próprio perfil;
--   * os dados que ela cria (leads, plantões, check-ins, agendamentos) também
--     ficam invisíveis para os outros usuários;
--   * só pode ser marcada/desmarcada fora do app (service role).
-- O cargo e a equipe da conta de teste são trocados fora do app para simular
-- cada perfil (admin, gerente, corretor, RH).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.crm_is_test(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT is_test FROM public.profiles WHERE id = _user_id), false);
$$;
REVOKE ALL ON FUNCTION public.crm_is_test(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_is_test(UUID) TO authenticated;

-- Ninguém marca uma conta como teste pelo app (nem o admin).
CREATE OR REPLACE FUNCTION public.profiles_protect_is_test()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.is_test IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.is_test ELSE false END) THEN
    RAISE EXCEPTION 'A marcação de conta de teste não pode ser alterada pelo app.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_protect_is_test ON public.profiles;
CREATE TRIGGER profiles_protect_is_test BEFORE INSERT OR UPDATE OF is_test ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_is_test();

-- ── Invisibilidade (somada às regras já existentes) ─────────────────────────
DROP POLICY IF EXISTS "test_profiles_hidden" ON public.profiles;
CREATE POLICY "test_profiles_hidden" ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT is_test OR id = auth.uid());

DROP POLICY IF EXISTS "test_leads_hidden" ON public.leads;
CREATE POLICY "test_leads_hidden" ON public.leads AS RESTRICTIVE FOR SELECT TO authenticated
  USING (broker_id = auth.uid() OR NOT public.crm_is_test(broker_id));

DROP POLICY IF EXISTS "test_shifts_hidden" ON public.shifts;
CREATE POLICY "test_shifts_hidden" ON public.shifts AS RESTRICTIVE FOR SELECT TO authenticated
  USING (broker_id = auth.uid() OR NOT public.crm_is_test(broker_id));

DROP POLICY IF EXISTS "test_checkins_hidden" ON public.roulette_checkins;
CREATE POLICY "test_checkins_hidden" ON public.roulette_checkins AS RESTRICTIVE FOR SELECT TO authenticated
  USING (broker_id = auth.uid() OR NOT public.crm_is_test(broker_id));

DROP POLICY IF EXISTS "test_checkin_log_hidden" ON public.checkin_log;
CREATE POLICY "test_checkin_log_hidden" ON public.checkin_log AS RESTRICTIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR NOT public.crm_is_test(user_id));

DROP POLICY IF EXISTS "test_appointments_hidden" ON public.appointments;
CREATE POLICY "test_appointments_hidden" ON public.appointments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR NOT public.crm_is_test(owner_id));

-- Avisos automáticos (faltas, lembretes) não citam nem chegam por causa da conta de teste.
CREATE OR REPLACE FUNCTION public.notification_outbox_skip_test()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- aviso para outra pessoa sobre a conta de teste (ex.: "Fulano não fez check-in")
  IF NOT public.crm_is_test(NEW.user_id) AND EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.is_test AND p.full_name <> '' AND position(p.full_name IN NEW.body) > 0) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notification_outbox_skip_test ON public.notification_outbox;
CREATE TRIGGER notification_outbox_skip_test BEFORE INSERT ON public.notification_outbox
  FOR EACH ROW EXECUTE FUNCTION public.notification_outbox_skip_test();
