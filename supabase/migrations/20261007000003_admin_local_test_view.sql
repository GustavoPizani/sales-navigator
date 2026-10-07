-- O admin enxerga a conta de teste e os dados dela, mas só quando roda o
-- sistema localmente.
--
-- Duas condições juntas:
--   * profiles.can_see_test = true (só se marca fora do app, service role);
--   * a requisição traz o cabeçalho "x-test-view: 1", que só o app em modo
--     de desenvolvimento (npm run dev) envia.
-- Em produção o cabeçalho não é enviado, então o admin continua sem ver nada
-- de teste. O cabeçalho sozinho não libera nada para quem não tem a marcação.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS can_see_test BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.crm_sees_test()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT can_see_test FROM public.profiles WHERE id = auth.uid()), false)
     AND coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-test-view', '') = '1';
$$;
REVOKE ALL ON FUNCTION public.crm_sees_test() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sees_test() TO authenticated;

-- As duas marcações (is_test e can_see_test) só mudam fora do app.
CREATE OR REPLACE FUNCTION public.profiles_protect_is_test()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (
       NEW.is_test IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.is_test ELSE false END)
    OR NEW.can_see_test IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.can_see_test ELSE false END)) THEN
    RAISE EXCEPTION 'A marcação de conta de teste não pode ser alterada pelo app.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_protect_is_test ON public.profiles;
CREATE TRIGGER profiles_protect_is_test BEFORE INSERT OR UPDATE OF is_test, can_see_test ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_is_test();

-- ── Mesmas regras de invisibilidade, com a exceção acima ────────────────────
DROP POLICY IF EXISTS "test_profiles_hidden" ON public.profiles;
CREATE POLICY "test_profiles_hidden" ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT is_test OR id = auth.uid() OR public.crm_sees_test());

DROP POLICY IF EXISTS "test_leads_hidden" ON public.leads;
CREATE POLICY "test_leads_hidden" ON public.leads AS RESTRICTIVE FOR SELECT TO authenticated
  USING (broker_id = auth.uid() OR NOT public.crm_is_test(broker_id) OR public.crm_sees_test());

DROP POLICY IF EXISTS "test_shifts_hidden" ON public.shifts;
CREATE POLICY "test_shifts_hidden" ON public.shifts AS RESTRICTIVE FOR SELECT TO authenticated
  USING (broker_id = auth.uid() OR NOT public.crm_is_test(broker_id) OR public.crm_sees_test());

DROP POLICY IF EXISTS "test_checkins_hidden" ON public.roulette_checkins;
CREATE POLICY "test_checkins_hidden" ON public.roulette_checkins AS RESTRICTIVE FOR SELECT TO authenticated
  USING (broker_id = auth.uid() OR NOT public.crm_is_test(broker_id) OR public.crm_sees_test());

DROP POLICY IF EXISTS "test_checkin_log_hidden" ON public.checkin_log;
CREATE POLICY "test_checkin_log_hidden" ON public.checkin_log AS RESTRICTIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR NOT public.crm_is_test(user_id) OR public.crm_sees_test());

DROP POLICY IF EXISTS "test_appointments_hidden" ON public.appointments;
CREATE POLICY "test_appointments_hidden" ON public.appointments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR NOT public.crm_is_test(owner_id) OR public.crm_sees_test());

DROP POLICY IF EXISTS "test_visitas_hidden" ON public.visitas;
CREATE POLICY "test_visitas_hidden" ON public.visitas AS RESTRICTIVE FOR SELECT TO authenticated
  USING (broker_id = auth.uid() OR NOT public.crm_is_test(broker_id) OR public.crm_sees_test());
