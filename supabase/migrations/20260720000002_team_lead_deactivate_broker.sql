-- Deleting a broker's login (auth.users) requires the Supabase service role
-- key, which this project's server environment doesn't have configured.
-- Instead, "removing" a broker from the team is done by deactivating their
-- profile (is_active = false) — already how the rest of the app treats
-- inactive brokers (hidden from profiles_team_view / team lists). This lets
-- masters/directors do it through normal RLS, no service role needed.
CREATE OR REPLACE FUNCTION public.is_master(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND role = 'master' AND is_active = true
  );
$$;

DROP POLICY IF EXISTS "profiles_team_lead_update" ON public.profiles;
CREATE POLICY "profiles_team_lead_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    public.is_director(auth.uid())
    OR (public.is_master(auth.uid()) AND manager_id = auth.uid())
  )
  WITH CHECK (
    public.is_director(auth.uid())
    OR (public.is_master(auth.uid()) AND manager_id = auth.uid())
  );
