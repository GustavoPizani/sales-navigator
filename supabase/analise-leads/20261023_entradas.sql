-- =====================================================================
-- Análise de leads P&G — entradas de leads (banco kvwgtyihxcegylcguncj)
-- Rodar no SQL Editor do projeto novo. Pode rodar de novo sem erro.
--
-- 1. al_entradas: cada entrada de lead no Relatório de contatos do Hypnobox
--    (o mesmo cliente pode entrar várias vezes). É a base para comparar com a
--    LEN, que conta "novos + retornos" pela data de entrada.
-- 2. al_entradas_tipo: "novo" ou "retorno". Vale a marcação do Hypnobox (coluna
--    retorno, da lista "Retornos") quando existe; senão, é retorno quando a mesma
--    pessoa já tinha entrado antes ou a entrada é depois do dia do cadastro.
--    A pessoa é um código do telefone (ou e-mail), sem o número.
-- 3. al_sincronizar passa a aceitar al_entradas (atualiza pela chave, insere as novas).
-- =====================================================================
begin;

create table if not exists al_entradas (
  chave text primary key,          -- pessoa + data e hora da entrada
  pessoa text,                     -- código do telefone/e-mail (sem o número)
  id_cliente text,                 -- vazio quando o cliente não está na lista de Clientes
  data date,
  hora text,
  canal text,
  campanha text,
  palavra_chave text,
  midia text,
  canal_contato text,
  produto text,
  corretor text,
  carregado_em timestamptz not null default now()
);
alter table al_entradas add column if not exists pessoa text;
-- marcação do próprio Hypnobox (lista "Retornos"), quando lida; vazio = usa a regra
alter table al_entradas add column if not exists retorno boolean;
comment on table al_entradas is 'Entradas de leads no Hypnobox (Relatório de contatos), novas e retornos';
alter table al_entradas enable row level security;
create index if not exists al_entradas_data_idx on al_entradas (data);
create index if not exists al_entradas_cliente_idx on al_entradas (id_cliente);
create index if not exists al_entradas_pessoa_idx on al_entradas (pessoa, data, hora);

create or replace view al_entradas_tipo
with (security_invoker = true) as
select e.*,
       l.cadastro,
       case when e.retorno is not null then case when e.retorno then 'retorno' else 'novo' end
            when row_number() over (partition by e.pessoa order by e.data, e.hora) > 1
              or (l.cadastro is not null and e.data > l.cadastro)
            then 'retorno' else 'novo' end as tipo
  from al_entradas e
  left join al_leads l on l.id_cliente = e.id_cliente;

create or replace function public.al_sincronizar(p jsonb)
returns jsonb
language plpgsql
security definer
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
  chaves constant jsonb := '{"al_leads": "id_cliente", "al_visitas": "visita_id", "al_mensagens": "chave", "al_entradas": "chave"}';
  -- vazio na coleta nova não apaga o que já estava gravado
  manter constant text[] := array['nome', 'email', 'telefone', 'telefone_original', 'nome_cliente', 'email_cliente',
    'canal', 'campanha', 'palavra_chave', 'origem', 'midia', 'retorno', 'id_cliente'];
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
               case when column_name = any(manter)
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

  -- totais de mensagens com TODAS as mensagens guardadas (só as de mídia LEN)
  if p->'tabelas' ? 'al_mensagens' then
    truncate al_mensagens_corretor;
    insert into al_mensagens_corretor (corretor, mensagens, respondidas, lidas_sem_resposta, direcionadas, nao_lidas)
    select coalesce(nullif(corretor, ''), '(sem corretor)'),
           count(*),
           count(*) filter (where status = 'respondida'),
           count(*) filter (where status = 'lida'),
           count(*) filter (where status = 'direcionada'),
           count(*) filter (where status = 'nao_lida')
      from al_mensagens
     where midia ilike '%len%'
     group by 1;
    truncate al_mensagens_horario;
    insert into al_mensagens_horario (faixa, ordem, mensagens)
    select f.faixa, f.ordem,
           (select count(*) from al_mensagens m
             where m.midia ilike '%len%' and m.hora ~ '^\d{1,2}:'
               and split_part(m.hora, ':', 1)::int >= f.ini and split_part(m.hora, ':', 1)::int < f.fim)
      from (values ('00h–08h', 0, 0, 8), ('08h–12h', 1, 8, 12), ('12h–18h', 2, 12, 18),
                   ('18h–22h', 3, 18, 22), ('22h–24h', 4, 22, 24)) as f(faixa, ordem, ini, fim);
    res := res || jsonb_build_object('al_mensagens_corretor',
      jsonb_build_object('substituidos', (select count(*) from al_mensagens_corretor)));
  end if;

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

-- Conferência: a tabela existe e a função aceita al_entradas
select (select count(*) from al_entradas) as entradas,
       position('al_entradas' in pg_get_functiondef('public.al_sincronizar(jsonb)'::regprocedure)) > 0 as funcao_ok;
