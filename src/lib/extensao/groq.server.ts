import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Chave do Groq de cada corretor (plano grátis do Groq) e chamadas à IA.
// A chave chega do navegador uma vez, é testada, cifrada com AES-256-GCM
// (segredo EXT_CHAVES_SEGREDO, 32 bytes em base64, só no servidor) e nunca volta.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = supabaseAdmin as unknown as SupabaseClient<any>;

export const MODELOS = {
  sugestao: "openai/gpt-oss-20b",
  retrato: "openai/gpt-oss-120b",
  transcricao: "whisper-large-v3-turbo",
} as const;

const GROQ = "https://api.groq.com/openai/v1";

function segredo(): Buffer {
  const s = process.env.EXT_CHAVES_SEGREDO;
  const b = s ? Buffer.from(s, "base64") : null;
  if (!b || b.length !== 32) throw new Error("EXT_CHAVES_SEGREDO não configurado no servidor (32 bytes em base64).");
  return b;
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", segredo(), iv);
  const ct = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(":");
}

export function decifrar(guardado: string): string {
  const [iv, tag, ct] = guardado.split(":").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", segredo(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

export type Falha = { ok: false; status: number; mensagem: string; esperarSeg: number };

async function falha(res: Response): Promise<Falha> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const corpo: any = await res.json().catch(() => null);
  const espera = Number(res.headers.get("retry-after")) || 0;
  const mensagem =
    res.status === 401
      ? "A chave do Groq não foi aceita. Confira em Minha chave de IA."
      : res.status === 429
        ? `Limite grátis do Groq atingido${espera ? `: tente de novo em ${espera} s` : " por hoje"}.`
        : corpo?.error?.message || `Groq indisponível (${res.status})`;
  return { ok: false, status: res.status, mensagem, esperarSeg: espera };
}

/** Testa uma chave com o pedido mais barato possível (lista de modelos). */
export async function testarChave(chave: string): Promise<{ ok: true } | Falha> {
  const res = await fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${chave}` } });
  return res.ok ? { ok: true } : falha(res);
}

/** Chave do usuário, decifrada (só no servidor). */
export async function chaveDo(userId: string): Promise<string | null> {
  const { data } = await admin
    .from("ia_chaves_usuario")
    .select("chave_cifrada")
    .eq("user_id", userId)
    .eq("provedor", "groq")
    .maybeSingle();
  return data ? decifrar(data.chave_cifrada) : null;
}

async function registrarUso(
  userId: string,
  tipo: string,
  modelo: string,
  r: { tokens?: number; segundos?: number; recusado?: boolean; statusChave?: "ok" | "invalida" | "limite" },
) {
  await admin.rpc("ia_uso_somar", {
    _user_id: userId,
    _tipo: tipo,
    _modelo: modelo,
    _tokens: r.tokens ?? 0,
    _segundos: r.segundos ?? 0,
    _recusado: r.recusado ?? false,
  });
  await admin
    .from("ia_chaves_usuario")
    .update({ ultimo_uso_em: new Date().toISOString(), ...(r.statusChave ? { status: r.statusChave } : {}) })
    .eq("user_id", userId)
    .eq("provedor", "groq");
}

/** Pedido de texto ao Groq com a chave do usuário, devolvendo JSON. Uma tentativa só: a fila fica na extensão. */
export async function pedirJson(
  userId: string,
  tipo: "sugestao" | "retrato" | "perfil" | "modelo",
  sistema: string,
  usuario: string,
  maxTokens = 1200,
): Promise<{ ok: true; json: unknown } | Falha> {
  const chave = await chaveDo(userId);
  if (!chave) return { ok: false, status: 412, mensagem: "Cadastre sua chave do Groq em Minha chave de IA.", esperarSeg: 0 };
  const modelo = tipo === "sugestao" ? MODELOS.sugestao : MODELOS.retrato;
  const res = await fetch(`${GROQ}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelo,
      messages: [
        { role: "system", content: sistema },
        { role: "user", content: usuario },
      ],
      temperature: 0.6,
      max_tokens: maxTokens,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const f = await falha(res);
    await registrarUso(userId, tipo, modelo, {
      recusado: true,
      statusChave: res.status === 401 ? "invalida" : res.status === 429 ? "limite" : undefined,
    });
    return f;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  await registrarUso(userId, tipo, modelo, { tokens: data?.usage?.total_tokens ?? 0, statusChave: "ok" });
  try {
    return { ok: true, json: JSON.parse(data?.choices?.[0]?.message?.content ?? "{}") };
  } catch {
    return { ok: false, status: 502, mensagem: "A IA devolveu uma resposta fora do formato. Tente de novo.", esperarSeg: 0 };
  }
}

/** Transcrição de um áudio com o Whisper do Groq, em português. */
export async function transcrever(
  userId: string,
  audio: Blob,
  nomeArquivo: string,
  segundos: number,
): Promise<{ ok: true; texto: string } | Falha> {
  const chave = await chaveDo(userId);
  if (!chave) return { ok: false, status: 412, mensagem: "Cadastre sua chave do Groq em Minha chave de IA.", esperarSeg: 0 };
  const form = new FormData();
  form.append("file", audio, nomeArquivo);
  form.append("model", MODELOS.transcricao);
  form.append("language", "pt");
  form.append("response_format", "json");
  form.append("temperature", "0");
  const res = await fetch(`${GROQ}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}` },
    body: form,
  });
  if (!res.ok) {
    const f = await falha(res);
    await registrarUso(userId, "transcricao", MODELOS.transcricao, {
      recusado: true,
      statusChave: res.status === 401 ? "invalida" : res.status === 429 ? "limite" : undefined,
    });
    return f;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  await registrarUso(userId, "transcricao", MODELOS.transcricao, { segundos, statusChave: "ok" });
  return { ok: true, texto: String(data?.text ?? "").trim() };
}
