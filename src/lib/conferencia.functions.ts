import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { secondaryAdmin } from "@/integrations/supabase/secondary.server";

// Conferência da agenda pelo corretor: página sem login aberta por um link único
// (corretor + período) gerado pelo ADM no 1:1. O token é a única credencial:
// tudo passa pelo servidor, que só mostra e só grava as visitas daquele link.

export type VisitaConferencia = {
  chave: string;
  data: string;
  hora: string;
  id_cliente: string;
  produto: string;
  /** situação no Hypnobox: Agendada, Realizada, ... */
  status: string;
  /** quantos agendamentos o Hypnobox tem para esse cliente nesse dia */
  registros: number;
  aconteceu: boolean | null;
  observacao: string;
};

/** Visita que o corretor informou e não estava na agenda do Hypnobox. */
export type VisitaInformada = { id: string; id_cliente: string; produto: string; data: string; observacao: string };

export type Conferencia = {
  nome: string;
  de: string;
  ate: string;
  visitas: VisitaConferencia[];
  informadas: VisitaInformada[];
  /** produtos das visitas do último ano, para a lista do formulário */
  produtos: string[];
};

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
const chaveDe = (v: { id_cliente: string; corretor: string; data: string }) => `${v.id_cliente}|${v.corretor}|${v.data}`;

type Link = { token: string; corretor: string; nome: string | null; de: string; ate: string; expira_em: string };

async function linkValido(token: string): Promise<Link> {
  const { data, error } = await secondaryAdmin
    .from("al_conferencia_links")
    .select("token, corretor, nome, de, ate, expira_em")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error("Não foi possível abrir agora. Tente de novo em instantes.");
  if (!data || new Date(data.expira_em as string) < new Date())
    throw new Error("Este link expirou ou não existe mais. Peça um novo ao seu gestor.");
  return data as Link;
}

/** Visitas do corretor no período, uma por cliente por dia (vale o registro realizado, se houver). */
async function visitasDoLink(link: Link) {
  const { data, error } = await secondaryAdmin
    .from("al_visitas")
    .select("visita_id, id_cliente, data, hora, status, corretor, produto")
    .eq("corretor", link.corretor)
    .gte("data", link.de)
    .lte("data", link.ate)
    .order("data")
    .order("hora");
  if (error) throw new Error("Não foi possível carregar as visitas.");
  const grupos = new Map<string, Record<string, string>[]>();
  for (const v of (data ?? []) as Record<string, string>[]) {
    if (!v.id_cliente) continue;
    const k = chaveDe(v as never);
    grupos.set(k, [...(grupos.get(k) ?? []), v]);
  }
  return [...grupos.entries()].map(([chave, g]) => {
    const v = g.find((x) => x.status === "Realizada") ?? g[0];
    return { chave, data: v.data, hora: (v.hora ?? "").slice(0, 5), id_cliente: v.id_cliente, produto: v.produto ?? "", status: v.status ?? "", registros: g.length };
  });
}

async function informadasDoLink(link: Link): Promise<VisitaInformada[]> {
  const { data, error } = await secondaryAdmin
    .from("al_visitas_informadas")
    .select("id, id_cliente, produto, data, observacao")
    .eq("corretor", link.corretor)
    .gte("data", link.de)
    .lte("data", link.ate)
    .order("data");
  // sem a tabela (migration ainda não rodada) a página abre do mesmo jeito
  if (error) return [];
  return (data ?? []).map((r) => ({ ...(r as VisitaInformada), observacao: (r.observacao as string) ?? "" }));
}

