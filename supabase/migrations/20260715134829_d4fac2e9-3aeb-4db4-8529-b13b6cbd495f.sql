
-- 1) Drop the permissive USING (true) SELECT on shift_slots; team-scoped policy remains.
DROP POLICY IF EXISTS shift_slots_select_all ON public.shift_slots;
DROP POLICY IF EXISTS shift_configs_select_all ON public.shift_configs;

-- 2) Lock down SECURITY DEFINER function EXECUTE privileges.
-- Trigger functions: no EXECUTE for anyone.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_appointment_created() FROM PUBLIC, anon, authenticated;

-- Helpers used by RLS / server code: authenticated only.
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.is_director(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_director(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.my_manager_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_manager_id() TO authenticated;

REVOKE ALL ON FUNCTION public.claim_shift_slot(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_shift_slot(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_reset_password(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(uuid, text) TO authenticated;

-- get_shift_config_by_token is intentionally reachable by anon (public claim link).
-- Keep anon EXECUTE but drop the redundant PUBLIC grant.
REVOKE ALL ON FUNCTION public.get_shift_config_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shift_config_by_token(text) TO anon, authenticated;
