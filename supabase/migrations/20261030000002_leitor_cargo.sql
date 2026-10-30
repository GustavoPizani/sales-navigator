-- Leitor (2 de 2): cargo "Leitor", módulo "Análise Hypnobox" na matriz e
-- leitura (só SELECT) das tabelas das telas que o leitor acompanha.
-- Rode depois de 20261030000001_leitor_tipo.sql.
--
-- O leitor vê os dados de todas as equipes, como o ADM, mas não grava nada: as
-- regras abaixo só liberam leitura; inserir, alterar e apagar continuam com as
-- regras que já existem (ADM, gestor e corretor). Leads e agendamentos ficam de
-- fora.

CREATE OR REPLACE FUNCTION public.is_viewer(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND role = 'viewer' AND is_active = true
  );
$$;
REVOKE ALL ON FUNCTION public.is_viewer(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_viewer(UUID) TO authenticated;

-- Cargo do sistema "Leitor" (é o cargo padrão do tipo leitor)
INSERT INTO public.cargos (name, base_role) VALUES ('Leitor', 'viewer')
ON CONFLICT (name) DO NOTHING;
UPDATE public.cargos SET is_system = true WHERE name = 'Leitor' AND base_role = 'viewer';

-- Matriz: o leitor vê Análise, Escala, Check-in, Imóveis e Treinamentos; o resto oculto.
INSERT INTO public.cargo_permissions (cargo_id, module, level)
SELECT c.id, m.module, m.level
FROM public.cargos c
JOIN (VALUES
  ('dashboard', 'hidden'), ('leads', 'hidden'), ('schedule', 'view'), ('checkin', 'view'),
  ('appointments', 'hidden'), ('projects', 'view'), ('team', 'hidden'), ('training', 'view'),
  ('analise', 'view')
) AS m(module, level) ON true
WHERE c.base_role = 'viewer'
ON CONFLICT (cargo_id, module) DO NOTHING;

-- Os demais cargos (fora o ADM, que tem sempre acesso total) começam sem a Análise.
INSERT INTO public.cargo_permissions (cargo_id, module, level)
SELECT c.id, 'analise', 'hidden'
FROM public.cargos c
WHERE c.base_role::text NOT IN ('admin', 'director', 'viewer')
ON CONFLICT (cargo_id, module) DO NOTHING;

-- Leitura para o leitor nas tabelas da Escala, do Check-in e de Imóveis.
-- (as regras de leitura se somam às que já existem; nenhuma regra de escrita muda)
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'shift_configs', 'shift_slots', 'shifts', 'projects', 'app_settings',
    'crm_vagas_padrao', 'roulette_checkins', 'roulette_settings', 'roulette_turns'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "viewer_read" ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY "viewer_read" ON public.%I FOR SELECT TO authenticated USING (public.is_viewer(auth.uid()))',
        t
      );
    END IF;
  END LOOP;
END $$;
