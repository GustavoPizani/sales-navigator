/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck -- código JS portado do extrator (testado contra o dash); os tipos ficam na fronteira, em lerTarefaLen
/**
 * Dash da LEN pela API pública da Keepi (só no servidor; sem navegador e sem login).
 * Mapa da API:
 *  - GET  https://api.keepi.com.br/shares/{share}: definição do dash (páginas,
 *    cartões com o modelo de consulta, filtros nomeados, conexões e contas de anúncio).
 *  - POST https://api.keepi.com.br/queries/msearch: recebe as consultas montadas e
 *    devolve as agregações (formato Elasticsearch).
 */
import * as R from "./regras";

const API = "https://api.keepi.com.br";
const SHARE = "688775e1cb24fa001e917002";

async function pedir(url: any, init: any, tentativas: any = 3) {
  let erro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(init && init.headers),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      erro = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error(`A API da LEN não respondeu (${url.split("?")[0]}): ${erro && erro.message}`);
}

/** Definição do dash e contexto para preencher os marcadores. */
async function carregarDash() {
  const share = await pedir(`${API}/shares/${SHARE}`);
  const d = share.dashboard;
  const ctx = { dashboardId: d._id, accountId: share.account || d.account };
  const NOMES = {
    GoogleAds: "GoogleAds",
    GoogleSheets: "GoogleSheets",
    FacebookAds: "FacebookAds",
    LinkedIn: "LinkedIn",
    MTNStudio: "MTNStudio",
  };
  // contas de anúncio (e a planilha) do cliente em cada conexão: o site limita as consultas a elas
  const contas = {};
  for (const c of d.connections || []) {
    if (!NOMES[c.source]) continue;
    ctx[`connectionId${NOMES[c.source]}`] = c.connection;
    contas[c.connection] = (c.adAccounts || []).map((a) => a.uid).filter(Boolean);
  }
  const regras = new Map((share.filters || []).map((f) => [f._id, f.rules || []]));
  return { share, paginas: d.pages || [], ctx, regras, contas };
}

/**
 * Índice "conexão-conta-fonte,..." sem as conexões que o dash não tem
 * (ex.: LinkedIn), mais a restrição às contas de anúncio de cada conexão.
 */
function limitarContas(cabecalho: any, corpo: any, contas: any) {
  const partes = String(cabecalho.index || "")
    .split(",")
    .filter((p) => p && !p.startsWith("-"));
  cabecalho.index = partes.join(",");
  const grupos = partes.map((p) => contas[p.split("-")[0]]).filter((uids) => uids && uids.length);
  if (!grupos.length) return;
  corpo.query = corpo.query || { bool: {} };
  const b = (corpo.query.bool = corpo.query.bool || {});
  b.should = [
    ...(b.should ? [].concat(b.should) : []),
    ...grupos.map((uids) => ({
      bool: { must: { terms: { "dimensions.ad_account.keyword": uids } } },
    })),
  ];
  b.minimum_should_match = 1;
}

const lista = (v: any) => (Array.isArray(v) ? v : [v]);

/**
 * Regra -> [onde, cláusula], como o site traduz:
 *  - should + lista: o campo está entre os valores
 *  - includes + condition "wildcard": contém o texto em qualquer um dos `fields`
 *  - includes sem condição: valor exato
 *  - must / must_not: valores exatos (ou excluídos)
 */
function clausula(r: any) {
  if (r.occur === "includes") {
    if (r.condition === "wildcard") {
      const campos = r.fields && r.fields.length ? r.fields : [r.field];
      return [
        "must",
        { bool: { should: campos.map((f) => ({ wildcard: { [f]: `*${r.value}*` } })) } },
      ];
    }
    return ["must", { bool: { should: [{ terms: { [r.field]: lista(r.value) } }] } }];
  }
  if (r.occur === "must_not") return ["must_not", { terms: { [r.field]: lista(r.value) } }];
  return ["filter", { terms: { [r.field]: lista(r.value) } }];
}