async function produtosRecentes(): Promise<string[]> {
  const desde = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const { data } = await secondaryAdmin.from("al_visitas").select("produto").gte("data", desde).limit(5000);
  return [...new Set((data ?? []).map((r) => (r.produto as string)?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export const abrirConferencia = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: tokenSchema }).parse(d))
  .handler(async ({ data }): Promise<Conferencia> => {
    const link = await linkValido(data.token);
    const visitas = await visitasDoLink(link);
    const { data: resp } = await secondaryAdmin
      .from("al_visitas_confirmadas")
      .select("chave, aconteceu, observacao")
      .in("chave", visitas.length ? visitas.map((v) => v.chave) : ["-"]);
    const porChave = new Map((resp ?? []).map((r) => [r.chave as string, r]));
    const [informadas, produtos] = await Promise.all([informadasDoLink(link), produtosRecentes()]);
    await secondaryAdmin
      .from("al_conferencia_links")
      .update({ aberto_em: new Date().toISOString() })
      .eq("token", link.token)
      .is("aberto_em", null);
    return {
      nome: link.nome || link.corretor,
      de: link.de,
      ate: link.ate,
      visitas: visitas.map((v) => {
        const r = porChave.get(v.chave);
        return { ...v, aconteceu: r ? (r.aconteceu as boolean) : null, observacao: (r?.observacao as string) ?? "" };
      }),
      informadas,
      produtos,
    };
  });

export const responderVisita = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: tokenSchema,
        chave: z.string().max(200),
        // null apaga a resposta
        aconteceu: z.boolean().nullable(),
        observacao: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const link = await linkValido(data.token);
    // só as visitas deste link: corretor e período do link
    const [id_cliente, corretor, dia] = data.chave.split("|");
    if (corretor !== link.corretor || !dia || dia < link.de || dia > link.ate || !id_cliente)
      throw new Error("Esta visita não faz parte deste link.");
    const { error } =
      data.aconteceu === null
        ? await secondaryAdmin.from("al_visitas_confirmadas").delete().eq("chave", data.chave)
        : await secondaryAdmin.from("al_visitas_confirmadas").upsert({
            chave: data.chave,
            id_cliente,
            corretor,
            data: dia,
            aconteceu: data.aconteceu,
            observacao: data.observacao?.trim() || null,
            token: link.token,
            respondido_em: new Date().toISOString(),
          });
    if (error) throw new Error("Não foi possível salvar. Tente de novo.");
    await secondaryAdmin.from("al_conferencia_links").update({ respondido_em: new Date().toISOString() }).eq("token", link.token);
    return { ok: true };
  });

const informarSchema = z.object({
  token: tokenSchema,
  id_cliente: z.string().max(40),
  produto: z.string().max(120),
  data: z.string().max(20),
  observacao: z.string().max(500).optional(),
});

/** O corretor informa uma visita que fez e que não está na agenda do Hypnobox. */
export const informarVisita = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => informarSchema.parse(d))
  .handler(async ({ data }): Promise<VisitaInformada> => {
    // mensagens para o corretor (o validador só barra o que não vem da página)
    const id_cliente = data.id_cliente.trim();
    if (!/^\d{1,12}$/.test(id_cliente)) throw new Error("O ID do cliente tem só números.");
    if (!data.produto.trim()) throw new Error("Informe o produto da visita.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.data)) throw new Error("Informe o dia da visita.");
    const link = await linkValido(data.token);
    if (data.data < link.de || data.data > link.ate)
      throw new Error("O dia da visita precisa estar dentro do período deste link.");
    const { data: linha, error } = await secondaryAdmin
      .from("al_visitas_informadas")
      .insert({
        token: link.token,
        corretor: link.corretor,
        id_cliente,
        produto: data.produto.trim(),
        data: data.data,
        observacao: data.observacao?.trim() || null,
      })
      .select("id, id_cliente, produto, data, observacao")
      .single();
    if (error) throw new Error("Não foi possível salvar. Tente de novo.");
    await secondaryAdmin.from("al_conferencia_links").update({ respondido_em: new Date().toISOString() }).eq("token", link.token);
    return { ...(linha as VisitaInformada), observacao: (linha.observacao as string) ?? "" };
  });

/** Remove uma visita informada por engano (só as do corretor deste link). */
export const removerVisitaInformada = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: tokenSchema, id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const link = await linkValido(data.token);
    const { error } = await secondaryAdmin
      .from("al_visitas_informadas")
      .delete()
      .eq("id", data.id)
      .eq("corretor", link.corretor);
    if (error) throw new Error("Não foi possível remover. Tente de novo.");
    return { ok: true };
  });
