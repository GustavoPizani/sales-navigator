-- Endereço (texto) de cada PDV, para aparecer nas regras de check-in junto
-- com o ponto marcado no mapa.
ALTER TABLE public.roulette_settings
  ADD COLUMN IF NOT EXISTS central_address TEXT,
  ADD COLUMN IF NOT EXISTS plantao_address TEXT;
