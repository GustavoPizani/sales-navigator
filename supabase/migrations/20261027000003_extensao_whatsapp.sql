-- Extensão do WhatsApp (MVP): vínculo das conversas com os clientes, conversas
-- guardadas em texto compacto, chave do Groq de cada corretor, uso da IA,
-- transcrições, instalações e a guia de tutorial. Plano no HANDOFF.md, seção 9.
--
-- Escritas acontecem pelo servidor (service role), chamado pela extensão e pelas
-- telas do sistema. O navegador só lê, e só o que a hierarquia permite
-- (corretor: o próprio; gerente: a equipe; admin: tudo), mais duas RPCs no fim.
-- A conta de teste fica invisível, como no resto do sistema.
-- O módulo de WhatsApp com WAHA (20261006000001) não é usado aqui.
-- Pode rodar de novo sem erro.

BEGIN;

-- ── Vínculo conversa do WhatsApp ↔ cliente ──────────────────────────────────
-- Uma linha por conversa que o corretor ligou a um cliente (ou marcou como
-- "não é cliente": a extensão para de olhar essa conversa). Os campos ultima_*
-- vêm do bloco mais recente da conversa (gatilho abaixo) e alimentam "tempo
-- parado", "devendo resposta" e os segmentos sem abrir o texto.
CREATE TABLE IF NOT EXISTS public.wa_vinculos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  wa_chat_id TEXT NOT NULL,                 -- id da conversa no WhatsApp (…@c.us ou …@lid)
  telefone TEXT,                            -- só dígitos, com DDI
  nome_contato TEXT,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  id_cliente_hypnobox TEXT,
  nao_cliente BOOLEAN NOT NULL DEFAULT false,
  exemplo_tom BOOLEAN NOT NULL DEFAULT false, -- o corretor usa como exemplo do jeito dele
  n_msgs INT NOT NULL DEFAULT 0,
  ultima_cliente_em TIMESTAMPTZ,
  ultima_corretor_em TIMESTAMPTZ,
  ultima_lado CHAR(1) CHECK (ultima_lado IN ('>', '<')),   -- '>' corretor, '<' cliente
  ultima_cliente_so_ok BOOLEAN NOT NULL DEFAULT false,
  historico_ate TIMESTAMPTZ,                -- mensagem mais antiga já trazida do celular
  vinculado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (broker_id, wa_chat_id),
  CHECK (NOT (nao_cliente AND (lead_id IS NOT NULL OR id_cliente_hypnobox IS NOT NULL)))
);
CREATE INDEX IF NOT EXISTS wa_vinculos_lead_idx ON public.wa_vinculos (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wa_vinculos_hypnobox_idx ON public.wa_vinculos (id_cliente_hypnobox) WHERE id_cliente_hypnobox IS NOT NULL;
CREATE INDEX IF NOT EXISTS wa_vinculos_tel8_idx ON public.wa_vinculos (right(coalesce(telefone, ''), 8));
CREATE INDEX IF NOT EXISTS wa_vinculos_parados_idx ON public.wa_vinculos (broker_id, ultima_cliente_em) WHERE NOT nao_cliente;

-- ── Conversa em texto compacto, um bloco por mês ────────────────────────────
-- dados = gzip do formato compacto v1 (HANDOFF.md 9.3). Já vem comprimido, então
-- a coluna fica sem a compressão do Postgres (STORAGE EXTERNAL).
CREATE TABLE IF NOT EXISTS public.wa_conversa_blocos (
  vinculo_id UUID NOT NULL REFERENCES public.wa_vinculos(id) ON DELETE CASCADE,
  mes TEXT NOT NULL CHECK (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  formato SMALLINT NOT NULL DEFAULT 1,
  dados BYTEA NOT NULL,
  tamanho_texto INT NOT NULL DEFAULT 0,     -- bytes do texto antes do gzip
  n_msgs INT NOT NULL DEFAULT 0,
  primeira_msg_em TIMESTAMPTZ,
  ultima_msg_id TEXT,
  ultima_msg_em TIMESTAMPTZ,
  ultima_cliente_em TIMESTAMPTZ,
  ultima_corretor_em TIMESTAMPTZ,
  ultima_lado CHAR(1) CHECK (ultima_lado IN ('>', '<')),
  ultima_cliente_so_ok BOOLEAN NOT NULL DEFAULT false,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vinculo_id, mes)
);
ALTER TABLE public.wa_conversa_blocos ALTER COLUMN dados SET STORAGE EXTERNAL;

-- Bloco gravado → resumo no vínculo (só o bloco mais recente manda nos ultima_*).
CREATE OR REPLACE FUNCTION public.wa_blocos_resumo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id UUID := coalesce(NEW.vinculo_id, OLD.vinculo_id);
BEGIN
  UPDATE public.wa_vinculos v SET
    n_msgs = coalesce((SELECT sum(b.n_msgs) FROM public.wa_conversa_blocos b WHERE b.vinculo_id = _id), 0),
    ultima_cliente_em = (SELECT max(b.ultima_cliente_em) FROM public.wa_conversa_blocos b WHERE b.vinculo_id = _id),
    ultima_corretor_em = (SELECT max(b.ultima_corretor_em) FROM public.wa_conversa_blocos b WHERE b.vinculo_id = _id),
    ultima_lado = u.ultima_lado,
    ultima_cliente_so_ok = coalesce(u.ultima_cliente_so_ok, false),
    historico_ate = (SELECT min(b.primeira_msg_em) FROM public.wa_conversa_blocos b WHERE b.vinculo_id = _id),
    atualizado_em = now()
  FROM (SELECT b.ultima_lado, b.ultima_cliente_so_ok FROM public.wa_conversa_blocos b
         WHERE b.vinculo_id = _id ORDER BY b.mes DESC LIMIT 1) u
  WHERE v.id = _id;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_blocos_resumo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS wa_blocos_resumo ON public.wa_conversa_blocos;
CREATE TRIGGER wa_blocos_resumo AFTER INSERT OR UPDATE ON public.wa_conversa_blocos
  FOR EACH ROW EXECUTE FUNCTION public.wa_blocos_resumo();

-- ── Transcrições (controle; o texto fica no bloco da conversa) ──────────────
CREATE TABLE IF NOT EXISTS public.wa_transcricoes (
  vinculo_id UUID NOT NULL REFERENCES public.wa_vinculos(id) ON DELETE CASCADE,
  msg_id TEXT NOT NULL,
  segundos INT,
  modelo TEXT,
  erro TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vinculo_id, msg_id)
);

