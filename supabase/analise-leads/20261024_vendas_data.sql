-- =====================================================================
-- Análise de leads P&G — data real de cada venda (banco kvwgtyihxcegylcguncj)
-- Rodar no SQL Editor do projeto novo. Pode rodar de novo sem erro.
--
-- O Hypnobox não guarda a data da venda: o painel usava a última atualização
-- do cliente. Aqui o ADM confirma a data de cada venda, venda a venda; o painel
-- e o MCP passam a usar a data confirmada (e a aproximada só quando não há).
-- A coleta não mexe nesta tabela (al_sincronizar não a conhece).
-- =====================================================================
begin;

create table if not exists al_vendas_data (
  id_cliente text primary key,
  data_venda date not null,
  observacao text,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
comment on table al_vendas_data is 'Data real de cada venda, confirmada pelo ADM no painel (Vendas)';
-- só o servidor (chave secreta) lê e grava
alter table al_vendas_data enable row level security;

commit;

-- Conferência: a tabela existe
select count(*) as datas_confirmadas from al_vendas_data;
