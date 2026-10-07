import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// As chaves de IA ficam só no servidor (GROQ_API_KEY e GEMINI_API_KEY, sem o
// prefixo VITE_): nada delas vai para o JavaScript do navegador.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b";
const GEMINI_MODEL = "gemini-3.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export type AiJsonResult =
  | { ok: true; text: string; /** resposta cortada por tamanho */ truncated: boolean }
  | { ok: false; status: number; message: string; /** segundos sugeridos antes de tentar de novo */ retryAfter: number };

const inputSchema = z.object({
  system: z.string().min(1).max(50_000),
  user: z.string().min(1).max(2_000_000),
});

async function failure(provider: string, res: Response): Promise<AiJsonResult & { ok: false }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = await res.json().catch(() => null);
  const msg = body?.error?.message;
  return {
    ok: false,
    status: res.status,
    message: msg ? `${provider}: ${msg}` : `${provider} indisponível`,
    retryAfter: Number(res.headers.get("retry-after")) || 0,
  };
}

async function askGroq(apiKey: string, system: string, user: string): Promise<AiJsonResult> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
      max_tokens: 32768,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return failure("Groq", res);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  const choice = data?.choices?.[0];
  return {
    ok: true,
    text: choice?.message?.content ?? "{}",
    truncated: choice?.finish_reason === "length",
  };
}

async function askGemini(apiKey: string, system: string, user: string): Promise<AiJsonResult> {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        maxOutputTokens: 32768,
      },
    }),
  });
  if (!res.ok) return failure("Gemini", res);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  const candidate = data?.candidates?.[0];
  return {
    ok: true,
    text: candidate?.content?.parts?.[0]?.text ?? "{}",
    truncated: candidate?.finishReason === "MAX_TOKENS",
  };
}

/**
 * Leitura de texto com IA devolvendo JSON (tabelões e documentos de imóveis).
 * Groq primeiro; se falhar (limite, arquivo grande, fora do ar) e houver chave
 * do Gemini, usa o Gemini. Faz uma tentativa por provedor: quem chama decide se
 * repete, para a chamada não estourar o tempo da função no servidor.
 * Só o admin usa (é quem cadastra imóveis).
 */
export const aiExtractJson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<AiJsonResult> => {
    const { data: caller } = await context.supabase
      .from("profiles")
      .select("role, is_active")
      .eq("id", context.userId)
      .single();
    if (!caller?.is_active || (caller.role !== "admin" && caller.role !== "director"))
      throw new Error("Só o administrador pode usar a leitura com IA.");

    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!groqKey && !geminiKey)
      throw new Error("Nenhuma IA configurada no servidor (GROQ_API_KEY ou GEMINI_API_KEY).");

    let last: AiJsonResult | null = null;
    if (groqKey) {
      last = await askGroq(groqKey, data.system, data.user);
      if (last.ok) return last;
    }
    if (geminiKey) last = await askGemini(geminiKey, data.system, data.user);
    return last!;
  });