/** Aplica os filtros do cartão (ids de regras ou regras escritas nele) no corpo da consulta. */
function aplicarFiltros(corpo: any, filtros: any, regras: any) {
  const todas = [];
  for (const f of filtros || []) {
    if (typeof f === "string") todas.push(...(regras.get(f) || []));
    else if (f && f.field) todas.push(f);
  }
  if (!todas.length) return corpo;
  corpo.query = corpo.query || { bool: {} };
  const b = (corpo.query.bool = corpo.query.bool || {});
  for (const r of todas) {
    const [onde, c] = clausula(r);
    b[onde] = b[onde] ? [].concat(b[onde]) : [];
    b[onde].push(c);
  }
  return corpo;
}

/**
 * Junta as respostas de um cartão com várias consultas (ex.: meta da planilha +
 * investimento real por veículo), como o site faz: agrupamentos com a mesma
 * chave viram um só, com as métricas das duas consultas.
 */
function juntar(a: any, b: any) {
  if (a == null) return b;
  if (b == null || typeof a !== "object" || typeof b !== "object") return a;
  if (Array.isArray(a.buckets) && Array.isArray(b.buckets)) {
    const chave = (x: any) => JSON.stringify(x.key);
    // como no site: a primeira consulta define as linhas; as outras só as completam
    const extra = new Map(b.buckets.map((x) => [chave(x), x]));
    return { ...b, ...a, buckets: a.buckets.map((x) => juntar(x, extra.get(chave(x)))) };
  }
  const out = { ...b, ...a };
  for (const k of Object.keys(b)) if (k in a) out[k] = juntar(a[k], b[k]);
  return out;
}

/** Pares [cabeçalho, corpo] do cartão, com marcadores preenchidos e filtros aplicados. */
function paresDoCartao(cartao: any, dash: any, de: any, ate: any) {
  if (!Array.isArray(cartao.queries) || cartao.queries.length < 2) return [];
  const valores = { ...dash.ctx, startAt: de, endAt: ate, interval: "day" };
  const texto = JSON.stringify(cartao.queries).replace(/#!\{(\w+)\}/g, (m, k) =>
    valores[k] != null ? String(valores[k]) : "",
  );
  const q = JSON.parse(texto);
  const pares = [];
  for (let i = 0; i + 1 < q.length; i += 2) {
    const cab = q[i];
    const corpo = aplicarFiltros(q[i + 1], cartao.filters, dash.regras);
    // o índice do CRM é o próprio dash; os de mídia/planilha são "conexão-conta-fonte"
    if (cab.index !== dash.ctx.dashboardId) limitarContas(cab, corpo, dash.contas);
    pares.push([cab, corpo]);
  }
  return pares;
}

/** Segue o after_key das agregações composite até trazer todos os grupos. */
async function completarComposite([cab, corpo]: any, aggs: any, qs: any) {
  for (const [nome, ag] of Object.entries(corpo.aggs || {})) {
    if (!ag.composite || !aggs[nome]) continue;
    let after = aggs[nome].after_key;
    for (
      let volta = 0;
      after && aggs[nome].buckets.length >= ag.composite.size * (volta + 1) && volta < 50;
      volta++
    ) {
      const prox = JSON.parse(JSON.stringify(corpo));
      prox.aggs = { [nome]: { ...ag, composite: { ...ag.composite, after } } };
      const r = await pedir(`${API}/queries/msearch?${qs}`, {
        method: "POST",
        body: JSON.stringify([cab, prox]),
      });
      const parte =
        r.responses &&
        r.responses[0] &&
        r.responses[0].aggregations &&
        r.responses[0].aggregations[nome];
      if (!parte || !parte.buckets.length) break;
      aggs[nome].buckets.push(...parte.buckets);
      after = parte.after_key;
    }
  }
}

