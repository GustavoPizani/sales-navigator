-- Extensão do WhatsApp: etiquetas do corretor, prazo para contato e "último
-- contato" de cada conversa vinculada (lista da faixa: filtrar por etiqueta e
-- situação, do mais antigo sem contato para o mais novo).
-- Escritas pelo servidor (service role), como o resto da extensão.
-- Pode rodar de novo sem erro.

BEGIN;

-- Etiquetas são de cada corretor (nome e cor).
CREATE TABLE IF NOT EXISTS public.wa_etiquetas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome TEXT NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 40),
  cor TEXT NOT NULL DEFAULT '#B28069' CHECK (cor ~ '^#[0-9A-Fa-f]{6}$'),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wa_etiquetas_nome_idx ON public.wa_etiquetas (broker_id, lower(trim(nome)));

CREATE TABLE IF NOT EXISTS public.wa_vinculo_etiquetas (
  vinculo_id UUID NOT NULL REFERENCES public.wa_vinculos(id) ON DELETE CASCADE,
  etiqueta_id UUID NOT NULL REFERENCES public.wa_etiquetas(id) ON DELETE CASCADE,
  PRIMARY KEY (vinculo_id, etiqueta_id)
);
CREATE INDEX IF NOT EXISTS wa_vinculo_etiquetas_etiqueta_idx ON public.wa_vinculo_etiquetas (etiqueta_id);

-- Prazo para entrar em contato e o último contato (de qualquer lado).
ALTER TABLE public.wa_vinculos ADD COLUMN IF NOT EXISTS retornar_em TIMESTAMPTZ;
ALTER TABLE public.wa_vinculos ADD COLUMN IF NOT EXISTS retorno_nota TEXT;
ALTER TABLE public.wa_vinculos ADD COLUMN IF NOT EXISTS ultimo_contato_em TIMESTAMPTZ
  GENERATED ALWAYS AS (GREATEST(ultima_cliente_em, ultima_corretor_em)) STORED;
CREATE INDEX IF NOT EXISTS wa_vinculos_contato_idx ON public.wa_vinculos (broker_id, ultimo_contato_em) WHERE NOT nao_cliente;
CREATE INDEX IF NOT EXISTS wa_vinculos_prazo_idx ON public.wa_vinculos (broker_id, retornar_em) WHERE retornar_em IS NOT NULL;

-- Acesso: leitura pela hierarquia (como wa_vinculos); conta de teste invisível.
ALTER TABLE public.wa_etiquetas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_etiquetas_select" ON public.wa_etiquetas;
CREATE POLICY "wa_etiquetas_select" ON public.wa_etiquetas FOR SELECT TO authenticated
  USING (public.crm_can_access_broker(broker_id));
DROP POLICY IF EXISTS "test_wa_etiquetas_hidden" ON public.wa_etiquetas;
CREATE POLICY "test_wa_etiquetas_hidden" ON public.wa_etiquetas AS RESTRICTIVE FOR SELECT TO authenticated
  USING (broker_id = auth.uid() OR NOT public.crm_is_test(broker_id));

ALTER TABLE public.wa_vinculo_etiquetas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_vinculo_etiquetas_select" ON public.wa_vinculo_etiquetas;
CREATE POLICY "wa_vinculo_etiquetas_select" ON public.wa_vinculo_etiquetas FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.wa_vinculos v WHERE v.id = vinculo_id));  -- a RLS de wa_vinculos já filtra

GRANT SELECT ON public.wa_etiquetas, public.wa_vinculo_etiquetas TO authenticated;
GRANT ALL ON public.wa_etiquetas, public.wa_vinculo_etiquetas TO service_role;

COMMIT;

-- Conferência: as duas tabelas com RLS e a coluna calculada
SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity
     AND tablename IN ('wa_etiquetas', 'wa_vinculo_etiquetas')) AS tabelas_com_rls,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wa_vinculos'
      AND column_name IN ('retornar_em', 'retorno_nota', 'ultimo_contato_em')) AS colunas_novas;
