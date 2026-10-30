-- =====================================================================
-- Análise de leads P&G — validação das propostas (banco kvwgtyihxcegylcguncj)
-- Rodar no SQL Editor do projeto novo. Pode rodar de novo sem erro.
--
-- O Hypnobox não guarda a data da proposta e às vezes o corretor marca
-- Proposta sem ter havido uma. Aqui o ADM confirma, cliente a cliente, se teve
-- proposta e quando. O painel conta pela data confirmada; "não teve" sai da
-- contagem. A coleta não mexe nesta tabela (al_sincronizar não a conhece).
-- =====================================================================
begin;

create table if not exists al_propostas_validacao (
  id_cliente text primary key,
  teve_proposta boolean not null,
  -- dia da proposta (só quando teve)
  data_proposta date,
  observacao text,
  atualizado_em timestamptz not null default now(),
  atualizado_por text,
  constraint al_propostas_validacao_data check (teve_proposta or data_proposta is null)
);
comment on table al_propostas_validacao is 'Se o cliente marcado como Proposta teve proposta mesmo, e quando (ADM, no painel)';
-- só o servidor (chave secreta) lê e grava
alter table al_propostas_validacao enable row level security;

commit;

-- Conferência: a tabela existe
select count(*) as propostas_validadas from al_propostas_validacao;
