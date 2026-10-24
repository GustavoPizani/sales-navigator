/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck -- tools com esquemas zod; os dados do banco são JSON livres
/**
 * MCP da Análise Hypnobox (só leitura), servido pelo Sales Navigator em
 * /api/mcp/<token> para o Claude no navegador (conector personalizado).
 * Lê o banco da análise (tabelas al_*) para relatórios e métricas de corretores,
 * campanhas e do dash da LEN.
 * - Dado pessoal (LGPD): nome, e-mail e telefone NUNCA saem daqui; os leads vêm
 *   pelo id do cliente, com o link para abrir no Hypnobox.
 * - As regras de etapa e de funil são as mesmas do painel Análise Hypnobox.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const HYPNOBOX = "https://paesegregori.hypnobox.com.br";
const linkHypnobox = (id) =>
  `${HYPNOBOX}/?controle=Cliente&acao=timeline&id_cliente=${encodeURIComponent(id)}&janelaSimples=S`;

// colunas que podem sair (sem contato)
const COLUNAS = {
  al_coletas: "id,coletado_em,periodo_inicio,periodo_fim,fontes,observacao",
  al_leads:
    "id_cliente,cadastro,atualizacao,produto,corretor,gerente,momento,submomento,etapa,canal,campanha,palavra_chave,origem,status_cliente,dias_desde_cadastro,dias_sem_atualizar",
  al_visitas:
    "visita_id,id_cliente,data,hora,status,corretor,gerente,registrado_por,quem_registrou,produto,temperatura,submomento,origem,grupo_origem,canal_origem,lead_campanha_periodo,cadastro_lead,dias_cadastro_ate_visita,etapa_no_crm",
  al_mensagens_corretor: "corretor,mensagens,respondidas,lidas_sem_resposta,direcionadas,nao_lidas",
  al_mensagens_horario: "faixa,ordem,mensagens",
  al_funil_produto: "*",
  al_status_geral: "*",
  al_fontes: "*",
  al_descarte: "*",
  al_veiculo: "*",
  al_mkt_campanhas: "*",
  al_mkt_diario: "*",
  al_mkt_anuncios: "*",
  al_mkt_palavras: "*",
  al_vendas_data: "id_cliente,data_venda,observacao,atualizado_em,atualizado_por",
};
const TABELAS = Object.keys(COLUNAS);
const FORA_LEN = new Set([
  "Orgânico",
  "Carteira do corretor",
  "Carteira P&G / oferta ativa",
  "Outras origens",
]);

// ---------------- leitura do banco (com cache de 5 min) ----------------
const cache = new Map();
async function tabela(nome) {
  const URL_DB = process.env.SUPABASE_SECONDARY_URL;
  const CHAVE = process.env.SUPABASE_SECONDARY_SECRET_KEY;
  if (!URL_DB || !CHAVE)
    throw new Error("Faltam SUPABASE_SECONDARY_URL e SUPABASE_SECONDARY_SECRET_KEY no servidor.");
  const c = cache.get(nome);
  if (c && Date.now() - c.em < 5 * 60000) return c.linhas;
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const res = await fetch(`${URL_DB}/rest/v1/${nome}?select=${COLUNAS[nome]}`, {
      headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, Range: `${de}-${de + 999}` },
    });
    if (!res.ok) throw new Error(`Falha ao ler ${nome}: HTTP ${res.status}`);
    const parte = await res.json();
    linhas.push(...parte);
    if (parte.length < 1000) break;
  }
  if (nome === "al_leads") linhas.forEach(normalizarLead);
  cache.set(nome, { em: Date.now(), linhas });
  return linhas;
}

/**
 * Mesmas regras do painel: etapa pelo momento (proposta e venda em qualquer
 * submomento), "Não cliente" conta como descartado (menos venda, que é venda de
 * fato) e dias sem atualizar contados até hoje.
 */
const hojeSP = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
function normalizarLead(r) {
  const momento = String(r.momento ?? "");
  if (/^vend/i.test(momento)) r.etapa = "Venda";
  else if (/^n[ãa]o cliente$/i.test(String(r.status_cliente ?? ""))) r.etapa = "Não interessado";
  else if (/^propost/i.test(momento)) r.etapa = "Proposta";
  if (r.atualizacao)
    r.dias_sem_atualizar = Math.max(
      0,
      Math.round((Date.parse(hojeSP() + "T00:00:00Z") - Date.parse(r.atualizacao + "T00:00:00Z")) / 864e5),
    );
}

