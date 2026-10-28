-- =====================================================================
-- Análise de leads P&G — conferência da agenda pelo corretor (banco kvwgtyihxcegylcguncj)
-- Rodar no SQL Editor do projeto novo. Pode rodar de novo sem erro.
--
-- O ADM gera, no 1:1, um link único para um corretor e um período. O corretor
-- abre o link (sem login), vê as visitas dele no período e diz se cada uma
-- aconteceu. A resposta vale para o painel (lista de visitas do 1:1).
-- A coleta não mexe nestas tabelas (al_sincronizar não as conhece).
-- =====================================================================
begin;

create table if not exists al_conferencia_links (
  token text primary key,
  corretor text not null,          -- nome do corretor no Hypnobox
  nome text,                       -- nome no sistema, para a saudação
  de date not null,
  ate date not null,
  criado_em timestamptz not null default now(),
  criado_por text,
  expira_em timestamptz not null,
  aberto_em timestamptz,
  respondido_em timestamptz
);
comment on table al_conferencia_links is 'Links únicos de conferência da agenda (corretor + período), gerados no 1:1';

-- uma resposta por visita (cliente + corretor + dia, como o painel conta); a última vale
create table if not exists al_visitas_confirmadas (
  chave text primary key,          -- id_cliente|corretor|AAAA-MM-DD
  id_cliente text not null,
  corretor text not null,
  data date not null,
  aconteceu boolean not null,
  observacao text,
  token text references al_conferencia_links (token) on delete set null,
  respondido_em timestamptz not null default now()
);
comment on table al_visitas_confirmadas is 'Resposta do corretor: a visita aconteceu ou não';
create index if not exists al_visitas_confirmadas_corretor on al_visitas_confirmadas (corretor, data);

-- só o servidor (chave secreta) lê e grava
alter table al_conferencia_links enable row level security;
alter table al_visitas_confirmadas enable row level security;

commit;

-- Conferência: as tabelas existem
select (select count(*) from al_conferencia_links) as links, (select count(*) from al_visitas_confirmadas) as respostas;
