-- =====================================================================
-- Análise de leads P&G — Central de coleta (banco kvwgtyihxcegylcguncj)
-- Rodar UMA vez no SQL Editor do projeto novo. Pode rodar de novo sem erro.
-- 1. Estrutura das tabelas al_* (mesma da carga de 14/10/2026), se faltar.
-- 2. Colunas de contato (nome, e-mail, telefone): dado pessoal (LGPD).
-- 3. Função al_sincronizar, que a Central de coleta chama pelo servidor:
--    leads e visitas são sincronizados (atualiza os que existem, insere os
--    novos, não apaga ninguém); as tabelas de resumo são trocadas inteiras.
-- Acesso: RLS ligado e sem políticas = só a chave secreta (servidor) lê e grava.
-- =====================================================================
begin;

create table if not exists al_coletas (
  id bigint generated always as identity primary key,
  coletado_em timestamptz not null default now(),
  periodo_inicio date, periodo_fim date, fontes text, observacao text
);
alter table al_coletas enable row level security;

create table if not exists al_leads (
  id_cliente text primary key,
  cadastro date,
  atualizacao date,
  produto text,
  corretor text,
  gerente text,
  momento text,
  submomento text,
  etapa text,
  canal text,
  campanha text,
  palavra_chave text,
  origem text,
  status_cliente text,
  dias_desde_cadastro integer,
  dias_sem_atualizar integer,
  carregado_em timestamptz not null default now()
);
comment on table al_leads is 'Leads das campanhas LEN no Hypnobox (cadastro 01/09 a 14/10/2026)';
alter table al_leads enable row level security;
create table if not exists al_visitas (
  visita_id text primary key,
  id_cliente text,
  data date,
  hora text,
  status text,
  corretor text,
  gerente text,
  registrado_por text,
  quem_registrou text,
  produto text,
  temperatura text,
  submomento text,
  origem text,
  grupo_origem text,
  canal_origem text,
  lead_campanha_periodo boolean,
  cadastro_lead date,
  dias_cadastro_ate_visita integer,
  etapa_no_crm text,
  carregado_em timestamptz not null default now()
);
comment on table al_visitas is 'Módulo de Visitas do Hypnobox (data entre 01/09 e 31/10/2026)';
alter table al_visitas enable row level security;
create table if not exists al_mensagens_corretor (
  corretor text primary key,
  mensagens integer,
  respondidas integer,
  lidas_sem_resposta integer,
  direcionadas integer,
  nao_lidas integer,
  carregado_em timestamptz not null default now()
);
comment on table al_mensagens_corretor is 'Mensagens de lead (campanhas LEN) por corretor e status de resposta';
alter table al_mensagens_corretor enable row level security;
create table if not exists al_mensagens_horario (
  faixa text primary key,
  ordem integer,
  mensagens integer,
  carregado_em timestamptz not null default now()
);
comment on table al_mensagens_horario is 'Mensagens de lead por faixa de horário';
alter table al_mensagens_horario enable row level security;
create table if not exists al_funil_produto (
  produto text primary key,
  leads integer,
  leads_set integer,
  leads_out integer,
  investimento numeric,
  meta_leads integer,
  tentando_contato integer,
  em_contato integer,
  interesse_futuro integer,
  visita_agendada integer,
  visita_realizada integer,
  proposta integer,
  descarte integer,
  sem_status integer,
  meta_ads_leads integer,
  meta_ads_invest numeric,
  google_leads integer,
  google_invest numeric,
  organico_leads integer,
  carregado_em timestamptz not null default now()
);
comment on table al_funil_produto is 'Dash LEN: funil e investimento por empreendimento (01/09 a 14/10/2026)';
alter table al_funil_produto enable row level security;
create table if not exists al_status_geral (
  etapa text primary key,
  ordem integer,
  setembro integer,
  outubro integer,
  carregado_em timestamptz not null default now()
);
comment on table al_status_geral is 'Dash LEN: submomento agrupado';
alter table al_status_geral enable row level security;
create table if not exists al_fontes (
  fonte text primary key,
  setembro integer,
  outubro integer,
  carregado_em timestamptz not null default now()
);
comment on table al_fontes is 'Dash LEN: fontes de contato';
alter table al_fontes enable row level security;
create table if not exists al_descarte (
  motivo text primary key,
  setembro integer,
  outubro integer,
  carregado_em timestamptz not null default now()
);
comment on table al_descarte is 'Dash LEN: motivos de descarte';
alter table al_descarte enable row level security;
create table if not exists al_veiculo (
  veiculo text primary key,
  investimento_previsto numeric,
  investimento_real numeric,
  leads integer,
  meta_leads integer,
  carregado_em timestamptz not null default now()
);
comment on table al_veiculo is 'Dash LEN: planejado vs realizado por veículo';
alter table al_veiculo enable row level security;
create table if not exists al_mkt_campanhas (
  id bigint generated always as identity primary key,
  janela text,
  campanha text,
  canal text,
  produto text,
  objetivo text,
  investimento numeric,
  cliques integer,
  impressoes integer,
  conversoes_plataforma integer,
  carregado_em timestamptz not null default now()
);
comment on table al_mkt_campanhas is 'Dash LEN: campanhas Meta e Google por janela (periodo=01/09-14/10, anterior=19/07-31/08, setembro, outubro=01-14/10)';
alter table al_mkt_campanhas enable row level security;
create table if not exists al_mkt_diario (
  data date,
  canal text,
  investimento numeric,
  cliques integer,
  impressoes integer,
  leads_formulario_meta integer,
  primary key (data, canal),
  carregado_em timestamptz not null default now()
);
comment on table al_mkt_diario is 'Dash LEN: investimento, cliques e impressões por dia e canal (01/09 a 14/10/2026)';
alter table al_mkt_diario enable row level security;
create table if not exists al_mkt_anuncios (
  id bigint generated always as identity primary key,
  janela text,
  anuncio text,
  produto text,
  formato text,
  investimento numeric,
  cliques integer,
  impressoes integer,
  leads_formulario integer,
  leads_pixel integer,
  carregado_em timestamptz not null default now()
);
comment on table al_mkt_anuncios is 'Dash LEN: anúncios Meta por janela (lista completa, pela API da Keepi)';
alter table al_mkt_anuncios enable row level security;
create table if not exists al_mkt_palavras (
  palavra_chave text primary key,
  investimento numeric,
  cliques integer,
  impressoes integer,
  conversoes integer,
  carregado_em timestamptz not null default now()
);
comment on table al_mkt_palavras is 'Dash LEN: 80 palavras-chave do Google com mais investimento (01/09 a 14/10/2026)';
alter table al_mkt_palavras enable row level security;

