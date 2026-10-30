-- Leitor: também lê o log de check-ins (para acompanhar e baixar os relatórios).
-- Só leitura: ajustar o log continua com o ADM (crm_checkin_log_adjust).
-- Rode depois de 20261030000002_leitor_cargo.sql.

DROP POLICY IF EXISTS "viewer_read" ON public.checkin_log;
CREATE POLICY "viewer_read" ON public.checkin_log FOR SELECT TO authenticated
  USING (public.is_viewer(auth.uid()));
