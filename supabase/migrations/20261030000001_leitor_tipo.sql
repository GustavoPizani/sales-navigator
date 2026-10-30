-- Leitor (1 de 2): novo tipo base de cargo, para os gestores da empresa que só
-- acompanham (Análise Hypnobox, Escala, Check-in, Imóveis e Treinamentos), sem
-- editar nada e sem a coleta de dados.
-- O Postgres não deixa usar um valor novo de enum na mesma execução em que ele é
-- criado: rode este arquivo sozinho e depois o 20261030000002_leitor_cargo.sql.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'viewer';