-- ── Chave do Groq de cada usuário ───────────────────────────────────────────
-- Cifrada pelo servidor (AES-256-GCM com segredo da Vercel) antes de chegar
-- aqui. Sem políticas: só service role lê. O usuário vê o status pela RPC
-- ia_minha_chave(), nunca a chave.
CREATE TABLE IF NOT EXISTS public.ia_chaves_usuario (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provedor TEXT NOT NULL DEFAULT 'groq' CHECK (provedor IN ('groq')),
  chave_cifrada TEXT NOT NULL,              -- iv:tag:texto, em base64
  final4 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'invalida', 'limite')),
  testada_em TIMESTAMPTZ,
  ultimo_uso_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provedor)
);

-- ── Uso da IA por dia (medidor do limite grátis) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.ia_uso (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dia DATE NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('sugestao', 'transcricao', 'retrato', 'perfil', 'modelo', 'teste')),
  modelo TEXT NOT NULL,
  pedidos INT NOT NULL DEFAULT 0,
  tokens INT NOT NULL DEFAULT 0,
  segundos_audio INT NOT NULL DEFAULT 0,
  recusas_limite INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, dia, tipo, modelo)
);

-- Soma um uso (chamada pelo servidor depois de cada pedido ao Groq).
CREATE OR REPLACE FUNCTION public.ia_uso_somar(
  _user_id UUID, _tipo TEXT, _modelo TEXT,
  _tokens INT DEFAULT 0, _segundos INT DEFAULT 0, _recusado BOOLEAN DEFAULT false)
