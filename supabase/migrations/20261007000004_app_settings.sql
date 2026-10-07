-- Configurações gerais do sistema, no formato chave/valor.
--
-- Todo usuário logado lê; só o admin grava. Primeira chave:
--   project_covers_enabled (true/false): mostra ou esconde a foto de capa nos
--   cards da tela de Imóveis, para todo mundo.
-- Pode rodar de novo sem erro.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_read" ON public.app_settings;
CREATE POLICY "app_settings_read" ON public.app_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "app_settings_admin_write" ON public.app_settings;
CREATE POLICY "app_settings_admin_write" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;

INSERT INTO public.app_settings (key, value)
VALUES ('project_covers_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
