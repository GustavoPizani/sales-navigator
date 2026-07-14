-- Security hardening based on the Supabase/Lovable security scan findings:
-- policies scoped to `public` instead of `authenticated`, an overly broad
-- profiles read policy, overly broad shift-scheduling read policies, and
-- SECURITY DEFINER RPCs callable without proper role restriction.

-- ── Critical: atendimentos.broker_own was scoped to `public` ───────────────
-- ALTER POLICY only changes the role list, leaving the existing USING clause
-- untouched — safest possible fix since we don't want to guess/rewrite logic
-- that's already correct.
ALTER POLICY "broker_own" ON public.atendimentos TO authenticated;

-- ── Critical: any authenticated user could read every active profile ───────
-- (full_name, email, phone, role) regardless of team. Replace with a policy
-- scoped to: yourself, your own manager, people you manage, and your
-- teammates (same manager) — directors keep full visibility (team.tsx's
-- director view lists every manager/broker), and admins already have their
-- own separate "profiles_admin_select_all" policy.
CREATE OR REPLACE FUNCTION public.my_manager_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT manager_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_director(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND role = 'director' AND is_active = true
  );
$$;

DROP POLICY IF EXISTS "profiles_broker_view_active" ON public.profiles;
CREATE POLICY "profiles_team_view" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND (
      id = auth.uid()
      OR public.is_director(auth.uid())
      OR manager_id = auth.uid()
      OR id = public.my_manager_id()
      OR manager_id = public.my_manager_id()
    )
  );

-- ── Warning: vendas_* policies were scoped to `public` ──────────────────────
-- Same ALTER POLICY approach — only fixes the role, keeps existing logic.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vendas' AND policyname = 'vendas_select') THEN
    ALTER POLICY "vendas_select" ON public.vendas TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vendas' AND policyname = 'vendas_insert') THEN
    ALTER POLICY "vendas_insert" ON public.vendas TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vendas' AND policyname = 'vendas_update') THEN
    ALTER POLICY "vendas_update" ON public.vendas TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vendas' AND policyname = 'vendas_delete') THEN
    ALTER POLICY "vendas_delete" ON public.vendas TO authenticated;
  END IF;
END $$;

-- ── Warning: shift_configs/shift_slots readable by every authenticated user ─
-- shift_configs_select_all isn't defined in any tracked migration (created
-- outside of them) and isn't needed: managers already have full access via
-- shift_configs_admin_all, and brokers only ever read shift data through the
-- SECURITY DEFINER get_shift_config_by_token RPC (which bypasses RLS), so a
-- broad table-level SELECT policy has no legitimate consumer — drop it.
DROP POLICY IF EXISTS "shift_configs_select_all" ON public.shift_configs;

-- shift_slots_broker_read used USING (true). No broker-facing code path
-- reads this table directly today (brokers go through the token RPC), but
-- scope it to same-team visibility instead of dropping outright, in case
-- something else relies on it.
DROP POLICY IF EXISTS "shift_slots_broker_read" ON public.shift_slots;
CREATE POLICY "shift_slots_team_read" ON public.shift_slots
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shift_configs sc
      WHERE sc.id = shift_slots.config_id
        AND (sc.manager_id = auth.uid() OR sc.manager_id = public.my_manager_id())
    )
  );

-- ── Warning: SECURITY DEFINER RPCs callable by anon/public ─────────────────
-- Both are only ever called from inside the authenticated app (the claim
-- link route lives under /_authenticated, so anon users never reach it) —
-- restrict execution to logged-in users.
REVOKE ALL ON FUNCTION public.get_shift_config_by_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shift_config_by_token(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_shift_slot(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_shift_slot(UUID, UUID) TO authenticated;
