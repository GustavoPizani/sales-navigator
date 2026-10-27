-- Etiquetas da extensão espelhando as do WhatsApp Business: cada etiqueta do
-- corretor pode estar ligada a uma etiqueta do WhatsApp dele (wa_label_id).
-- A faixa sincroniza as duas; a Lista de clientes continua filtrando pelo banco.
-- Para quem usa o WhatsApp comum (sem etiquetas), wa_label_id fica vazio.
-- Pode rodar de novo sem erro.

BEGIN;

ALTER TABLE public.wa_etiquetas ADD COLUMN IF NOT EXISTS wa_label_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS wa_etiquetas_wa_label_idx
  ON public.wa_etiquetas (broker_id, wa_label_id) WHERE wa_label_id IS NOT NULL;

COMMIT;

-- Conferência: deve dar 1
SELECT count(*) AS coluna_wa_label_id
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'wa_etiquetas' AND column_name = 'wa_label_id';