/**
 * Lê uma página do dash (1 = Números Gerais, 2 = Facebook, 3 = Google, 4 = Leads CRM,
 * 5 a 14 = empreendimentos) e devolve a lista de agregações, uma por consulta.
 */
async function lerPaginaApi(dash: any, numero: any, de: any, ate: any) {
  const pagina = dash.paginas[numero - 1];
  if (!pagina) throw new Error(`O dash não tem a página ${numero}.`);
  const cartoes = (pagina.data || [])
    .map((c) => paresDoCartao(c, dash, de, ate))
    .filter((p) => p.length);
  if (!cartoes.length) return [];
  const qs = new URLSearchParams({
    ...dash.ctx,
    connectionId: "",
    adAccountId: "",
    startAt: de,
    endAt: ate,
    interval: "day",
  });
  const corpo = cartoes.flat().flat();
  const res = await pedir(`${API}/queries/msearch?${qs}`, {
    method: "POST",
    body: JSON.stringify(corpo),
  });
  const respostas = res.responses || [];
  const falhas = respostas.filter((r) => !r || r.error || !r.aggregations);
  if (falhas.length) {
    const motivo = falhas
      .map((r) => (r && r.error && (r.error.reason || r.error.type)) || "sem dados")
      .slice(0, 2)
      .join("; ");
    throw new Error(
      `A API da LEN recusou ${falhas.length} de ${respostas.length} consultas da página ${numero} (${motivo}).`,
    );
  }
  // listas "composite" (anúncios) vêm de 100 em 100: busca as páginas seguintes
  const pares = cartoes.flat();
  for (let k = 0; k < pares.length; k++)
    await completarComposite(pares[k], respostas[k].aggregations, qs);
  // uma agregação por cartão, juntando as consultas do mesmo cartão
  let i = 0;
  return cartoes.map((ps) => ps.reduce((acc) => juntar(acc, respostas[i++].aggregations), null));
}

const PAGINAS_PRODUTO = {
  5: "312 Jam",
  6: "Nhambi Moema",
  7: "Tons Klabin",
  8: "Solaz Vila Mariana",
  9: "Jd Atenas",
  10: "Nato Itaim",
  11: "Ori",
  12: "Lina Jardins",
  13: "Harmonia (Res + Studios)",
};
// a página 14 (Harmonia Studios) devolve os mesmos números da 13: não é lida
const NOMES_VEICULO = { "Facebook Ads": "Meta Ads (Facebook/Instagram)" };

const num = (v: any) => (v == null ? 0 : typeof v === "number" ? v : (v.value ?? v.sum ?? 0));
const inteiro = (v: any) => Math.round(num(v));
const achar = (aggs: any, chave: any) => aggs.find((a) => a && a[chave]);
const buckets = (a: any, chave: any) => (a && a[chave] && a[chave].buckets) || [];