RETURNS VOID LANGUAGE SQL SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.ia_uso AS u (user_id, dia, tipo, modelo, pedidos, tokens, segundos_audio, recusas_limite)
  VALUES (_user_id, (now() AT TIME ZONE 'America/Sao_Paulo')::date, _tipo, _modelo,
          CASE WHEN _recusado THEN 0 ELSE 1 END, coalesce(_tokens, 0), coalesce(_segundos, 0),
          CASE WHEN _recusado THEN 1 ELSE 0 END)
  ON CONFLICT (user_id, dia, tipo, modelo) DO UPDATE SET
    pedidos = u.pedidos + EXCLUDED.pedidos,
    tokens = u.tokens + EXCLUDED.tokens,
    segundos_audio = u.segundos_audio + EXCLUDED.segundos_audio,
    recusas_limite = u.recusas_limite + EXCLUDED.recusas_limite;
$$;
REVOKE ALL ON FUNCTION public.ia_uso_somar(UUID, TEXT, TEXT, INT, INT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ── Instalações da extensão e guia de tutorial ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.ext_instalacoes (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  versao TEXT NOT NULL,
  navegador TEXT,
  primeiro_acesso_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_acesso_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ext_guia_progresso (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  passo TEXT NOT NULL CHECK (passo IN ('baixar', 'instalar', 'whatsapp', 'login', 'chave',
                                       'tom', 'vincular', 'sugestao', 'transcricao', 'disparo')),
  concluido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, passo)
);

-- ── updated_at ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ext_touch_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS wa_vinculos_touch ON public.wa_vinculos;
CREATE TRIGGER wa_vinculos_touch BEFORE UPDATE ON public.wa_vinculos
  FOR EACH ROW EXECUTE FUNCTION public.ext_touch_atualizado_em();
DROP TRIGGER IF EXISTS ia_chaves_usuario_touch ON public.ia_chaves_usuario;
CREATE TRIGGER ia_chaves_usuario_touch BEFORE UPDATE ON public.ia_chaves_usuario
  FOR EACH ROW EXECUTE FUNCTION public.ext_touch_atualizado_em();

-- ── Acesso ──────────────────────────────────────────────────────────────────
-- Leitura pela hierarquia (crm_can_access_broker). O texto das conversas
-- (wa_conversa_blocos) por enquanto só o próprio corretor e o admin: se o
-- gerente vê as conversas da equipe ainda é decisão em aberto (HANDOFF 9.13).
ALTER TABLE public.wa_vinculos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_vinculos_select" ON public.wa_vinculos;
CREATE POLICY "wa_vinculos_select" ON public.wa_vinculos FOR SELECT TO authenticated
  USING (public.crm_can_access_broker(broker_id));
DROP POLICY IF EXISTS "test_wa_vinculos_hidden" ON public.wa_vinculos;
CREATE POLICY "test_wa_vinculos_hidden" ON public.wa_vinculos AS RESTRICTIVE FOR SELECT TO authenticated
  USING (broker_id = auth.uid() OR NOT public.crm_is_test(broker_id));

ALTER TABLE public.wa_conversa_blocos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_conversa_blocos_select" ON public.wa_conversa_blocos;
CREATE POLICY "wa_conversa_blocos_select" ON public.wa_conversa_blocos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.wa_vinculos v
                  WHERE v.id = vinculo_id
                    AND (v.broker_id = auth.uid()
                         OR (public.crm_is_global(auth.uid()) AND NOT public.crm_is_test(v.broker_id)))));

ALTER TABLE public.wa_transcricoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_transcricoes_select" ON public.wa_transcricoes;
CREATE POLICY "wa_transcricoes_select" ON public.wa_transcricoes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.wa_vinculos v
                  WHERE v.id = vinculo_id AND v.broker_id = auth.uid()));

ALTER TABLE public.ia_chaves_usuario ENABLE ROW LEVEL SECURITY;  -- sem políticas: só service role

ALTER TABLE public.ia_uso ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ia_uso_select" ON public.ia_uso;
CREATE POLICY "ia_uso_select" ON public.ia_uso FOR SELECT TO authenticated
  USING (public.crm_can_access_broker(user_id));
