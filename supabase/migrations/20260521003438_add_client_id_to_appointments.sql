-- Adiciona a coluna client_id na tabela appointments caso ela ainda não exista

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS client_id TEXT;