/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regras de negócio da coleta (Hypnobox + dash da LEN): normalização de
 * contato e datas, etapa, canal/campanha pela mídia, objetivo e formato de anúncios.
 */

const MESES_EN: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export const limpa = (s: any) =>
  String(s == null ? "" : s)
    .replace(/\s+/g, " ")
    .trim();
/** "---" (campo vazio no Hypnobox) vira vazio. */
export const semTraco = (s: any) => (/^-+$/.test(limpa(s)) ? "" : limpa(s));

/** Telefone só com dígitos e DDI 55 quando faltar (5511999999999). */
export function normalizaTelefone(raw: any) {
  let d = String(raw || "")
    .replace(/\D/g, "")
    .replace(/^0+/, "");
  if (!d) return "";
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d;
}
export const normalizaEmail = (s: any) => limpa(s).toLowerCase().replace(/\s+/g, "");

/** "dd/mm/aaaa" (com ou sem " às hh:mm") -> "aaaa-mm-dd". */
export function dataBR(s: any) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
/** "05/Sep/2026" -> "2026-09-05". */
export function dataEN(s: any) {
  const m = /(\d{1,2})\/([A-Za-z]{3})\/(\d{4})/.exec(String(s || ""));
  if (!m) return dataBR(s);
  const mes = MESES_EN[m[2].toLowerCase()];
  return mes ? `${m[3]}-${String(mes).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}
export function hora(s: any) {
  const m = /(\d{1,2}):(\d{2})/.exec(String(s || ""));
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

export const diasEntre = (a: any, b: any) =>
  a && b ? Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5) : null;
export const hojeISO = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
export const isoParaBR = (iso: any) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const somaDias = (iso: any, n: any) =>
  new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

/** Etapa derivada do momento/submomento (aplicada nesta ordem). */
export function etapa(momento: any, submomento: any) {
  const m = limpa(momento);
  const s = limpa(submomento);
  if (/^fez proposta$/i.test(s)) return "Proposta";
  if (/^visita$/i.test(m)) return "Visita";
  if (/^não interessado$/i.test(m)) return "Não interessado";
  if (/^tentando contato$/i.test(s)) return "Tentando contato";
  if (!s || s === "(vazio)") return "Sem submomento";
  return "Em tratativa";
}

// ---------------- mídia -> canal, campanha e palavra-chave ----------------
const SUBTIPOS: Record<string, string> = {
  local: "Local",
  tipologia: "Tipologia",
  produto: "Produto",
  generica: "Genérica",
  genérica: "Genérica",
  microregiao: "Microregião",
  microregião: "Microregião",
};
const PRODUTOS: [RegExp, string][] = [
  [/312\s*jam/i, "312 Jam"],
  [/nhambi/i, "Nhambi"],
  [/tons/i, "Tons Klabin"],
  [/solaz/i, "Solaz"],
  [/atenas/i, "Jardim Atenas"],
  [/nato/i, "Nato Itaim"],
  [/\bori\b/i, "Ori"],
  [/lina/i, "Lina Jardins"],
  [/harmonia.*stud/i, "Harmonia Studio"],
  [/harmonia/i, "Harmonia Residencial"],
  [/ecos/i, "Ecos"],
  [/ad\s*330/i, "AD 330"],
  [/biofast/i, "Biofast"],
  [/join/i, "Join"],
];
/** "312JamResidencial", "NhambiMoema" -> nome curto do empreendimento. */
function produtoCurto(s: any) {
  const t = String(s || "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2");
  const k = PRODUTOS.find(([rx]) => rx.test(t));
  return k ? k[1] : limpa(t);
}

/** Mídia do Google, nos dois formatos: "google-ads > search-len > local-X > palavra > LP" e "google-ads-search-len-local-X-palavra". */
function parseGoogle(midia: any) {
  const m = limpa(midia);
  const tipo = /demand-?gen/i.test(m)
    ? "Demand Gen"
    : /display/i.test(m)
      ? "Display"
      : /search/i.test(m)
        ? "Pesquisa"
        : null;
  if (!tipo) return null;
  let subtipo = "";
  let produto = "";
  let palavra = "";
  if (m.includes(">")) {
    const seg = m
      .split(">")
      .map((x) => x.trim())
      .slice(2);
    const sp = (seg[0] || "").split("-");
    if (SUBTIPOS[(sp[0] || "").toLowerCase()]) {
      subtipo = SUBTIPOS[sp[0].toLowerCase()];
      produto = sp.slice(1).join("-");
    } else produto = seg[0] || "";
    palavra = seg[1] || "";
  } else {
    const rest = m
      .replace(/^google-ads-?/i, "")
      .replace(/^(search|display|demand-gen)-len(-md|-demand-gen)?-?/i, "");
    const sp = rest.split("-");
    if (SUBTIPOS[(sp[0] || "").toLowerCase()]) {
      subtipo = SUBTIPOS[sp[0].toLowerCase()];
      produto = sp[1] || "";
      palavra = sp.slice(2).join(" ");
    } else {
      produto = sp[0] || "";
      palavra = sp.slice(1).join(" ");
    }
  }
  const campanha = ["Google " + tipo, subtipo, produtoCurto(produto)].filter(Boolean).join(" · ");
  return {
    canal: "Google " + tipo,
    campanha,
    palavra_chave: limpa(palavra.replace(/[-_]+/g, " ")) || null,
  };
}

/** Canal e campanha a partir do nome da mídia de origem. */
export function campanhaDaMidia(midia: any) {
  const m = limpa(midia);
  if (/google|(search|display|demand-gen)-len/i.test(m)) {
    const g = parseGoogle(m);
    if (g) return g;
  }
  const regras: [RegExp, string, string][] = [
    [/^facebook ads/i, "Meta Ads", "Meta"],
    [/^(meta|instagram)/i, "Meta Ads", "Meta"],
    [/tiktok/i, "TikTok Ads", "TikTok"],
    [/linkedin/i, "LinkedIn Ads", "LinkedIn"],
  ];
  const r = regras.find(([rx]) => rx.test(m));
  if (!r) return { canal: "Outros", campanha: m, palavra_chave: null };
  const nome = m.replace(
    /^(facebook ads|meta ads|instagram ads|tiktok ads|tiktok|linkedin ads|linkedin)\s*[-–:]\s*/i,
    "",
  );
  return { canal: r[1], campanha: `${r[2]} · ${nome}`, palavra_chave: null };
}

/** Grupo de origem do cliente da visita. */
export function grupoOrigem(midia: any) {
  const m = limpa(midia);
  if (!m) return "Sem origem";
  if (/len/i.test(m)) return "Campanha LEN";
  if (/facebook leads|meta leads/i.test(m)) return "Meta (antes da LEN)";
  if (/acesso direto|whats|m[ií]dia padr|org[aâ]nic/i.test(m)) return "Acesso direto / orgânico";
  if (/indica|an[uú]ncio corretor/i.test(m)) return "Indicação / carteira";
  if (/passagem/i.test(m)) return "Passagem no plantão";
  return "Sem origem";
}

// ---------------- dash da LEN: campanhas e anúncios ----------------
export function produtoMkt(nome: any) {
  const k = PRODUTOS.find(([rx]) => rx.test(nome));
  if (k) return k[1];
  return (
    limpa(
      String(nome)
        .replace(/^(\([^)]*\)\s*)+/, "")
        .split(/[[_]/)[0],
    ) || null
  );
}
const OBJ_META: Record<string, string> = {
  A: "Alcance",
  E: "Engajamento",
  L: "Lead (formulário)",
  "L/C": "Lead + conversão",
  LC: "Lead + conversão",
  "L+C": "Lead + conversão",
  T: "Tráfego",
  C: "Conversão",
};
const TIPO_PESQ = ["Tipologia", "Local", "Produto", "Genérica", "Microregião"];
/** (GAD) (P)/(MD)/(DG) para Google; (FB) (A/E/L/L/C/T) para Meta. */
export function classificaCampanha(nome: any, canalPagina: any) {
  const n = limpa(nome);
  const g = /^\(GAD\)\s*\((P|MD|DG)\)/i.exec(n);
  if (g) {
    const t = g[1].toUpperCase();
    if (t === "MD") return { canal: "Google Display", objetivo: "Display" };
    if (t === "DG") return { canal: "Google Demand Gen", objetivo: "Demand Gen" };
    const b = TIPO_PESQ.find((x) => n.toLowerCase().includes("[" + x.toLowerCase()));
    return { canal: "Google Pesquisa", objetivo: b || "Pesquisa" };
  }
  const f = /^\(FB\)\s*\(([^)]+)\)/i.exec(n) || /^\(([A-Z/+]{1,3})\)/.exec(n);
  return {
    canal: canalPagina || "Meta Ads",
    objetivo: f ? OBJ_META[f[1].toUpperCase()] || f[1] : "",
  };
}
export function formatoAnuncio(nome: any) {
  if (/\(CA\)/i.test(nome)) return "Carrossel";
  if (/\(MO\)/i.test(nome)) return "Motion";
  if (/\((VI|IV)\)/i.test(nome)) return "Vídeo";
  if (/\(IM\)/i.test(nome)) return "Imagem";
  return "";
}
