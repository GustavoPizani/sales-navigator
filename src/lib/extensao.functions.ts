import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cifrar, testarChave } from "@/lib/extensao/groq.server";
import { concluirPasso } from "@/lib/extensao/dados.server";
import { VERSAO_EXTENSAO } from "@/lib/extensao/api.server";

// Telas do sistema da extensão do WhatsApp: chave do Groq do usuário e a guia
// de primeiros passos. A chave só passa por aqui uma vez (para testar e cifrar).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = supabaseAdmin as unknown as SupabaseClient<any>;

/** Testa a chave no Groq e guarda cifrada. A chave nunca volta para o navegador. */
export const salvarChaveIa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ chave: z.string().trim().regex(/^gsk_[A-Za-z0-9]{20,}$/, "A chave do Groq começa com gsk_ e não tem espaços.") })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const teste = await testarChave(data.chave);
    if (!teste.ok) return { ok: false as const, mensagem: teste.mensagem };
    const { error } = await admin.from("ia_chaves_usuario").upsert(
      {
        user_id: context.userId,
        provedor: "groq",
        chave_cifrada: cifrar(data.chave),
        final4: data.chave.slice(-4),
        status: "ok",
        testada_em: new Date().toISOString(),
      },
      { onConflict: "user_id,provedor" },
    );
    if (error) throw new Error(error.message);
    await concluirPasso(context.userId, "chave");
    return { ok: true as const, final4: data.chave.slice(-4) };
  });

export const removerChaveIa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await admin.from("ia_chaves_usuario").delete().eq("user_id", context.userId);
    await admin.from("ext_guia_progresso").delete().eq("user_id", context.userId).eq("passo", "chave");
    return { ok: true };
  });

export type EstadoExtensao = {
  versaoPublicada: string;
  instalacao: { versao: string; ultimo_acesso_em: string } | null;
  chave: { final4: string; status: string; testada_em: string | null; ultimo_uso_em: string | null } | null;
  passos: Record<string, string>;
};

/** Situação do usuário na guia: passos concluídos, extensão instalada e chave. */
export const estadoExtensao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EstadoExtensao> => {
    const [inst, chave, passos] = await Promise.all([
      admin.from("ext_instalacoes").select("versao, ultimo_acesso_em").eq("user_id", context.userId).maybeSingle(),
      admin
        .from("ia_chaves_usuario")
        .select("final4, status, testada_em, ultimo_uso_em")
        .eq("user_id", context.userId)
        .maybeSingle(),
      admin.from("ext_guia_progresso").select("passo, concluido_em").eq("user_id", context.userId),
    ]);
    return {
      versaoPublicada: VERSAO_EXTENSAO,
      instalacao: inst.data ?? null,
      chave: chave.data ?? null,
      passos: Object.fromEntries((passos.data ?? []).map((p) => [p.passo, p.concluido_em])),
    };
  });
