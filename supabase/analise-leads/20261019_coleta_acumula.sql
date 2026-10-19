-- =====================================================================
-- Análise de leads P&G — a coleta passa a SOMAR (banco kvwgtyihxcegylcguncj)
-- Rodar no SQL Editor do projeto novo. Pode rodar de novo sem erro.
--
-- Antes, cada gravação trocava inteiros os resumos (mensagens, dash da LEN):
-- coletar um período curto apagava o anterior. Agora:
--   1. As mensagens ficam guardadas uma a uma (al_mensagens, sem contato:
--      a chave é um código calculado no navegador). Os totais por corretor e
--      por horário são recalculados com TODAS as mensagens guardadas.
--   2. Lead que já existe e reaparece é atualizado; canal, campanha, palavra-
--      chave e origem que vierem vazios não apagam o que já estava gravado.
--   3. O dash da LEN continua trocado inteiro, mas o sistema passa a buscá-lo
--      para o período inteiro já coletado (não só o da coleta nova).
-- =====================================================================
begin;

create table if not exists al_mensagens (
  chave text primary key,
  data date,
  hora text,
  corretor text,
  status text,
  midia text,
  carregado_em timestamptz not null default now()
);
comment on table al_mensagens is 'Mensagens recebidas no Hypnobox (sem contato do cliente), somadas entre coletas';
alter table al_mensagens enable row level security;
create index if not exists al_mensagens_corretor_idx on al_mensagens (corretor);

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
  chaves constant jsonb := '{"al_leads": "id_cliente", "al_visitas": "visita_id", "al_mensagens": "chave"}';
  -- vazio na coleta nova não apaga o que já estava gravado
  manter constant text[] := array['nome', 'email', 'telefone', 'telefone_original', 'nome_cliente', 'email_cliente',
    'canal', 'campanha', 'palavra_chave', 'origem'];
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