/** Janelas de marketing: período, o mesmo número de dias antes, 1º mês e 2º mês. */
function janelas(de: any, ate: any) {
  const dias = R.diasEntre(de, ate) + 1;
  const mes2 = `${de.slice(0, 7) === ate.slice(0, 7) ? ate.slice(0, 7) : nextMonth(de)}-01`;
  const fimMes1 = R.somaDias(mes2, -1);
  return [
    { janela: "periodo", de, ate },
    { janela: "anterior", de: R.somaDias(de, -dias), ate: R.somaDias(de, -1) },
    { janela: "setembro", de, ate: fimMes1 < ate ? fimMes1 : ate },
    { janela: "outubro", de: mes2 > ate ? ate : mes2, ate },
  ];
}
function nextMonth(iso: any) {
  const [y, m] = iso.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Soma os buckets diários por mês: { 'aaaa-mm': n }. */
function porMes(bucket: any) {
  const out = {};
  for (const d of buckets(bucket, "period")) {
    const mes = String(d.key_as_string).slice(0, 7);
    out[mes] = (out[mes] || 0) + (d.leads ? num(d.leads) : d.doc_count || 0);
  }
  return out;
}

// o número no início do status do dash não segue a ordem do funil: a ordem é fixa aqui
const ORDEM_STATUS = [
  [/tentando/i, 1],
  [/interesse/i, 2],
  [/em contato/i, 3],
  [/agendada/i, 4],
  [/realizada/i, 5],
  [/proposta/i, 6],
  [/descarte/i, 7],
];
const rotuloStatus = (key: any) => {
  if (/#N\/D/i.test(key)) return { etapa: "Sem status (#N/D)", ordem: 8 };
  const nome = R.limpa(String(key).replace(/^\d+_\s*/, ""));
  const o = ORDEM_STATUS.find(([rx]) => rx.test(nome));
  return { etapa: nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase(), ordem: o ? o[1] : 9 };
};
const NOMES_FONTE = {
  "search-len": "search-len (Google Pesquisa)",
  "display-len-md": "display-len-md (Google Display)",
};
const COLUNA_STATUS = [
  [/tentando/i, "tentando_contato"],
  [/interesse/i, "interesse_futuro"],
  [/em contato/i, "em_contato"],
  [/agendada/i, "visita_agendada"],
  [/realizada/i, "visita_realizada"],
  [/proposta/i, "proposta"],
  [/descarte/i, "descarte"],
];

/** Página "Leads CRM" (4): status, fontes, descarte e planejado x realizado por veículo. */
function lerLeadsCrm(aggs: any, m1: any, m2: any) {
  const status = achar(aggs, "status_len");
  const fontes = achar(aggs, "fonte_contato");
  const motivo = achar(aggs, "motivo_de_contato") || achar(aggs, "motivo_de_contato_short");
  const veic = achar(aggs, "nome_veiculo");
  const meses = (b: any) => {
    const p = porMes(b);
    return { setembro: p[m1] || 0, outubro: p[m2] || 0 };
  };
  return {
    al_status_geral: buckets(status, "status_len")
      .map((b) => ({ ...rotuloStatus(b.key), ...meses(b) }))
      .sort((a, b) => a.ordem - b.ordem),
    al_fontes: buckets(fontes, "fonte_contato").map((b) => ({
      fonte: NOMES_FONTE[R.limpa(b.key)] || R.limpa(b.key),
      ...meses(b),
    })),
    al_descarte: buckets(
      motivo,
      motivo && motivo.motivo_de_contato ? "motivo_de_contato" : "motivo_de_contato_short",
    ).map((b) => ({ motivo: R.limpa(String(b.key).replace(/\s*\/\s*/g, " / ")), ...meses(b) })),
    al_veiculo: buckets(veic, "nome_veiculo").map((b) => ({
      veiculo: NOMES_VEICULO[b.key] || b.key,
      investimento_previsto: inteiro(b.investimento_previsto),
      investimento_real: inteiro(b.investment),
      leads: inteiro(b.leads_sheets),
      meta_leads: inteiro(b.leads_estimados),
    })),
  };
}

/** Página de um empreendimento (5 a 13): uma linha de al_funil_produto. */
function lerProduto(aggs: any, produto: any, m1: any, m2: any) {
  const linha = {
    produto,
    leads: 0,
    leads_set: 0,
    leads_out: 0,
    investimento: 0,
    meta_leads: 0,
    tentando_contato: 0,
    em_contato: 0,
    interesse_futuro: 0,
    visita_agendada: 0,
    visita_realizada: 0,
    proposta: 0,
    descarte: 0,
    sem_status: 0,
    meta_ads_leads: 0,
    meta_ads_invest: 0,
    google_leads: 0,
    google_invest: 0,
    organico_leads: 0,
  };
  for (const b of buckets(achar(aggs, "status_len"), "status_len")) {
    const p = porMes(b);
    const n = (p[m1] || 0) + (p[m2] || 0);
    linha.leads_set += p[m1] || 0;
    linha.leads_out += p[m2] || 0;
    const col = COLUNA_STATUS.find(([rx]) => rx.test(b.key));
    linha[col ? col[1] : "sem_status"] += n;
  }
  linha.leads = linha.leads_set + linha.leads_out;
  const veic = achar(aggs, "nome_veiculo");
  if (veic) {
    linha.investimento = inteiro(veic.investment);
    linha.meta_leads = inteiro(veic.leads_estimados);
    for (const b of buckets(veic, "nome_veiculo")) {
      if (/facebook|meta/i.test(b.key)) {
        linha.meta_ads_leads = inteiro(b.leads_sheets);
        linha.meta_ads_invest = inteiro(b.investment);
      }
      if (/google/i.test(b.key)) {
        linha.google_leads = inteiro(b.leads_sheets);
        linha.google_invest = inteiro(b.investment);
      }
      if (/org[aâ]nic/i.test(b.key)) linha.organico_leads = inteiro(b.leads_sheets);
    }
  }
  return linha;
}

/** Páginas de mídia (2 = Meta, 3 = Google) numa janela. */
function lerMidia(aggs: any, janela: any, canalPagina: any) {
  const campanhas = buckets(achar(aggs, "campaign"), "campaign").map((b) => {
    const c = R.classificaCampanha(b.key, canalPagina);
    return {
      janela,
      campanha: R.limpa(b.key),
      canal: c.canal,
      produto: R.produtoMkt(b.key),
      objetivo: c.objetivo,
      investimento: inteiro(b.investment),
      cliques: inteiro(b.clicks),
      impressoes: inteiro(b.impressions),
      conversoes_plataforma: inteiro(b.conversions),
    };
  });
  const anuncios = new Map();
  for (const b of buckets(achar(aggs, "_network_adName"), "_network_adName")) {
    const nome = R.limpa((b.key && b.key.adname) || "");
    if (!nome) continue;
    const a = anuncios.get(nome) || {
      janela,
      anuncio: nome,
      produto: R.produtoMkt(nome),
      formato: R.formatoAnuncio(nome),
      investimento: 0,
      cliques: 0,
      impressoes: 0,
      leads_formulario: 0,
      leads_pixel: 0,
    };
    a.investimento += num(b.investment);
    a.cliques += num(b.clicks);
    a.impressoes += num(b.impressions);
    a.leads_formulario += num(b.leadsGeneration);
    a.leads_pixel += num(b.fbPixelLead);
    anuncios.set(nome, a);
  }
  const palavras = buckets(achar(aggs, "keywords"), "keywords").map((b) => ({
    palavra_chave: R.limpa(b.key),
    investimento: inteiro(b.investmentKeywords),
    cliques: inteiro(b.clicksKeywords),
    impressoes: inteiro(b.impressionsKeywords),
    conversoes: inteiro(b.conversionsKeywords),
  }));
  // diário: buckets por dia com investimento; leads de formulário Meta vêm em outro bloco
  const diarios = aggs.filter(
    (a) => a && a.period && a.period.buckets && a.period.buckets.some((d) => d.investment),
  );
  const geral =
    diarios.find(
      (a) =>
        !a.period.buckets.some((d) => d.leadsGeneration || d.leadsGeneration_metrics_fbperformance),
    ) || diarios[0];
  const comLeads = diarios.find((a) =>
    a.period.buckets.some((d) => d.leadsGeneration || d.leadsGeneration_metrics_fbperformance),
  );
  const leadsDia = new Map();
  if (comLeads)
    for (const d of comLeads.period.buckets)
      leadsDia.set(
        String(d.key_as_string).slice(0, 10),
        inteiro(d.leadsGeneration_metrics_fbperformance || d.leadsGeneration),
      );
  const diario = geral
    ? geral.period.buckets.map((d) => {
        const data = String(d.key_as_string).slice(0, 10);
        return {
          data,
          canal: canalPagina === "Meta Ads" ? "Meta Ads" : "Google Ads",
          investimento: inteiro(d.investment),
          cliques: inteiro(d.clicks),
          impressoes: inteiro(d.impressions),
          leads_formulario_meta: canalPagina === "Meta Ads" ? leadsDia.get(data) || 0 : null,
        };
      })
    : [];
  return {
    campanhas,
    anuncios: [...anuncios.values()].map((a) => ({
      ...a,
      investimento: Math.round(a.investimento),
      cliques: Math.round(a.cliques),
      impressoes: Math.round(a.impressoes),
      leads_formulario: Math.round(a.leads_formulario),
      leads_pixel: Math.round(a.leads_pixel),
    })),
    palavras,
    diario,
    investimento: inteiro(achar(aggs, "campaign") && achar(aggs, "campaign").investment),
  };
}

// ---------------- tarefas (uma chamada de servidor por página) ----------------

/** Páginas lidas, na ordem: Leads CRM (4), empreendimentos (5 a 13) e Meta/Google (2 e 3) em 4 janelas. */
export function tarefasLen(de, ate) {
  const J = janelas(de, ate);
  return [
    { pag: 4 },
    ...Object.keys(PAGINAS_PRODUTO).map((p) => ({ pag: Number(p) })),
    ...J.flatMap((j) => [
      { pag: 2, j },
      { pag: 3, j },
    ]),
  ];
}

const nomeTarefa = (t) =>
  t.j
    ? `página ${t.pag} (${t.pag === 2 ? "Meta" : "Google"}, ${t.j.janela})`
    : `página ${t.pag}${PAGINAS_PRODUTO[t.pag] ? ` (${PAGINAS_PRODUTO[t.pag]})` : " (Leads CRM)"}`;

let cacheDash = null; // a definição do dash muda raramente: guarda por 10 min
async function dashAtual() {
  if (!cacheDash || Date.now() - cacheDash.em > 10 * 60000)
    cacheDash = { em: Date.now(), dash: await carregarDash() };
  return cacheDash.dash;
}

/** Lê a tarefa `indice` e devolve as linhas das tabelas al_* que ela produz. */
export async function lerTarefaLen(indice, de, ate) {
  const tarefas = tarefasLen(de, ate);
  const t = tarefas[indice];
  if (!t) throw new Error("Tarefa da LEN inexistente.");
  const m1 = de.slice(0, 7);
  const m2 = nextMonth(de);
  const nome = nomeTarefa(t);
  const aggs = await lerPaginaApi(await dashAtual(), t.pag, t.j ? t.j.de : de, t.j ? t.j.ate : ate);
  if (!aggs.length) throw new Error(`O dash da LEN não devolveu dados na ${nome}.`);
  const tabelas = {};
  let investimentoPeriodo = 0;
  if (t.pag === 4) Object.assign(tabelas, lerLeadsCrm(aggs, m1, m2));
  else if (PAGINAS_PRODUTO[t.pag])
    tabelas.al_funil_produto = [lerProduto(aggs, PAGINAS_PRODUTO[t.pag], m1, m2)];
  else {
    const r = lerMidia(aggs, t.j.janela, t.pag === 2 ? "Meta Ads" : "Google Ads");
    tabelas.al_mkt_campanhas = r.campanhas;
    if (t.pag === 2) tabelas.al_mkt_anuncios = r.anuncios;
    if (t.j.janela === "periodo") {
      tabelas.al_mkt_diario = r.diario;
      investimentoPeriodo = r.investimento;
      if (t.pag === 3)
        tabelas.al_mkt_palavras = r.palavras
          .sort((a, b) => b.investimento - a.investimento)
          .slice(0, 80);
    }
  }
  return { nome, total: tarefas.length, tabelas, investimentoPeriodo, janelas: janelas(de, ate) };
}