// ---------------- regras do painel ----------------
const norm = (s) =>
  String(s ?? "")
    .trim()
    .toUpperCase();
const isSem = (r) => r.etapa === "Tentando contato" || r.etapa === "Sem submomento";
const isVenda = (r) => /^vend/i.test(String(r.momento ?? ""));
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const media = (xs) =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

/** Funil acumulado de cada lead (mesma regra do painel: visita registrada conta como agendado/visita). */
function funil(leads, visitas) {
  const vis = new Map();
  for (const v of visitas) {
    if (!v.id_cliente) continue;
    const o = vis.get(v.id_cliente) || { any: false, real: false };
    o.any = true;
    if (v.status === "Realizada") o.real = true;
    vis.set(v.id_cliente, o);
  }
  return leads.map((r) => {
    const v = vis.get(r.id_cliente) || {};
    const venda = isVenda(r);
    const proposta = venda || r.etapa === "Proposta";
    const visita = proposta || !!v.real || /^Visitou/.test(String(r.submomento ?? ""));
    const agendado =
      visita || !!v.any || (r.etapa === "Visita" && !/^Tentando/.test(String(r.submomento ?? "")));
    const contato = agendado || r.etapa === "Em tratativa" || r.etapa === "Visita";
    return {
      r,
      contato,
      agendado,
      visita,
      proposta,
      venda,
      descartado: r.etapa === "Não interessado",
    };
  });
}
function totais(F) {
  const n = F.length;
  const c = (k) => F.filter((x) => x[k]).length;
  const o = {
    leads: n,
    sem_contato: F.filter((x) => isSem(x.r)).length,
    contato: c("contato"),
    agendado: c("agendado"),
    visita: c("visita"),
    proposta: c("proposta"),
    venda: c("venda"),
    descartado: c("descartado"),
  };
  return {
    ...o,
    taxa_contato: pct(o.contato, n),
    taxa_agendamento: pct(o.agendado, n),
    taxa_visita: pct(o.visita, n),
    taxa_proposta: pct(o.proposta, n),
    taxa_descarte: pct(o.descartado, n),
    visita_sobre_agendado: pct(o.visita, o.agendado),
  };
}

