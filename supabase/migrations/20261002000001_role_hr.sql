-- Novo tipo base de usuário: RH.
-- Precisa rodar (e ser confirmado) ANTES da migration 20261002000002, porque o
-- Postgres não permite usar um valor novo de enum na mesma transação em que
-- ele é criado.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hr';
