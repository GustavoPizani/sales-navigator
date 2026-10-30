import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { secondaryAdmin } from "@/integrations/supabase/secondary.server";
import { CANAIS_FORA_LEN } from "@/lib/coleta/carga";
import { ehCargaCompleta, periodoColetado, type ColetaPeriodo } from "@/lib/coleta/periodo";
import { exigirLeituraAnalise, INICIO_LEITOR } from "@/lib/analise-acesso.server";

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
    if (carga.tabelas.al_leads) carga.tabelas.al_leads = await manterOrigem(carga.tabelas.al_leads);
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
          ...(await vincularVisitasSemCliente()),
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
    return { ...((res ?? {}) as ResultadoSincronizacao), ...(await vincularVisitasSemCliente()) };
  });

// ---------------- origem do lead ----------------

/**
 * Quanto a origem diz: campanha (LEN) e origem própria (orgânico, carteira) são
 * conhecidas; "Outras origens" é quando a tela não mostrou a mídia.
 */
const origemConhecida = (canal: unknown) =>
  typeof canal === "string" && canal !== "" && canal !== "Outras origens";

/**
 * Guarda a primeira origem conhecida do lead: a tela de Clientes nem sempre mostra
 * a mídia, e a coleta mandava "Outras origens" por cima da campanha LEN já gravada.
 * Quando o banco já tem origem conhecida, canal, campanha e palavra-chave vão
 * vazios (al_sincronizar mantém o que está gravado quando o valor novo é vazio).
 */
async function manterOrigem(leads: Record<string, unknown>[]) {
  const gravado = new Map<string, unknown>();
  const ids = leads.map((l) => String(l.id_cliente));
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await secondaryAdmin
      .from("al_leads")
      .select("id_cliente, canal")
      .in("id_cliente", ids.slice(i, i + 300));
    if (error) throw new Error(`Não foi possível conferir a origem dos leads: ${error.message}`);
    for (const r of data ?? []) gravado.set(String(r.id_cliente), r.canal);
  }
  return leads.map((l) => {
    const antes = gravado.get(String(l.id_cliente));
    if (!origemConhecida(antes)) return l;
    // o banco já sabe a origem: não troca (nem uma LEN por outra)
    return { ...l, canal: null, campanha: null, palavra_chave: null };
  });
}

// ---------------- referência da coleta e cliente das visitas ----------------

