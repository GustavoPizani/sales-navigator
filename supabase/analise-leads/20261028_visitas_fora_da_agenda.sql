-- =====================================================================
-- Análise de leads P&G — visitas fora da agenda (banco kvwgtyihxcegylcguncj)
-- Rodar no SQL Editor do projeto novo, depois de 20261028_conferencia_visitas.sql.
-- Pode rodar de novo sem erro.
--
-- Na página de conferência, o corretor informa visitas que fez e que não estão
-- na agenda do Hypnobox: cliente, produto, dia e observação. Elas aparecem no
-- 1:1 à parte das visitas da agenda.
-- =====================================================================
begin;

create table if not exists al_visitas_informadas (
  id uuid primary key default gen_random_uuid(),
  token text references al_conferencia_links (token) on delete set null,
  corretor text not null,          -- nome do corretor no Hypnobox
  id_cliente text not null,
  produto text not null,
  data date not null,
  observacao text,
  criado_em timestamptz not null default now()
);
comment on table al_visitas_informadas is 'Visitas que o corretor informou pelo link de conferência e não estavam na agenda do Hypnobox';
create index if not exists al_visitas_informadas_corretor on al_visitas_informadas (corretor, data);

-- só o servidor (chave secreta) lê e grava
alter table al_visitas_informadas enable row level security;

commit;

-- Conferência: a tabela existe
select count(*) as visitas_informadas from al_visitas_informadas;
