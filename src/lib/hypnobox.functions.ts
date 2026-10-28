import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { secondaryAdmin } from "@/integrations/supabase/secondary.server";
import { periodoColetado, type ColetaPeriodo } from "@/lib/coleta/periodo";
import { corretoresDoSistema } from "@/lib/corretores-sistema.server";

// O painel "Análise Hypnobox" foi escrito para ler planilhas (CSV): todo valor
// chega como texto e célula vazia é "". As linhas saem daqui nesse formato para
// o painel fazer exatamente a mesma leitura.
export type HypnoboxRow = Record<string, string>;
export type HypnoboxData = {
  datasets: Record<string, HypnoboxRow[]>;
  /** Dia da última coleta (AAAA-MM-DD, horário de Brasília), se registrado. */
  coletadoEm: string | null;
  /** Período da última coleta (AAAA-MM-DD), se registrado. */
  periodo: { de: string; ate: string } | null;
};
/**
 * Com a base inteira (14 mil leads e as entradas) a resposta passaria do limite
 * de 4,5 MB da Vercel: o servidor manda o JSON compactado (gzip em base64).
 */
export type HypnoboxPacote = { gz: string };

/** Abre no navegador o pacote compactado de getHypnoboxData. */
export async function abrirHypnoboxData(p: HypnoboxPacote): Promise<HypnoboxData> {
  const bytes = Uint8Array.from(atob(p.gz), (c) => c.charCodeAt(0));
  const texto = await new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).text();
  return JSON.parse(texto) as HypnoboxData;
}

// Nome do conjunto de dados no painel -> tabela no segundo banco. Sem `order`,
// vale a ordem em que as linhas foram carregadas (a mesma da planilha).
const SOURCES: Record<string, { table: string; order?: string }> = {
  leads_hypnobox: { table: "al_leads", order: "id_cliente" },
  visitas_hypnobox: { table: "al_visitas", order: "visita_id" },
  mensagens_corretor: { table: "al_mensagens_corretor" },
  mensagens_horario: { table: "al_mensagens_horario", order: "ordem" },
  funil_produto: { table: "al_funil_produto" },
  status_geral: { table: "al_status_geral", order: "ordem" },
  fontes: { table: "al_fontes" },
  descarte: { table: "al_descarte" },
  veiculo: { table: "al_veiculo" },
  mkt_campanhas: { table: "al_mkt_campanhas", order: "id" },
  mkt_anuncios: { table: "al_mkt_anuncios", order: "id" },
  mkt_palavras: { table: "al_mkt_palavras" },
  mkt_diario: { table: "al_mkt_diario", order: "data" },
  // cada entrada de lead (novo ou retorno), do Relatório de contatos
  entradas: { table: "al_entradas_tipo", order: "chave" },
  // data real de cada venda, confirmada pelo ADM (vazio até rodar 20261024_vendas_data.sql)
  vendas_data: { table: "al_vendas_data", order: "id_cliente" },
  // resposta do corretor pelo link de conferência: a visita aconteceu ou não
  visitas_confirmadas: { table: "al_visitas_confirmadas", order: "chave" },
  // visitas que o corretor informou pelo link e não estavam na agenda do Hypnobox
  visitas_informadas: { table: "al_visitas_informadas", order: "data" },
};
// tabelas que podem ainda não existir no banco: sem elas o painel abre do mesmo jeito
const OPCIONAIS = new Set(["al_vendas_data", "al_visitas_confirmadas", "al_visitas_informadas"]);

const PAGE = 1000;

async function readTable(table: string, order?: string) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = secondaryAdmin.from(table).select("*");
    if (order) query = query.order(order);
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error && OPCIONAIS.has(table)) return [];
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// Dados de contato (LGPD): só nome, e-mail e telefone dos leads vão para o painel
// (que é só do ADM), para a ficha do lead. Os das visitas continuam de fora.
const OMITIDAS = new Set([
  "carregado_em",
  "pessoa",
  "midia",
  "nome",
  "email",
  "telefone",
  "telefone_original",
  "nome_cliente",
  "email_cliente",
]);

const CONTATO_DO_LEAD = new Set(["nome", "email", "telefone"]);

function toSheetRow(row: Record<string, unknown>, comContato = false): HypnoboxRow {
  const out: HypnoboxRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (OMITIDAS.has(key) && !(comContato && CONTATO_DO_LEAD.has(key))) continue;
    out[key] = value == null ? "" : String(value);
  }
  // a carga de 14/10 renomeou outubro_1a13 para outubro; o painel lê o nome antigo
  if ("outubro" in out && !("outubro_1a13" in out)) out.outubro_1a13 = out.outubro;
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function exigirAdmin(context: { supabase: any; userId: string }) {
  const { data: caller } = await context.supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", context.userId)
    .single();
  if (!caller || (caller.role !== "admin" && caller.role !== "director"))
    throw new Error("Acesso restrito ao administrador");
  return caller as { role: string; full_name: string | null };
}