DROP POLICY IF EXISTS "test_ia_uso_hidden" ON public.ia_uso;
CREATE POLICY "test_ia_uso_hidden" ON public.ia_uso AS RESTRICTIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR NOT public.crm_is_test(user_id));

ALTER TABLE public.ext_instalacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ext_instalacoes_select" ON public.ext_instalacoes;
CREATE POLICY "ext_instalacoes_select" ON public.ext_instalacoes FOR SELECT TO authenticated
  USING (public.crm_can_access_broker(user_id));
DROP POLICY IF EXISTS "test_ext_instalacoes_hidden" ON public.ext_instalacoes;
CREATE POLICY "test_ext_instalacoes_hidden" ON public.ext_instalacoes AS RESTRICTIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR NOT public.crm_is_test(user_id));

ALTER TABLE public.ext_guia_progresso ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ext_guia_progresso_select" ON public.ext_guia_progresso;
CREATE POLICY "ext_guia_progresso_select" ON public.ext_guia_progresso FOR SELECT TO authenticated
  USING (public.crm_can_access_broker(user_id));
DROP POLICY IF EXISTS "test_ext_guia_progresso_hidden" ON public.ext_guia_progresso;
CREATE POLICY "test_ext_guia_progresso_hidden" ON public.ext_guia_progresso AS RESTRICTIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR NOT public.crm_is_test(user_id));

GRANT SELECT ON public.wa_vinculos, public.wa_conversa_blocos, public.wa_transcricoes,
  public.ia_uso, public.ext_instalacoes, public.ext_guia_progresso TO authenticated;
GRANT ALL ON public.wa_vinculos, public.wa_conversa_blocos, public.wa_transcricoes, public.ia_chaves_usuario,
  public.ia_uso, public.ext_instalacoes, public.ext_guia_progresso TO service_role;
GRANT EXECUTE ON FUNCTION public.ia_uso_somar(UUID, TEXT, TEXT, INT, INT, BOOLEAN) TO service_role;

-- ── RPCs do navegador ───────────────────────────────────────────────────────
-- Situação da própria chave (sem a chave).
CREATE OR REPLACE FUNCTION public.ia_minha_chave()
RETURNS TABLE (provedor TEXT, final4 TEXT, status TEXT, testada_em TIMESTAMPTZ, ultimo_uso_em TIMESTAMPTZ)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT k.provedor, k.final4, k.status, k.testada_em, k.ultimo_uso_em
    FROM public.ia_chaves_usuario k WHERE k.user_id = auth.uid();
$$;

-- Passos da guia que só o próprio usuário conclui ("baixei", "entendi o disparo").
-- Os outros o servidor marca quando percebe que foram feitos.
CREATE OR REPLACE FUNCTION public.ext_concluir_passo(_passo TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem login'; END IF;
  IF _passo NOT IN ('baixar', 'disparo') THEN
    RAISE EXCEPTION 'Este passo é concluído automaticamente: %', _passo;
  END IF;
  INSERT INTO public.ext_guia_progresso (user_id, passo) VALUES (auth.uid(), _passo)
  ON CONFLICT (user_id, passo) DO NOTHING;
END;
$$;

-- Marca ou desmarca uma conversa como exemplo do jeito do corretor.
CREATE OR REPLACE FUNCTION public.wa_marcar_exemplo(_vinculo_id UUID, _exemplo BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.wa_vinculos SET exemplo_tom = _exemplo
   WHERE id = _vinculo_id AND broker_id = auth.uid() AND NOT nao_cliente;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ia_minha_chave() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ext_concluir_passo(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wa_marcar_exemplo(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_minha_chave() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ext_concluir_passo(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wa_marcar_exemplo(UUID, BOOLEAN) TO authenticated;

COMMIT;

-- Conferência: 7 tabelas com RLS ligada
SELECT count(*) AS tabelas_com_rls
  FROM pg_tables
 WHERE schemaname = 'public' AND rowsecurity
   AND tablename IN ('wa_vinculos', 'wa_conversa_blocos', 'wa_transcricoes', 'ia_chaves_usuario',
                     'ia_uso', 'ext_instalacoes', 'ext_guia_progresso');
