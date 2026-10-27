-- Mapeamento de tempo das funções da extensão do WhatsApp, para aprimorá-la.
-- Resumo por dia, usuário, origem e ação: quantas vezes, tempo total e máximo
-- (ms) e quantas deram erro. Sem dado de cliente.
--   origem 'faixa'    = tempo que o corretor esperou (ação na faixa, chamada à
--                       API vista da faixa, pedido ao WhatsApp Web);
--   origem 'servidor' = tempo de cada rota da API por dentro do servidor.
-- Gravado pelo servidor (service role). Leitura: o próprio usuário e o admin.
-- Pode rodar de novo sem erro.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ext_metricas (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dia DATE NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('faixa', 'servidor')),
  acao TEXT NOT NULL CHECK (length(acao) BETWEEN 1 AND 60),
  n INT NOT NULL DEFAULT 0,
  ms_total BIGINT NOT NULL DEFAULT 0,
  ms_max INT NOT NULL DEFAULT 0,
  erros INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, dia, origem, acao)
);
CREATE INDEX IF NOT EXISTS ext_metricas_dia_idx ON public.ext_metricas (dia, origem, acao);

-- Soma uma medição (ou várias de uma vez: _n e _ms_total já somados).
CREATE OR REPLACE FUNCTION public.ext_metricas_somar(
  _user_id UUID, _origem TEXT, _acao TEXT, _n INT, _ms_total BIGINT, _ms_max INT, _erros INT)
RETURNS VOID LANGUAGE SQL SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.ext_metricas AS m (user_id, dia, origem, acao, n, ms_total, ms_max, erros)
  VALUES (_user_id, (now() AT TIME ZONE 'America/Sao_Paulo')::date, _origem, left(_acao, 60),
          greatest(_n, 0), greatest(_ms_total, 0), greatest(_ms_max, 0), greatest(_erros, 0))
  ON CONFLICT (user_id, dia, origem, acao) DO UPDATE SET
    n = m.n + EXCLUDED.n,
    ms_total = m.ms_total + EXCLUDED.ms_total,
    ms_max = greatest(m.ms_max, EXCLUDED.ms_max),
    erros = m.erros + EXCLUDED.erros;
$$;
REVOKE ALL ON FUNCTION public.ext_metricas_somar(UUID, TEXT, TEXT, INT, BIGINT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ext_metricas_somar(UUID, TEXT, TEXT, INT, BIGINT, INT, INT) TO service_role;

ALTER TABLE public.ext_metricas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ext_metricas_select" ON public.ext_metricas;
CREATE POLICY "ext_metricas_select" ON public.ext_metricas FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.crm_is_global(auth.uid()));
GRANT SELECT ON public.ext_metricas TO authenticated;
GRANT ALL ON public.ext_metricas TO service_role;

COMMIT;

-- Conferência: deve dar 1
SELECT count(*) AS tabela_com_rls FROM pg_tables
 WHERE schemaname = 'public' AND tablename = 'ext_metricas' AND rowsecurity;
