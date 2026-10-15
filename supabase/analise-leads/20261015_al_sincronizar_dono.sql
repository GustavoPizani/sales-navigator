-- =====================================================================
-- Correção da gravação da Central de coleta (banco kvwgtyihxcegylcguncj)
-- Erro: "must be owner of sequence al_mkt_anuncios_id_seq".
-- A função al_sincronizar troca as tabelas de resumo com
-- "truncate ... restart identity", que exige ser dono das sequências. Ela
-- rodava como o service_role (quem chama), que não é dono. Agora roda como o
-- dono das tabelas (security definer). Continua executável só pelo servidor.
-- Rodar no SQL Editor do projeto. Pode rodar de novo sem erro.
-- =====================================================================
alter function public.al_sincronizar(jsonb) security definer;
alter function public.al_sincronizar(jsonb) set search_path = public;
revoke all on function public.al_sincronizar(jsonb) from public, anon, authenticated;
grant execute on function public.al_sincronizar(jsonb) to service_role;