-- Quem já rodou a carga de 13/10: a coluna outubro_1a13 passa a se chamar outubro
do $$
declare t text;
begin
  foreach t in array array['al_status_geral','al_fontes','al_descarte'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'outubro_1a13') then
      execute format('alter table %I rename column outubro_1a13 to outubro', t);
    end if;
  end loop;
end $$;

create index if not exists al_leads_corretor_idx on al_leads (corretor);
create index if not exists al_leads_produto_idx on al_leads (produto);
create index if not exists al_leads_etapa_idx on al_leads (etapa);
create index if not exists al_visitas_cliente_idx on al_visitas (id_cliente);
create index if not exists al_visitas_data_idx on al_visitas (data);
create index if not exists al_mkt_campanhas_janela_idx on al_mkt_campanhas (janela, canal, produto);

-- Dados de contato (LGPD: só a chave secreta lê; não vão para logs)
alter table al_leads add column if not exists nome text;
alter table al_leads add column if not exists email text;
alter table al_leads add column if not exists telefone text;
alter table al_leads add column if not exists telefone_original text;
alter table al_visitas add column if not exists nome_cliente text;
alter table al_visitas add column if not exists email_cliente text;

-- Sincroniza uma coleta, numa transação só (a chamada RPC já é uma transação).
-- p = { "tabelas": { "al_leads": [...], ... }, "coleta": { periodo_inicio, periodo_fim, fontes, observacao } }
create or replace function public.al_sincronizar(p jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  t text;
  pk text;
  cols text;
  sets text;
  n_ins integer;
  n_upd integer;
  n integer;
  res jsonb := '{}'::jsonb;
  -- tabelas sincronizadas pela chave: atualiza o que existe e insere o que é novo
  chaves constant jsonb := '{"al_leads": "id_cliente", "al_visitas": "visita_id"}';
  -- contato já gravado não é apagado por uma coleta que veio sem ele
  contato constant text[] := array['nome', 'email', 'telefone', 'telefone_original', 'nome_cliente', 'email_cliente'];
  -- retratos do momento: trocados inteiros a cada coleta
  resumos constant text[] := array['al_mensagens_corretor', 'al_mensagens_horario', 'al_funil_produto', 'al_status_geral',
    'al_fontes', 'al_descarte', 'al_veiculo', 'al_mkt_campanhas', 'al_mkt_diario', 'al_mkt_anuncios', 'al_mkt_palavras'];
begin
  if p is null or jsonb_typeof(p->'tabelas') <> 'object' then
    raise exception 'Carga sem tabelas.';
  end if;

  for t in select jsonb_object_keys(p->'tabelas') loop
    if not (chaves ? t or t = any(resumos)) then
      raise exception 'Tabela não permitida: %', t;
    end if;
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t and is_identity = 'NO' and column_name <> 'carregado_em';

    if chaves ? t then
      pk := chaves->>t;
      select string_agg(
               case when column_name = any(contato)
                    then format('%1$I = coalesce(excluded.%1$I, d.%1$I)', column_name)
                    else format('%1$I = excluded.%1$I', column_name) end,
               ', ' order by ordinal_position) into sets
        from information_schema.columns
       where table_schema = 'public' and table_name = t and is_identity = 'NO' and column_name not in (pk, 'carregado_em');
      execute format(
        'with r as (insert into %1$I as d (%2$s) select %2$s from jsonb_populate_recordset(null::%1$I, $1) '
        'on conflict (%3$I) do update set %4$s, carregado_em = now() returning (xmax = 0) as novo) '
        'select count(*) filter (where novo), count(*) filter (where not novo) from r',
        t, cols, pk, sets)
        into n_ins, n_upd using p->'tabelas'->t;
      res := res || jsonb_build_object(t, jsonb_build_object('inseridos', n_ins, 'atualizados', n_upd));
    else
      execute format('truncate %I restart identity', t);
      execute format('insert into %1$I (%2$s) select %2$s from jsonb_populate_recordset(null::%1$I, $1)', t, cols)
        using p->'tabelas'->t;
      get diagnostics n = row_count;
      res := res || jsonb_build_object(t, jsonb_build_object('substituidos', n));
    end if;
  end loop;

  insert into al_coletas (periodo_inicio, periodo_fim, fontes, observacao)
  values ((p->'coleta'->>'periodo_inicio')::date, (p->'coleta'->>'periodo_fim')::date,
          p->'coleta'->>'fontes', p->'coleta'->>'observacao');
  return res;
end;
$$;

-- só o servidor (chave secreta / service_role) executa
revoke all on function public.al_sincronizar(jsonb) from public, anon, authenticated;
grant execute on function public.al_sincronizar(jsonb) to service_role;

commit;