const dataVendaSchema = z.object({
  id_cliente: z.string().regex(/^\d{1,12}$/),
  // null apaga a data confirmada (volta a valer a aproximada)
  data_venda: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  observacao: z.string().max(500).optional(),
});

/** Grava (ou apaga) a data real de uma venda e devolve todas as datas confirmadas. */
export const salvarDataVenda = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => dataVendaSchema.parse(d))
  .handler(async ({ data, context }): Promise<HypnoboxRow[]> => {
    const quem = await exigirAdmin(context);
    const { error } = data.data_venda
      ? await secondaryAdmin.from("al_vendas_data").upsert({
          id_cliente: data.id_cliente,
          data_venda: data.data_venda,
          observacao: data.observacao ?? null,
          atualizado_em: new Date().toISOString(),
          atualizado_por: quem.full_name,
        })
      : await secondaryAdmin.from("al_vendas_data").delete().eq("id_cliente", data.id_cliente);
    if (error)
      throw new Error(
        /al_vendas_data/.test(error.message) && /exist|schema cache/i.test(error.message)
          ? "O banco ainda não tem a tabela de datas de venda: rode supabase/analise-leads/20261024_vendas_data.sql no SQL Editor do projeto novo."
          : `Não foi possível gravar: ${error.message}`,
      );
    return (await readTable("al_vendas_data", "id_cliente")).map((r) => toSheetRow(r));
  });

const linkConferenciaSchema = z.object({
  corretor: z.string().min(1).max(120),
  nome: z.string().max(120).optional(),
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Link único para o corretor conferir as visitas do período (página /conferir/<token>, sem login). */
export const criarLinkConferencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => linkConferenciaSchema.parse(d))
  .handler(async ({ data, context }): Promise<string> => {
    const quem = await exigirAdmin(context);
    if (data.de > data.ate) throw new Error("Período inválido");
    const { randomBytes } = await import("node:crypto");
    const token = randomBytes(18).toString("base64url");
    const { error } = await secondaryAdmin.from("al_conferencia_links").insert({
      token,
      corretor: data.corretor,
      nome: data.nome ?? null,
      de: data.de,
      ate: data.ate,
      criado_por: quem.full_name,
      // o link vale 45 dias
      expira_em: new Date(Date.now() + 45 * 864e5).toISOString(),
    });
    if (error)
      throw new Error(
        /al_conferencia_links/.test(error.message) && /exist|schema cache/i.test(error.message)
          ? "O banco ainda não tem a conferência de visitas: rode supabase/analise-leads/20261028_conferencia_visitas.sql no SQL Editor do projeto novo."
          : `Não foi possível criar o link: ${error.message}`,
      );
    return token;
  });

export const getHypnoboxData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HypnoboxPacote> => {
    await exigirAdmin(context);

    const entries = await Promise.all(
      Object.entries(SOURCES).map(async ([id, src]) => {
        const rows = (await readTable(src.table, src.order)).map((r) =>
          toSheetRow(r, src.table === "al_leads"),
        );
        return [id, rows] as const;
      }),
    );
    const datasets = Object.fromEntries(entries);
    // no painel o lead é identificado por "id"
    datasets.leads_hypnobox = datasets.leads_hypnobox.map((r) => ({ ...r, id: r.id_cliente }));

    // corretores, equipes e escala do sistema principal (a equipe do painel vem daqui)
    const nomesHyp = new Set<string>();
    for (const id of ["leads_hypnobox", "visitas_hypnobox", "entradas"])
      for (const r of datasets[id] ?? []) if (r.corretor) nomesHyp.add(r.corretor);
    const sistema = await corretoresDoSistema([...nomesHyp]);
    datasets.corretores_sistema = sistema.corretores;
    datasets.turnos_sistema = sistema.turnos;

    const { data: coleta } = await secondaryAdmin
      .from("al_coletas")
      .select("coletado_em, periodo_inicio, periodo_fim")
      .order("coletado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    const coletadoEm = coleta?.coletado_em
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
          new Date(coleta.coletado_em as string),
        )
      : null;

    // período de referência do painel: tudo o que já foi coletado (as coletas somam)
    const { data: todas } = await secondaryAdmin
      .from("al_coletas")
      .select("periodo_inicio, periodo_fim, fontes");
    const periodo = periodoColetado((todas ?? []) as ColetaPeriodo[]);

    const { gzipSync } = await import("node:zlib");
    const pacote: HypnoboxData = { datasets, coletadoEm, periodo };
    return { gz: gzipSync(JSON.stringify(pacote)).toString("base64") };
  });
