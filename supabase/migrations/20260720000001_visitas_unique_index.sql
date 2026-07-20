-- Evita duplicidade exata na tabela de visitas (mesmo corretor, cliente,
-- data e produto/unidade) como camada extra de proteção além da dedupe
-- feita no app. Não bloqueia visitas legítimas em datas diferentes.
CREATE UNIQUE INDEX IF NOT EXISTS visitas_no_exact_dupe
  ON public.visitas (broker_id, id_cliente, data_visita, coalesce(produto, ''))
  WHERE id_cliente IS NOT NULL;
