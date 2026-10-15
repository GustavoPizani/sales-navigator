import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { secondaryAdmin } from "@/integrations/supabase/secondary.server";

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
};

const PAGE = 1000;

async function readTable(table: string, order?: string) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = secondaryAdmin.from(table).select("*");
    if (order) query = query.order(order);
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// Dados de contato (LGPD) não vão para o painel: ele não usa e não precisa carregá-los.
const OMITIDAS = new Set([
  "carregado_em",
  "nome",
  "email",
  "telefone",
  "telefone_original",
  "nome_cliente",
  "email_cliente",
]);

function toSheetRow(row: Record<string, unknown>): HypnoboxRow {
  const out: HypnoboxRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (OMITIDAS.has(key)) continue;
    out[key] = value == null ? "" : String(value);
  }
  // a carga de 14/10 renomeou outubro_1a13 para outubro; o painel lê o nome antigo
  if ("outubro" in out && !("outubro_1a13" in out)) out.outubro_1a13 = out.outubro;
  return out;
}

export const getHypnoboxData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HypnoboxData> => {
    const { data: caller } = await context.supabase
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .single();
    if (!caller || (caller.role !== "admin" && caller.role !== "director"))
      throw new Error("Acesso restrito ao administrador");

    const entries = await Promise.all(
      Object.entries(SOURCES).map(async ([id, src]) => {
        const rows = (await readTable(src.table, src.order)).map(toSheetRow);
        return [id, rows] as const;
      }),
    );
    const datasets = Object.fromEntries(entries);
    // no painel o lead é identificado por "id"
    datasets.leads_hypnobox = datasets.leads_hypnobox.map((r) => ({ ...r, id: r.id_cliente }));

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

    const periodo =
      coleta?.periodo_inicio && coleta?.periodo_fim
        ? { de: String(coleta.periodo_inicio), ate: String(coleta.periodo_fim) }
        : null;

    return { datasets, coletadoEm, periodo };
  });
