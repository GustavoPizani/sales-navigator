import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O leitor vê os dados a partir desta data. Clientes cadastrados antes continuam
 * quando tiveram alguma interação a partir dela (atualização, entrada ou visita).
 */
export const INICIO_LEITOR = "2026-07-01";

type Linha = Record<string, string>;
// dash da LEN gravado na coleta: totais do período da coleta (começa antes do leitor)
const LEN_DO_PERIODO = [
  "funil_produto",
  "status_geral",
  "fontes",
  "descarte",
  "veiculo",
  "mkt_campanhas",
  "mkt_anuncios",
  "mkt_palavras",
];
const COM_DATA = [
  "visitas_hypnobox",
  "entradas",
  "visitas_informadas",
  "turnos_sistema",
  "mkt_diario",
];

/** Recorta os conjuntos de dados do painel para o leitor (a partir de INICIO_LEITOR). */
export function recortarParaLeitor(datasets: Record<string, Linha[]>) {
  const ini = INICIO_LEITOR;
  for (const id of LEN_DO_PERIODO) if (datasets[id]) datasets[id] = [];
  for (const id of COM_DATA)
    if (datasets[id]) datasets[id] = datasets[id].filter((r) => (r.data ?? "") >= ini);
  if (datasets.visitas_confirmadas)
    datasets.visitas_confirmadas = datasets.visitas_confirmadas.filter(
      (r) =>
        // a chave da visita confirmada termina na data (cliente|corretor|data)
        (r.chave ?? "").slice(-10) >= ini,
    );
  // clientes: cadastrados ou atualizados no período, ou com entrada ou visita nele
  const ativos = new Set<string>();
  for (const r of datasets.entradas ?? []) if (r.id_cliente) ativos.add(r.id_cliente);
  for (const r of datasets.visitas_hypnobox ?? []) if (r.id_cliente) ativos.add(r.id_cliente);
  if (datasets.leads_hypnobox)
    datasets.leads_hypnobox = datasets.leads_hypnobox.filter(
      (r) => (r.cadastro ?? "") >= ini || (r.atualizacao ?? "") >= ini || ativos.has(r.id_cliente),
    );
}

/**
 * Quem lê a Análise Hypnobox: o ADM e quem tem o módulo "analise" na matriz de
 * permissões do cargo (o leitor). Gravar (datas de venda, propostas, links,
 * coleta) continua só com o ADM. `admin` diz se o usuário vê também o contato
 * dos clientes (LGPD: o leitor não vê).
 */
export async function exigirLeituraAnalise(context: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>;
  userId: string;
}): Promise<{ admin: boolean }> {
  const { data: p } = await context.supabase
    .from("profiles")
    .select("role, cargo_id, is_active")
    .eq("id", context.userId)
    .single();
  if (!p?.is_active) throw new Error("Acesso restrito");
  if (p.role === "admin" || p.role === "director") return { admin: true };
  if (p.cargo_id) {
    const { data: perm } = await context.supabase
      .from("cargo_permissions")
      .select("level")
      .eq("cargo_id", p.cargo_id)
      .eq("module", "analise")
      .maybeSingle();
    if (perm?.level === "view" || perm?.level === "edit") return { admin: false };
  }
  throw new Error("Acesso restrito");
}