const filtrosLeads = {
  de: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Cadastro a partir de (aaaa-mm-dd)"),
  ate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Cadastro até (aaaa-mm-dd)"),
  corretor: z.string().optional().describe("Nome do corretor (igual ao Hypnobox)"),
  gerente: z.string().optional(),
  produto: z.string().optional().describe("Empreendimento, ex.: 312 JAM"),
  canal: z
    .string()
    .optional()
    .describe(
      'Canal exato (ex.: "Meta Ads", "Google Pesquisa", "Orgânico", "Carteira do corretor") ou "LEN" para só as campanhas da LEN',
    ),
};
function filtrar(leads, f) {
  return leads.filter(
    (r) =>
      (!f.de || (r.cadastro && r.cadastro >= f.de)) &&
      (!f.ate || (r.cadastro && r.cadastro <= f.ate)) &&
      (!f.corretor || norm(r.corretor) === norm(f.corretor)) &&
      (!f.gerente || norm(r.gerente) === norm(f.gerente)) &&
      (!f.produto || norm(r.produto).includes(norm(f.produto))) &&
      (!f.canal ||
        (f.canal.toUpperCase() === "LEN"
          ? !FORA_LEN.has(r.canal)
          : norm(r.canal) === norm(f.canal))),
  );
}
const resposta = (dados) => ({ content: [{ type: "text", text: JSON.stringify(dados, null, 1) }] });
const agrupar = (xs, chave) => {
  const m = new Map();
  for (const x of xs) {
    const k = chave(x) || "(vazio)";
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};

// ---------------- servidor ----------------
/** Um servidor novo por requisição (sem sessão): a Vercel não guarda estado entre chamadas. */
export function criarServidorAnalise() {
  const server = new McpServer({ name: "analise-leads", version: "1.0.0" });
  const SO_LEITURA = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    "visao_geral",
    {
      title: "Visão geral da análise",
      description:
        "Última coleta (data e período), quantas linhas cada tabela tem e totais de leads por canal, etapa e corretor. Comece por aqui para saber o período disponível.",
      annotations: SO_LEITURA,
    },
    async () => {
      const [coletas, leads, visitas] = await Promise.all([
        tabela("al_coletas"),
        tabela("al_leads"),
        tabela("al_visitas"),
      ]);
      const ult = [...coletas].sort((a, b) =>
        String(b.coletado_em).localeCompare(String(a.coletado_em)),
      );
      const contar = (xs, k) =>
        Object.fromEntries(
          [...agrupar(xs, (x) => x[k])].map(([a, v]) => [a, v.length]).sort((a, b) => b[1] - a[1]),
        );
      const cad = leads
        .map((l) => l.cadastro)
        .filter(Boolean)
        .sort();
      return resposta({
        ultimas_coletas: ult.slice(0, 5),
        leads: leads.length,
        cadastro_de: cad[0] ?? null,
        cadastro_ate: cad[cad.length - 1] ?? null,
        visitas: visitas.length,
        leads_por_canal: contar(leads, "canal"),
        leads_por_etapa: contar(leads, "etapa"),
        leads_por_corretor: contar(leads, "corretor"),
        observacao:
          'Canais "Orgânico", "Carteira do corretor", "Carteira P&G / oferta ativa" e "Outras origens" não são da LEN. Use canal "LEN" para ver só as campanhas.',
      });
    },
  );

  server.registerTool(
    "metricas_corretores",
    {
      title: "Métricas por corretor",
      description:
        "Funil por corretor (leads, sem contato, contato, agendado, visita, proposta, venda, descartados e taxas), leads parados, dias sem atualizar, visitas registradas e mensagens respondidas. Filtros por período de cadastro, gerente, produto e canal.",
      inputSchema: {
        ...filtrosLeads,
        dias_parado: z
          .number()
          .int()
          .min(1)
          .max(90)
          .default(7)
          .describe("Lead parado = sem atualizar há mais que isso"),
        ordenar_por: z
          .enum([
            "leads",
            "taxa_contato",
            "taxa_agendamento",
            "taxa_visita",
            "taxa_descarte",
            "parados",
            "media_dias_sem_atualizar",
          ])
          .default("leads"),
      },
      annotations: SO_LEITURA,
    },
    async (f) => {
      const [leadsTodos, visitas, msgs] = await Promise.all([
        tabela("al_leads"),
        tabela("al_visitas"),
        tabela("al_mensagens_corretor"),
      ]);
      const leads = filtrar(leadsTodos, f);
      const F = funil(leads, visitas);
      const msgPor = new Map(msgs.map((m) => [norm(m.corretor), m]));
      const visPer = visitas.filter(
        (v) =>
          (!f.de || (v.data && v.data >= f.de)) &&
          (!f.ate || (v.data && v.data <= f.ate)) &&
          (!f.gerente || norm(v.gerente) === norm(f.gerente)) &&
          (!f.produto || norm(v.produto).includes(norm(f.produto))),
      );
      const visPor = agrupar(visPer, (v) => norm(v.corretor));
      const linhas = [...agrupar(F, (x) => x.r.corretor)].map(([corretor, X]) => {
        const ativos = X.filter((x) => !x.descartado);
        const dias = ativos.map((x) => x.r.dias_sem_atualizar).filter((d) => d != null);
        const vs = visPor.get(norm(corretor)) || [];
        const m = msgPor.get(norm(corretor));
        return {
          corretor,
          gerente: X[0].r.gerente,
          ...totais(X),
          leads_len: X.filter((x) => !FORA_LEN.has(x.r.canal)).length,
          organicos: X.filter((x) => x.r.canal === "Orgânico").length,
          carteira: X.filter((x) => x.r.canal === "Carteira do corretor").length,
          parados: ativos.filter((x) => (x.r.dias_sem_atualizar ?? 0) > f.dias_parado).length,
          media_dias_sem_atualizar: media(dias),
          visitas_registradas_no_periodo: {
            total: vs.length,
            realizadas: vs.filter((v) => v.status === "Realizada").length,
            nao_realizadas: vs.filter((v) => v.status === "Não realizada").length,
            agendadas: vs.filter((v) => v.status === "Agendada").length,
          },
          mensagens_len: m
            ? {
                recebidas: m.mensagens,
                respondidas: m.respondidas,
                taxa_resposta: pct(m.respondidas, m.mensagens),
                nao_lidas: m.nao_lidas,
                lidas_sem_resposta: m.lidas_sem_resposta,
              }
            : null,
        };
      });
      const ord = f.ordenar_por === "parados" ? "parados" : f.ordenar_por;
      linhas.sort((a, b) => (b[ord] ?? -1) - (a[ord] ?? -1));
      return resposta({
        filtros: f,
        equipe: totais(F),
        corretores: linhas,
        notas: [
          "Funil acumulado: quem visitou também conta como agendado e em contato.",
          "Mensagens cobrem o período inteiro da última coleta (não seguem o filtro de datas).",
          "Visitas registradas seguem a data da visita.",
        ],
      });
    },
  );

  server.registerTool(
    "funil_campanhas",
    {
      title: "Funil por campanha",
      description:
        "Conversão por campanha e canal (leads → contato → agendado → visita → proposta → venda, e % descartados), com os mesmos filtros.",
      inputSchema: {
        ...filtrosLeads,
        agrupar_por: z.enum(["campanha", "canal", "produto", "gerente"]).default("campanha"),
      },
      annotations: SO_LEITURA,
    },
    async (f) => {
      const [leadsTodos, visitas] = await Promise.all([tabela("al_leads"), tabela("al_visitas")]);
      const F = funil(filtrar(leadsTodos, f), visitas);
      const linhas = [...agrupar(F, (x) => x.r[f.agrupar_por])]
        .map(([nome, X]) => ({
          [f.agrupar_por]: nome,
          canal: f.agrupar_por === "campanha" ? X[0].r.canal : undefined,
          ...totais(X),
        }))
        .sort((a, b) => b.leads - a.leads);
      return resposta({ filtros: f, total: totais(F), linhas });
    },
  );

  server.registerTool(
    "detalhe_corretor",
    {
      title: "Leads e visitas de um corretor",
      description:
        "Lista os leads de um corretor (id, cadastro, produto, canal, campanha, etapa, submomento, dias sem atualizar e link do Hypnobox) e as visitas dele. Sem nome, e-mail ou telefone.",
      inputSchema: {
        corretor: z.string(),
        de: filtrosLeads.de,
        ate: filtrosLeads.ate,
        so_parados: z
          .boolean()
          .default(false)
          .describe("Só leads ativos sem atualizar há mais de 7 dias"),
        limite: z.number().int().min(1).max(500).default(200),
      },
      annotations: SO_LEITURA,
    },
    async (f) => {
      const [leadsTodos, visitas] = await Promise.all([tabela("al_leads"), tabela("al_visitas")]);
      let leads = filtrar(leadsTodos, f);
      if (f.so_parados)
        leads = leads.filter(
          (l) => l.etapa !== "Não interessado" && (l.dias_sem_atualizar ?? 0) > 7,
        );
      leads.sort((a, b) => (b.dias_sem_atualizar ?? 0) - (a.dias_sem_atualizar ?? 0));
      const vs = visitas.filter((v) => norm(v.corretor) === norm(f.corretor));
      return resposta({
        corretor: f.corretor,
        leads_total: leads.length,
        leads: leads.slice(0, f.limite).map((l) => ({
          id_cliente: l.id_cliente,
          cadastro: l.cadastro,
          atualizacao: l.atualizacao,
          dias_sem_atualizar: l.dias_sem_atualizar,
          produto: l.produto,
          canal: l.canal,
          campanha: l.campanha,
          etapa: l.etapa,
          momento: l.momento,
          submomento: l.submomento,
          status_cliente: l.status_cliente,
          hypnobox: linkHypnobox(l.id_cliente),
        })),
        visitas: vs.map(
          ({
            visita_id,
            id_cliente,
            data,
            hora,
            status,
            produto,
            temperatura,
            submomento,
            grupo_origem,
            registrado_por,
          }) => ({
            visita_id,
            id_cliente,
            data,
            hora,
            status,
            produto,
            temperatura,
            submomento,
            grupo_origem,
            registrado_por,
          }),
        ),
      });
    },
  );

  server.registerTool(
    "dash_len",
    {
      title: "Dados do dash da LEN",
      description:
        "Números do dash da agência LEN: funil por empreendimento, planejado x realizado por veículo, status, fontes, motivos de descarte, campanhas, anúncios, palavras-chave e mídia por dia.",
      inputSchema: {
        secao: z.enum([
          "funil_produto",
          "veiculo",
          "status_geral",
          "fontes",
          "descarte",
          "campanhas",
          "anuncios",
          "palavras",
          "diario",
        ]),
        janela: z
          .enum(["periodo", "anterior", "setembro", "outubro"])
          .optional()
          .describe(
            "Para campanhas e anúncios: periodo = período da coleta, anterior = mesmo nº de dias antes",
          ),
        limite: z.number().int().min(1).max(1000).default(200),
      },
      annotations: SO_LEITURA,
    },
    async (f) => {
      const nome = {
        funil_produto: "al_funil_produto",
        veiculo: "al_veiculo",
        status_geral: "al_status_geral",
        fontes: "al_fontes",
        descarte: "al_descarte",
        campanhas: "al_mkt_campanhas",
        anuncios: "al_mkt_anuncios",
        palavras: "al_mkt_palavras",
        diario: "al_mkt_diario",
      }[f.secao];
      let linhas = (await tabela(nome)).map(({ carregado_em, ...r }) => r);
      if (f.janela && linhas.length && "janela" in linhas[0])
        linhas = linhas.filter((r) => r.janela === f.janela);
      if (linhas.length && "investimento" in linhas[0])
        linhas.sort((a, b) => Number(b.investimento ?? 0) - Number(a.investimento ?? 0));
      return resposta({
        secao: f.secao,
        janela: f.janela ?? null,
        total: linhas.length,
        linhas: linhas.slice(0, f.limite),
      });
    },
  );

  server.registerTool(
    "vendas",
    {
      title: "Vendas por corretor (antes x desde o início)",
      description:
        'Vendas = clientes no momento "Venda" do Hypnobox. A data da venda é a confirmada pelo ADM no painel (aba Vendas) ou, sem ela, a última atualização do cliente (aproximada). Compara os 365 dias antes da data de início com o período desde ela, por corretor (total e média por mês), com propostas abertas e visitas realizadas desde o início, e lista venda a venda com a origem da data.',
      inputSchema: {
        inicio: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .default("2026-09-18")
          .describe("Data de início (aaaa-mm-dd); padrão: início na supervisão do online"),
        gerente: z.string().optional(),
        corretor: z.string().optional(),
      },
      annotations: SO_LEITURA,
    },
    async (f) => {
      const [leads, visitas, datas] = await Promise.all([
        tabela("al_leads"),
        tabela("al_visitas"),
        // a tabela de datas confirmadas pode ainda não existir
        tabela("al_vendas_data").catch(() => []),
      ]);
      const dia = (iso, n) =>
        new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
      const hoje = hojeSP();
      const antesDe = dia(f.inicio, -365);
      const antesAte = dia(f.inicio, -1);
      const diasDepois = Math.max(1, Math.round((Date.parse(hoje) - Date.parse(f.inicio)) / 864e5) + 1);
      const porMes = (n, dias) => Math.round((n / (dias / (365 / 12))) * 10) / 10;
      const conf = new Map(datas.map((d) => [String(d.id_cliente), d]));
      const base = leads.filter(
        (r) =>
          (!f.gerente || norm(r.gerente) === norm(f.gerente)) &&
          (!f.corretor || norm(r.corretor) === norm(f.corretor)),
      );
      const vendas = base
        .filter((r) => r.etapa === "Venda")
        .map((r) => {
          const c = conf.get(String(r.id_cliente));
          return {
            id_cliente: r.id_cliente,
            corretor: r.corretor,
            gerente: r.gerente,
            produto: r.produto,
            canal: r.canal,
            situacao: r.submomento,
            data: c ? c.data_venda : r.atualizacao,
            data_confirmada: !!c,
            observacao: c?.observacao ?? null,
          };
        })
        .filter((v) => v.data);
      const antes = (v) => v.data >= antesDe && v.data <= antesAte;
      const depois = (v) => v.data >= f.inicio;
      const corretores = [...agrupar(base, (r) => r.corretor)]
        .map(([corretor, L]) => {
          const V = vendas.filter((v) => v.corretor === corretor);
          const a = V.filter(antes).length;
          const d = V.filter(depois).length;
          return {
            corretor,
            gerente: L[0].gerente,
            vendas_antes: a,
            media_mes_antes: Math.round((a / 12) * 10) / 10,
            vendas_desde_inicio: d,
            media_mes_desde: porMes(d, diasDepois),
            propostas_abertas: L.filter((r) => r.etapa === "Proposta").length,
            visitas_realizadas_desde_inicio: visitas.filter(
              (v) => norm(v.corretor) === norm(corretor) && v.status === "Realizada" && v.data >= f.inicio,
            ).length,
          };
        })
        .filter((c) => c.vendas_antes || c.vendas_desde_inicio || c.propostas_abertas)
        .sort((a, b) => b.vendas_desde_inicio - a.vendas_desde_inicio || b.vendas_antes - a.vendas_antes);
      const tA = vendas.filter(antes).length;
      const tD = vendas.filter(depois).length;
      return resposta({
        janelas: { antes: { de: antesDe, ate: antesAte, dias: 365 }, desde_inicio: { de: f.inicio, ate: hoje, dias: diasDepois } },
        equipe: {
          vendas_antes: tA,
          media_mes_antes: Math.round((tA / 12) * 10) / 10,
          vendas_desde_inicio: tD,
          media_mes_desde: porMes(tD, diasDepois),
          vendas_com_data_confirmada: vendas.filter((v) => v.data_confirmada).length,
          vendas_total: vendas.length,
        },
        corretores,
        vendas: vendas.sort((a, b) => b.data.localeCompare(a.data)),
        notas: [
          "data_confirmada = false: a data é a última atualização do cliente e pode estar depois da venda real.",
          'Clientes "Não cliente" contam como descartados, menos os que estão em Venda.',
        ],
      });
    },
  );

  server.registerTool(
    "consultar_tabela",
    {
      title: "Consultar uma tabela da análise",
      description: `Linhas de uma tabela al_* com filtros de igualdade (colunas de contato nunca saem). Tabelas: ${TABELAS.join(", ")}.`,
      inputSchema: {
        tabela: z.enum(TABELAS),
        filtros: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe('Ex.: {"corretor": "ELAINE", "etapa": "Visita"}'),
        limite: z.number().int().min(1).max(1000).default(200),
      },
      annotations: SO_LEITURA,
    },
    async (f) => {
      let linhas = (await tabela(f.tabela)).map(({ carregado_em, ...r }) => r);
      for (const [k, v] of Object.entries(f.filtros ?? {}))
        linhas = linhas.filter((r) => norm(r[k]) === norm(v));
      return resposta({
        tabela: f.tabela,
        total: linhas.length,
        linhas: linhas.slice(0, f.limite),
      });
    },
  );

  server.registerPrompt(
    "relatorio_corretores",
    {
      title: "Relatório de desempenho dos corretores",
      description: "Monta um relatório de desempenho da equipe com base na análise Hypnobox + LEN.",
      argsSchema: {
        periodo: z.string().optional().describe('Ex.: "01/09 a 14/10" (vazio = tudo)'),
      },
    },
    ({ periodo }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Monte um relatório de desempenho dos corretores${periodo ? ` no período ${periodo}` : ""} usando o MCP analise-leads: ` +
              "comece por visao_geral; use metricas_corretores (geral e com canal LEN), funil_campanhas por canal e dash_len (funil_produto e veiculo) para contexto. " +
              "Traga: ranking por conversão em visita, quem tem mais leads parados, tempo de resposta às mensagens, diferenças entre leads LEN, orgânicos e carteira, " +
              "e 3 a 5 ações práticas por gerente. Cite os números e o período; não invente dados que as ferramentas não trouxeram.",
          },
        },
      ],
    }),
  );
  return server;
}
