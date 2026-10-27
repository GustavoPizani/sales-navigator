// Formato compacto v1 das conversas da extensão (HANDOFF.md 9.3).
// Uma mensagem por linha; o bloco inteiro vai comprimido (gzip) para o banco.
// Roda no navegador, na extensão e no servidor (CompressionStream existe nos três).
//
//   v1|<início do bloco em segundos, base 36>
//   <segundos desde a anterior, base 36><lado><tipo?><segundos de áudio?>#<id> <texto>
//
// lado: ">" corretor, "<" cliente. tipo: a áudio (texto = transcrição), i imagem,
// v vídeo, d documento (texto = legenda ou nome). id: fim do id da mensagem no
// WhatsApp, para não gravar a mesma duas vezes e achar o áudio na transcrição.

export type Lado = ">" | "<";
export type TipoMsg = "a" | "i" | "v" | "d";

export type MensagemCompacta = {
  id: string;
  /** segundos desde 1970 */
  ts: number;
  lado: Lado;
  tipo?: TipoMsg;
  /** duração do áudio, em segundos */
  seg?: number;
  texto: string;
};

/** Quantas mensagens de cada conversa ficam guardadas: só o que serve de contexto para a IA (decisão de 27/10). */
export const JANELA_MENSAGENS = 80;

const TAM_ID = 8;
export const idCurto = (id: string) => id.replace(/[^0-9A-Za-z]/g, "").slice(-TAM_ID);

const escapar = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n");
const desescapar = (s: string) => s.replace(/\\(\\|n)/g, (_, c: string) => (c === "n" ? "\n" : "\\"));

export function codificar(msgs: MensagemCompacta[]): string {
  const ordenadas = [...msgs].sort((a, b) => a.ts - b.ts);
  const t0 = ordenadas[0]?.ts ?? 0;
  let antes = t0;
  const linhas = [`v1|${t0.toString(36)}`];
  for (const m of ordenadas) {
    const tipo = m.tipo ? m.tipo + (m.tipo === "a" && m.seg ? String(Math.round(m.seg)) : "") : "";
    linhas.push(`${Math.max(0, m.ts - antes).toString(36)}${m.lado}${tipo}#${idCurto(m.id)} ${escapar(m.texto)}`);
    antes = m.ts;
  }
  return linhas.join("\n");
}

const LINHA = /^([0-9a-z]+)([<>])([aivd])?(\d+)?#([0-9A-Za-z]*) (.*)$/;

export function decodificar(texto: string): MensagemCompacta[] {
  const [cab, ...linhas] = texto.split("\n");
  const m0 = /^v1\|([0-9a-z]+)$/.exec(cab ?? "");
  if (!m0) throw new Error("Bloco de conversa em formato desconhecido");
  let ts = parseInt(m0[1], 36);
  const out: MensagemCompacta[] = [];
  for (const l of linhas) {
    const m = LINHA.exec(l);
    if (!m) continue;
    ts += parseInt(m[1], 36);
    out.push({
      id: m[5],
      ts,
      lado: m[2] as Lado,
      ...(m[3] ? { tipo: m[3] as TipoMsg } : {}),
      ...(m[4] ? { seg: Number(m[4]) } : {}),
      texto: desescapar(m[6]),
    });
  }
  return out;
}

/** "aaaa-mm" no fuso de São Paulo. */
export function mesDe(ts: number): string {
  const d = new Date((ts - 3 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Cliente que só respondeu "ok", "obrigado", 👍... */
export const soConfirmacao = (texto: string) =>
  /^\s*(?:(?:ok+|okay|blz|beleza|obrigad[oa]s?|obg|valeu|vlw|certo|show|top|perfeito|entendi|combinado|sim|👍|🙏|👌)[\s!.,]*)+$/iu.test(
    texto,
  );

// ── gzip e bytea ────────────────────────────────────────────────────────────

async function passar(dados: Uint8Array, fluxo: CompressionStream | DecompressionStream) {
  const saida = new Blob([dados as BlobPart]).stream().pipeThrough(fluxo);
  return new Uint8Array(await new Response(saida).arrayBuffer());
}
export const comprimir = (texto: string) => passar(new TextEncoder().encode(texto), new CompressionStream("gzip"));
export const descomprimir = async (dados: Uint8Array) =>
  new TextDecoder().decode(await passar(dados, new DecompressionStream("gzip")));

/** bytea do Postgres pela API do Supabase: texto "\x0a1b...". */
export const paraBytea = (b: Uint8Array) =>
  "\\x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export function deBytea(v: string): Uint8Array {
  const hex = v.startsWith("\\x") ? v.slice(2) : v;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Lê os blocos de uma conversa (como vêm do banco) e devolve as mensagens em ordem. */
export async function lerBlocos(blocos: { dados: string }[]): Promise<MensagemCompacta[]> {
  const todas: MensagemCompacta[] = [];
  for (const b of blocos) todas.push(...decodificar(await descomprimir(deBytea(b.dados))));
  return todas.sort((a, b) => a.ts - b.ts);
}
