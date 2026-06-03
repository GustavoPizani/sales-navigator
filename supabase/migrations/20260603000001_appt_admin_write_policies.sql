-- Allow admins, masters, and directors to update any appointment
CREATE POLICY "appt_admin_update_all" ON public.appointments
  FOR UPDATE TO authenticated
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

-- Allow admins, masters, and directors to delete any appointment
CREATE POLICY "appt_admin_delete_all" ON public.appointments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'master', 'director') AND is_active = true
    )
  );
