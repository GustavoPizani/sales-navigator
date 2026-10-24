import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { secondaryAdmin } from "@/integrations/supabase/secondary.server";
import { periodoColetado, type ColetaPeriodo } from "@/lib/coleta/periodo";

// Central de coleta (Hypnobox + dash da LEN). O extrator roda no PC do ADM e
// coleta; aqui o servidor lê o banco novo e grava a carga. Dados de contato são
// pessoais (LGPD): saem mascarados, e o valor real só vem pelo "revelar".

// valores como vêm do banco (JSON simples), para o retorno ser serializável
type Valor = string | number | boolean | null;
type AnyRow = Record<string, Valor>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function exigirAdmin(context: { supabase: SupabaseClient<any>; userId: string }) {
  const { data: caller } = await context.supabase
    .from("profiles")
    .select("role")
    .eq("id", context.userId)
    .single();
  if (!caller || (caller.role !== "admin" && caller.role !== "director"))
    throw new Error("Acesso restrito ao administrador");
}

/** ju***@gmail.com */
function mascararEmail(v: unknown) {
  const s = typeof v === "string" ? v : "";
  const [u, d] = s.split("@");
  if (!u || !d) return s ? "***" : null;
  return `${u.slice(0, 2)}***@${d}`;
}
/** (11) 9****-5663 */
function mascararTelefone(v: unknown) {
  const d = String(v ?? "").replace(/\D/g, "");
  if (!d) return null;
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  const ddd = local.length >= 10 ? local.slice(0, 2) : "";
  const num = ddd ? local.slice(2) : local;
  return `${ddd ? `(${ddd}) ` : ""}${num.slice(0, 1)}****-${num.slice(-4)}`;
}
/** Ana S. */
function mascararNome(v: unknown) {
  const partes = String(v ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!partes.length) return null;
  return partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1][0]}.` : partes[0];
}

function mascarar(row: AnyRow): AnyRow {
  const out: AnyRow = { ...row };
  delete out.carregado_em;
  delete out.telefone_original;
  if ("nome" in out) out.nome = mascararNome(out.nome);
  if ("email" in out) out.email = mascararEmail(out.email);
  if ("telefone" in out) out.telefone = mascararTelefone(out.telefone);
  if ("nome_cliente" in out) out.nome_cliente = mascararNome(out.nome_cliente);
  if ("email_cliente" in out) out.email_cliente = mascararEmail(out.email_cliente);
  return out;
}

const PREVIA = 100;
const TABELAS = [
  "al_leads",
  "al_visitas",
  "al_mensagens",
  "al_mensagens_corretor",
  "al_mensagens_horario",
  "al_funil_produto",
  "al_status_geral",
  "al_fontes",
  "al_descarte",
  "al_veiculo",
  "al_mkt_campanhas",
  "al_mkt_diario",
  "al_mkt_anuncios",
  "al_mkt_palavras",
  "al_entradas",
] as const;

async function contar(tabela: string) {
  const { count, error } = await secondaryAdmin
    .from(tabela)
    .select("*", { count: "exact", head: true });
  return error ? null : (count ?? 0);
}

async function ler(tabela: string, ordem?: { col: string; asc?: boolean }, limite = PREVIA) {
  let q = secondaryAdmin.from(tabela).select("*").limit(limite);
  if (ordem) q = q.order(ordem.col, { ascending: ordem.asc ?? false, nullsFirst: false });
  const { data, error } = await q;
  if (error) throw new Error(`${tabela}: ${error.message}`);
  return (data ?? []) as AnyRow[];
}

export type ColetaPainel = Awaited<ReturnType<typeof montarPainel>>;

async function montarPainel() {
  const [
    contagens,
    coletas,
    leads,
    visitas,
    msgCorretor,
    msgHorario,
    funil,
    veiculo,
    status,
    campanhas,
  ] = await Promise.all([
    Promise.all(TABELAS.map(async (t) => [t, await contar(t)] as const)).then((r) =>
      Object.fromEntries(r),
    ),
    ler("al_coletas", { col: "coletado_em" }, 10),
    ler("al_leads", { col: "atualizacao" }),
    ler("al_visitas", { col: "data" }),
    ler("al_mensagens_corretor", { col: "mensagens" }),
    ler("al_mensagens_horario", { col: "ordem", asc: true }),
    ler("al_funil_produto", { col: "leads" }),
    ler("al_veiculo"),
    ler("al_status_geral", { col: "ordem", asc: true }),
    ler("al_mkt_campanhas", { col: "investimento" }, 30),
  ]);
  return {
    contagens: contagens as Record<string, number | null>,
    coletas,
    previas: {
      leads: leads.map(mascarar),
      visitas: visitas.map(mascarar),
      mensagensCorretor: msgCorretor,
      mensagensHorario: msgHorario,
      funil,
      veiculo,
      status,
      campanhas,
    },
  };
}

export const getColetaPainel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirAdmin(context);
    return montarPainel();
  });

/**
 * O que já está no banco da análise, para a coleta somar em vez de apagar:
 * os IDs dos leads (um lead antigo que reaparece é atualizado) e o período
 * inteiro já coletado (o dash da LEN é sincronizado para ele todo).
 */
export const getColetaBase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({ context }): Promise<{ ids: string[]; de: string | null; ate: string | null }> => {
      await exigirAdmin(context);
      const ids: string[] = [];
      for (let i = 0; ; i += 1000) {
        const { data, error } = await secondaryAdmin
          .from("al_leads")
          .select("id_cliente")
          .order("id_cliente")
          .range(i, i + 999);
        if (error) throw new Error(error.message);
        ids.push(...(data ?? []).map((r) => String(r.id_cliente)));
        if (!data || data.length < 1000) break;
      }
      const { data: coletas } = await secondaryAdmin
        .from("al_coletas")
        .select("periodo_inicio, periodo_fim, fontes");
      const p = periodoColetado((coletas ?? []) as ColetaPeriodo[]);
      return { ids, de: p?.de ?? null, ate: p?.ate ?? null };
    },
  );

const revelarSchema = z.object({
  tabela: z.enum(["al_leads", "al_visitas"]),
  id: z.string().min(1).max(20),
});

/** Contato completo de uma linha da prévia (só ADM; nada vai para log). */
export const revelarContato = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => revelarSchema.parse(data))
  .handler(async ({ data, context }) => {
    await exigirAdmin(context);
    const leads = data.tabela === "al_leads";
    const { data: row, error } = await secondaryAdmin
      .from(data.tabela)
      .select(leads ? "nome, email, telefone" : "nome_cliente, email_cliente")
      .eq(leads ? "id_cliente" : "visita_id", data.id)
      .maybeSingle();
    if (error) throw new Error("Não foi possível ler o contato.");
    const r = (row ?? {}) as AnyRow;
    return {
      nome: (r.nome ?? r.nome_cliente ?? null) as string | null,
      email: (r.email ?? r.email_cliente ?? null) as string | null,
      telefone: (r.telefone ?? null) as string | null,
    };
  });

const cargaSchema = z.object({
  tabelas: z
    .record(z.array(z.record(z.unknown())).max(20000))
    .refine((t) => Object.keys(t).every((k) => (TABELAS as readonly string[]).includes(k)), {
      message: "Tabela não permitida na carga.",
    }),
  coleta: z.object({
    periodo_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodo_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fontes: z.string().max(500),
    observacao: z.string().max(2000),
  }),
});

export type ResultadoSincronizacao = Record<
  string,
  { inseridos?: number; atualizados?: number; substituidos?: number; aviso?: string }
>;

/**
 * Grava a carga vinda do extrator: leads e visitas são sincronizados (atualiza
 * os que existem, insere os novos); as tabelas de resumo são trocadas.
 * Tudo numa transação, pela função al_sincronizar do banco novo.
 */
// A carga de uma coleta grande passa do limite de 4,5 MB por pedido da Vercel:
// o navegador manda o JSON compactado (gzip em base64) e ele é aberto aqui.
const cargaCompactada = z.object({ gz: z.string().min(1).max(4_000_000) });

export const sincronizarCarga = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const c = cargaCompactada.safeParse(d);
    return c.success ? c.data : cargaSchema.parse(d);
  })
  .handler(async ({ data, context }): Promise<ResultadoSincronizacao> => {
    await exigirAdmin(context);
    let carga: z.infer<typeof cargaSchema>;
    if ("gz" in data) {
      const { gunzipSync } = await import("node:zlib");
      carga = cargaSchema.parse(
        JSON.parse(gunzipSync(Buffer.from(data.gz, "base64")).toString("utf8")),
      );
    } else carga = data;
    let { data: res, error } = await secondaryAdmin.rpc("al_sincronizar", { p: carga });
    // banco ainda sem al_entradas (migration 20261023_entradas.sql não rodada): grava o resto
    if (error && carga.tabelas.al_entradas && /al_entradas/.test(error.message)) {
      const { al_entradas: _fora, ...resto } = carga.tabelas;
      if (!Object.keys(resto).length)
        throw new Error(
          "O banco ainda não tem a tabela de entradas: rode supabase/analise-leads/20261023_entradas.sql no SQL Editor do projeto novo.",
        );
      ({ data: res, error } = await secondaryAdmin.rpc("al_sincronizar", {
        p: { ...carga, tabelas: resto },
      }));
      if (!error)
        return {
          ...((res ?? {}) as ResultadoSincronizacao),
          al_entradas: { aviso: "não gravadas: falta rodar 20261023_entradas.sql" },
        };
    }
    if (error) {
      // a mensagem do banco não traz linhas da carga; só o motivo
      if (
        /al_sincronizar/.test(error.message) &&
        /not find|does not exist|schema cache/i.test(error.message)
      )
        throw new Error(
          "O banco ainda não tem a função al_sincronizar: rode o arquivo supabase/analise-leads/20261014_central_coleta.sql no SQL Editor do projeto novo.",
        );
      throw new Error(`O banco recusou a carga: ${error.message}`);
    }
    return (res ?? {}) as ResultadoSincronizacao;
  });

// ---------------- dash da LEN (API pública da Keepi) ----------------

export type ParteLen = {
  nome: string;
  total: number;
  tabelas: Record<string, AnyRow[]>;
  investimentoPeriodo: number;
  janelas: { janela: string; de: string; ate: string }[];
};

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Lê uma página do dash da LEN (o navegador chama uma por vez e mostra o andamento). */
export const lerParteLen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ indice: z.number().int().min(0).max(40), de: dataIso, ate: dataIso })
      .refine((x) => x.de <= x.ate, "Período inválido.")
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ParteLen> => {
    await exigirAdmin(context);
    const { lerTarefaLen } = await import("./coleta/len.server");
    return (await lerTarefaLen(data.indice, data.de, data.ate)) as ParteLen;
  });