/** Todas as linhas de uma consulta, de 1000 em 1000 (ordenadas para a paginação ser estável). */
async function todasAsLinhas(
  tabela: string,
  cols: string,
  ordem: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filtro: (q: any) => any = (q) => q,
) {
  const out: AnyRow[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await filtro(secondaryAdmin.from(tabela).select(cols))
      .order(ordem)
      .range(i, i + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...((data ?? []) as AnyRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function contarNoPeriodo(
  tabela: string,
  coluna: string,
  de: string,
  ate: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filtro: (q: any) => any = (q) => q,
) {
  const { count, error } = await filtro(
    secondaryAdmin
      .from(tabela)
      .select("*", { count: "exact", head: true })
      .gte(coluna, de)
      .lte(coluna, ate),
  );
  if (error) throw new Error(`${tabela}: ${error.message}`);
  return (count ?? 0) as number;
}

const chaveNome = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const chaveEmail = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");

/**
 * Cliente pelo e-mail e, se não achar, pelo nome completo (8+ letras), entre
 * todos os leads do banco. Só vale quando um único cliente tem aquele valor.
 */
async function indiceDeLeads() {
  const leads = await todasAsLinhas("al_leads", "id_cliente, nome, email", "id_cliente");
  const porEmail = new Map<string, string | null>();
  const porNome = new Map<string, string | null>();
  const add = (m: Map<string, string | null>, k: string, id: string) => {
    if (k) m.set(k, m.has(k) && m.get(k) !== id ? null : id);
  };
  for (const l of leads) {
    const id = String(l.id_cliente);
    add(porEmail, chaveEmail(l.email), id);
    add(porNome, chaveNome(l.nome), id);
  }
  return (email: unknown, nome: unknown): string | null => {
    const e = chaveEmail(email);
    if (e && porEmail.get(e)) return porEmail.get(e)!;
    const n = chaveNome(nome);
    return n.length >= 8 ? (porNome.get(n) ?? null) : null;
  };
}

/** Visitas já gravadas sem cliente: liga ao lead do banco pelo e-mail ou nome da visita. */
async function vincularVisitasSemCliente(): Promise<ResultadoSincronizacao> {
  try {
    const sem = await todasAsLinhas(
      "al_visitas",
      "visita_id, nome_cliente, email_cliente",
      "visita_id",
      (q) => q.is("id_cliente", null),
    );
    if (!sem.length) return {};
    const achar = await indiceDeLeads();
    let n = 0;
    for (const v of sem) {
      const id = achar(v.email_cliente, v.nome_cliente);
      if (!id) continue;
      const { error } = await secondaryAdmin
        .from("al_visitas")
        .update({ id_cliente: id })
        .eq("visita_id", v.visita_id as string)
        .is("id_cliente", null);
      if (!error) n++;
    }
    return n
      ? { visitas_vinculadas: { atualizados: n, aviso: `${n} pelo e-mail ou nome do cliente` } }
      : {};
  } catch {
    // a carga já foi gravada: o vínculo fica para a próxima coleta
    return {};
  }
}

export type ReferenciaColeta = {
  /** mesmos dias imediatamente antes do período; null se o banco não tem esses dias coletados */
  anterior: { de: string; ate: string } | null;
  contagens: { leadsLen: number; visitas: number; mensagensLen: number; entradas: number } | null;
  /** dash da LEN já gravado: investimento por dia (só dias completos) e campanhas do período */
  len: { diario: [string, number][]; campanhas: number } | null;
  /** visita_id -> id_cliente, achado nos leads do banco */
  clienteDaVisita: Record<string, string>;
};

const somaDiasIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diaBrasilia = (ts: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(ts));

/** Todo dia de `de` a `ate` está dentro de alguma coleta (sem contar as cargas completas). */
function cobre(coletas: ColetaPeriodo[], de: string, ate: string) {
  const faixas = coletas.filter(
    (c) => !ehCargaCompleta(c) && c.periodo_inicio && c.periodo_fim,
  ) as { periodo_inicio: string; periodo_fim: string }[];
  for (let d = de; d <= ate; d = somaDiasIso(d, 1))
    if (!faixas.some((f) => f.periodo_inicio <= d && f.periodo_fim >= d)) return false;
  return true;
}

const referenciaSchema = z.object({
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  visitas: z
    .array(
      z.object({
        visita_id: z.string().min(1).max(20),
        email: z.string().max(200).nullable(),
        nome: z.string().max(200).nullable(),
      }),
    )
    .max(5000),
});

/**
 * O que a coleta compara antes de gravar: os mesmos dias imediatamente antes do
 * período (leads, visitas, mensagens e entradas já gravados) e o dash da LEN já
 * gravado nas mesmas datas. Também acha nos leads do banco o cliente das visitas.
 */
export const getReferenciaColeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    referenciaSchema.refine((x) => x.de <= x.ate, "Período inválido.").parse(d),
  )
  .handler(async ({ data, context }): Promise<ReferenciaColeta> => {
    await exigirAdmin(context);
    const dias = Math.round((Date.parse(data.ate) - Date.parse(data.de)) / 864e5) + 1;
    const anterior = { de: somaDiasIso(data.de, -dias), ate: somaDiasIso(data.de, -1) };
    const { data: coletas } = await secondaryAdmin
      .from("al_coletas")
      .select("coletado_em, periodo_inicio, periodo_fim, fontes");
    const lista = (coletas ?? []) as (ColetaPeriodo & { coletado_em: string })[];

    let contagens: ReferenciaColeta["contagens"] = null;
    if (cobre(lista, anterior.de, anterior.ate)) {
      const { de, ate } = anterior;
      const [leadsLen, visitas, mensagensLen, entradas] = await Promise.all([
        // lead LEN no banco: canal de campanha (os de fora da LEN têm canal próprio ou vazio)
        contarNoPeriodo("al_leads", "cadastro", de, ate, (q) =>
          q
            .not("canal", "is", null)
            .not("canal", "in", `(${CANAIS_FORA_LEN.map((c) => `"${c}"`).join(",")})`),
        ),
        contarNoPeriodo("al_visitas", "data", de, ate),
        contarNoPeriodo("al_mensagens", "data", de, ate, (q) => q.ilike("midia", "%len%")),
        contarNoPeriodo("al_entradas", "data", de, ate).catch(() => 0),
      ]);
      contagens = { leadsLen, visitas, mensagensLen, entradas };
    }

    // o último dia gravado do dash da LEN pode estar incompleto (coleta no meio do dia)
    const ultimaLen = lista
      .filter((c) => /LEN/.test(c.fontes ?? "") && c.coletado_em)
      .map((c) => diaBrasilia(c.coletado_em))
      .sort()
      .pop();
    let len: ReferenciaColeta["len"] = null;
    if (ultimaLen) {
      const diario = new Map<string, number>();
      for (const r of await todasAsLinhas("al_mkt_diario", "data, investimento", "data", (q) =>
        q.lt("data", ultimaLen),
      ))
        diario.set(
          r.data as string,
          (diario.get(r.data as string) ?? 0) + Number(r.investimento ?? 0),
        );
      const { count } = await secondaryAdmin
        .from("al_mkt_campanhas")
        .select("*", { count: "exact", head: true })
        .eq("janela", "periodo");
      len = { diario: [...diario.entries()], campanhas: count ?? 0 };
    }

    const clienteDaVisita: Record<string, string> = {};
    if (data.visitas.length) {
      const achar = await indiceDeLeads();
      for (const v of data.visitas) {
        const id = achar(v.email, v.nome);
        if (id) clienteDaVisita[v.visita_id] = id;
      }
    }
    return { anterior: contagens ? anterior : null, contagens, len, clienteDaVisita };
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
    // ler o dash da LEN de outro período também vale para o leitor da análise,
    // a partir de INICIO_LEITOR
    const { admin } = await exigirLeituraAnalise(context);
    const de = !admin && data.de < INICIO_LEITOR ? INICIO_LEITOR : data.de;
    if (de > data.ate) throw new Error("Período antes do início liberado para a análise.");
    const { lerTarefaLen } = await import("./coleta/len.server");
    return (await lerTarefaLen(data.indice, de, data.ate)) as ParteLen;
  });
