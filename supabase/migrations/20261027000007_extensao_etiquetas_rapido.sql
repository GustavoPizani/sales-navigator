-- Extensão do WhatsApp: troca as etiquetas de uma conversa vinculada numa
-- operação só no banco (antes eram 4 consultas: conferir o vínculo, conferir as
-- etiquetas, apagar e inserir). Confere que o vínculo e as etiquetas são do
-- corretor e devolve as etiquetas que ficaram. Chamada pelo servidor.
-- Pode rodar de novo sem erro.

BEGIN;

CREATE OR REPLACE FUNCTION public.wa_definir_etiquetas(_vinculo_id UUID, _broker_id UUID, _etiquetas UUID[])
RETURNS UUID[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _validas UUID[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.wa_vinculos WHERE id = _vinculo_id AND broker_id = _broker_id) THEN
    RAISE EXCEPTION 'Conversa não encontrada.';
  END IF;
  SELECT coalesce(array_agg(e.id), '{}') INTO _validas
    FROM public.wa_etiquetas e
   WHERE e.broker_id = _broker_id AND e.id = ANY(coalesce(_etiquetas, '{}'));
  DELETE FROM public.wa_vinculo_etiquetas
   WHERE vinculo_id = _vinculo_id AND NOT (etiqueta_id = ANY(_validas));
  INSERT INTO public.wa_vinculo_etiquetas (vinculo_id, etiqueta_id)
  SELECT _vinculo_id, unnest(_validas)
  ON CONFLICT DO NOTHING;
  RETURN _validas;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_definir_etiquetas(UUID, UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_definir_etiquetas(UUID, UUID, UUID[]) TO service_role;

COMMIT;

-- Conferência: deve dar 1
SELECT count(*) AS funcao_ok FROM pg_proc WHERE proname = 'wa_definir_etiquetas';
