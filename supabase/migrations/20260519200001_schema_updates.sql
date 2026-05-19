-- Step 2: Schema updates, function updates, RLS, and seed data.
-- Run AFTER 20260519200000_extend_role_enum.sql has been committed.

-- Update is_admin() to treat 'master' the same as 'admin'
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role IN ('admin', 'master') AND is_active = true
  );
$$;

-- Add manager_id to profiles (links brokers to their manager)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Link atendimentos back to the appointment they were created from
ALTER TABLE public.atendimentos
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL;

-- Allow directors and masters to read all appointments
DROP POLICY IF EXISTS "appt_admin_read_all" ON public.appointments;
CREATE POLICY "appt_admin_read_all" ON public.appointments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'master', 'director') AND is_active = true
    )
  );

-- Update atendimentos RLS to include director and master
DROP POLICY IF EXISTS "admin_all" ON public.atendimentos;
CREATE POLICY "admin_all" ON public.atendimentos
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'master', 'director') AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'master', 'director') AND is_active = true
    )
  );

-- Set pizanicorretor@gmail.com to master (run after ensuring this user exists)
UPDATE public.profiles
  SET role = 'master'
  WHERE email = 'pizanicorretor@gmail.com';

-- INSTRUCTIONS for director user (michele@setinvendas.com.br):
-- 1. Create the user in Supabase Auth Dashboard (Authentication > Users > Invite/Add user)
--    with email: michele@setinvendas.com.br  password: Setin@19052026
-- 2. Then run the line below (uncomment it):
-- UPDATE public.profiles SET role = 'director' WHERE email = 'michele@setinvendas.com.br';
