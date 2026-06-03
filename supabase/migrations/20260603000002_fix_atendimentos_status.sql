-- Add "Em Tratativa" to the status CHECK constraint (was missing, causing silent insert failures)
ALTER TABLE public.atendimentos
  DROP CONSTRAINT IF EXISTS atendimentos_status_check;

ALTER TABLE public.atendimentos
  ADD CONSTRAINT atendimentos_status_check
  CHECK (status IN (
    'Prospect',
    'Em Tratativa',
    'Proposta em Análise',
    'Proposta Aprovada',
    'Contrato Gerado',
    'Contrato Assinado',
    'Cancelada'
  ));
