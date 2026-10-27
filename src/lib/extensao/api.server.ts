import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buscarCliente,
  clientePorId,
  clientesPorIds,
  concluirPasso,
  corretorNoHypnobox,
  gravarMensagens,
  mensagensDo,
  mesmoCorretor,
} from "./dados.server";
import { pedirJson, transcrever, type Falha } from "./groq.server";
import type { MensagemCompacta } from "./formato";

// API da extensão do WhatsApp: /api/ext/<rota>. A extensão manda o token de
// login do Supabase (Authorization: Bearer). Respostas em JSON, com CORS só
// para a extensão (EXT_CHROME_ID) e o próprio site.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = supabaseAdmin as unknown as SupabaseClient<any>;

/** Versão da extensão publicada na página /extensao (a extensão avisa quando a dela é mais antiga). */
export const VERSAO_EXTENSAO = "0.1.0";
const MAX_AUDIO = 4_000_000; // corpo de requisição na Vercel vai até 4,5 MB

function origemPermitida(origem: string | null): string | null {
  if (!origem) return null;
  const id = process.env.EXT_CHROME_ID;
  if (id ? origem === `chrome-extension://${id}` : origem.startsWith("chrome-extension://")) return origem;
  const site = process.env.SITE_URL;
  if (site && origem === new URL(site).origin) return origem;
  if (/^http:\/\/localhost:\d+$/.test(origem)) return origem;
  return null;
}

function cors(req: Request): Record<string, string> {
  const origem = origemPermitida(req.headers.get("origin"));
  return origem
    ? {
        "Access-Control-Allow-Origin": origem,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      }
    : { Vary: "Origin" };
}

class ErroApi extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
const recusa = (f: Falha) => new ErroApi(f.status, f.mensagem, { esperarSeg: f.esperarSeg });

type Perfil = { id: string; full_name: string; role: string; global: boolean };

// login já validado, por token: evita validar no Supabase e reler o perfil a cada
// chamada (cada uma custava ~1 s). Vale 60 s e nunca além da validade do token.
const sessoesValidadas = new Map<string, { perfil: Perfil; ate: number }>();
const CACHE_LOGIN_MS = 60_000;

async function autenticar(req: Request): Promise<Perfil> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new ErroApi(401, "Entre com a sua conta do sistema.");
  const guardada = sessoesValidadas.get(token);
  if (guardada && guardada.ate > Date.now()) return guardada.perfil;
  const cli = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await cli.auth.getClaims(token);
  const sub = data?.claims?.sub;
  if (error || !sub) throw new ErroApi(401, "Sessão expirada. Entre de novo.");
  const { data: p } = await admin
    .from("profiles")
    .select("id, full_name, role, is_active, is_test, enabled_features")
    .eq("id", sub)
    .single();
  if (!p?.is_active) throw new ErroApi(403, "Conta inativa.");
  // global = vê todos os clientes da base na busca e no vínculo: admin, diretor e a
  // conta de teste (para testar a extensão com conversas reais; ela é invisível)
  const global = p.role === "admin" || p.role === "director" || p.is_test === true;
  // MVP: só o piloto (enabled_features.extensao), o admin e a conta de teste
  const piloto = global || p.enabled_features?.extensao === true;
  if (!piloto) throw new ErroApi(403, "A extensão ainda está em teste e não foi liberada para a sua conta.");
  const perfil = { id: p.id, full_name: p.full_name, role: p.role, global };
  const expira = Number(data.claims.exp) * 1000 || 0;
  if (sessoesValidadas.size > 500) sessoesValidadas.clear();
  sessoesValidadas.set(token, { perfil, ate: Math.min(Date.now() + CACHE_LOGIN_MS, expira || Infinity) });
  return perfil;
}

async function vinculoDo(perfil: Perfil, vinculoId: string) {
  const { data } = await admin.from("wa_vinculos").select("*").eq("id", vinculoId).maybeSingle();
  if (!data || data.broker_id !== perfil.id) throw new ErroApi(404, "Conversa não encontrada.");
  return data;
}

// ── corpos ──────────────────────────────────────────────────────────────────
const zMensagem = z.object({
  id: z.string().min(1).max(200),
  ts: z.number().int().positive(),
  lado: z.enum([">", "<"]),
  tipo: z.enum(["a", "i", "v", "d"]).optional(),
  seg: z.number().int().min(0).max(36000).optional(),
  texto: z.string().max(20000),
});
const zSessao = z.object({ versao: z.string().max(20), navegador: z.string().max(200).optional(), whatsapp: z.boolean().optional() });
const zAbrir = z.object({
  wa_chat_id: z.string().min(3).max(120),
  telefone: z.string().max(30),
  nome: z.string().max(200).optional(),
  /** procurar clientes mesmo com a conversa já vinculada (trocar o cliente) */
  buscar: z.boolean().optional(),
  /** só para conversa que a faixa já sabe que está vinculada: grava junto (uma chamada só) */
  mensagens: z.array(zMensagem).max(500).optional(),
  /** etiquetas da conversa no WhatsApp Business (ids do WhatsApp), para trazer as mudanças do celular */
  etiquetas_wa: z.array(z.string().min(1).max(40)).max(50).optional(),
});
const zSalvar = zAbrir.extend({
  lead_id: z.string().uuid().nullish(),
  id_cliente_hypnobox: z.string().max(40).nullish(),
  nao_cliente: z.boolean().optional(),
});
const zConversa = z.object({ vinculo_id: z.string().uuid(), mensagens: z.array(zMensagem).max(500) });
const zSugestao = z.object({ vinculo_id: z.string().uuid(), pedido: z.string().max(500).optional() });

// ── rotas ───────────────────────────────────────────────────────────────────
async function sessao(perfil: Perfil, corpo: unknown) {
  const b = zSessao.parse(corpo);
  const agora = new Date().toISOString();
  // tudo em paralelo (primeiro_acesso_em tem padrão no banco: o upsert não o sobrescreve)
  const [, , { data: chave }] = await Promise.all([
    admin
      .from("ext_instalacoes")
      .upsert({ user_id: perfil.id, versao: b.versao, navegador: b.navegador ?? null, ultimo_acesso_em: agora }),
    concluirPasso(perfil.id, "instalar", "login", ...(b.whatsapp ? (["whatsapp"] as const) : [])),
    admin.from("ia_chaves_usuario").select("final4, status").eq("user_id", perfil.id).maybeSingle(),
  ]);
  return {
    usuario: { id: perfil.id, nome: perfil.full_name, papel: perfil.role },
    chave: chave ? { final4: chave.final4, status: chave.status } : null,
    versaoPublicada: VERSAO_EXTENSAO,
  };
}

/**
 * Entrada automática: a extensão achou o login do sistema aberto neste navegador
 * e pede uma sessão própria (um link mágico de uso único, trocado pela extensão
 * no Supabase). Assim a extensão não reaproveita a sessão do site: quando uma
 * renova o login, a outra não cai. Só a própria extensão pode pedir.
 */
async function conectar(perfil: Perfil, req: Request) {
  const id = process.env.EXT_CHROME_ID;
  const origem = req.headers.get("origin") ?? "";
  if (id ? origem !== `chrome-extension://${id}` : !origem.startsWith("chrome-extension://"))
    throw new ErroApi(403, "Só a extensão pode pedir a entrada automática.");
  const { data: p } = await admin.from("profiles").select("email").eq("id", perfil.id).single();
  if (!p?.email) throw new ErroApi(400, "Conta sem e-mail cadastrado.");
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: p.email });
  if (error || !data?.properties?.hashed_token) throw new ErroApi(500, "Não foi possível entrar automaticamente.");
  return { token_hash: data.properties.hashed_token };
}

async function detalhesDoVinculo(v: Record<string, unknown>) {
  // Hypnobox, CRM e etiquetas ao mesmo tempo
  const [hyp, { data: lead }, { data: et }] = await Promise.all([
    v.id_cliente_hypnobox ? clientePorId(String(v.id_cliente_hypnobox)) : Promise.resolve(null),
    v.lead_id
      ? admin.from("leads").select("id, full_name, phone, client_code, status").eq("id", v.lead_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("wa_vinculo_etiquetas").select("etiqueta_id").eq("vinculo_id", v.id),
  ]);
  return { vinculo: { ...v, etiquetas: (et ?? []).map((e) => e.etiqueta_id) }, hypnobox: hyp, lead };
}

// ── etiquetas, prazo e lista ────────────────────────────────────────────────
const zCor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

async function etiquetas(perfil: Perfil) {
  const { data } = await admin
    .from("wa_etiquetas")
    .select("id, nome, cor, wa_label_id")
    .eq("broker_id", perfil.id)
    .order("nome");
  return { etiquetas: data ?? [] };
}

/**
 * Espelha as etiquetas do WhatsApp Business do corretor no banco: liga pelo id
 * do WhatsApp (ou pelo nome, na primeira vez), atualiza nome e cor, cria as
 * novas e apaga as que sumiram do WhatsApp. Etiquetas só do sistema ficam.
 */
async function sincronizarEtiquetas(perfil: Perfil, corpo: unknown) {
  const b = z
    .object({
      etiquetas: z
        .array(z.object({ wa_label_id: z.string().min(1).max(40), nome: z.string().trim().min(1).max(40), cor: zCor.optional() }))
        .max(100),
    })
    .parse(corpo);
  const { data: atuais } = await admin.from("wa_etiquetas").select("id, nome, cor, wa_label_id").eq("broker_id", perfil.id);
  const lista = atuais ?? [];
  const chaveNome = (s: string) => s.trim().toLowerCase();
  const vistos = new Set<string>();
  for (const w of b.etiquetas) {
    vistos.add(w.wa_label_id);
    const igual = lista.find((e) => e.wa_label_id === w.wa_label_id) ?? lista.find((e) => !e.wa_label_id && chaveNome(e.nome) === chaveNome(w.nome));
    const dados = { nome: w.nome, wa_label_id: w.wa_label_id, ...(w.cor ? { cor: w.cor } : {}) };
    if (igual) {
      if (igual.nome !== w.nome || igual.wa_label_id !== w.wa_label_id || (w.cor && igual.cor !== w.cor)) {
        // outra etiqueta do sistema com o mesmo nome: a do WhatsApp manda, a outra ganha um sufixo
        const conflito = lista.find((e) => e.id !== igual.id && chaveNome(e.nome) === chaveNome(w.nome));
        if (conflito) await admin.from("wa_etiquetas").update({ nome: `${conflito.nome} (sistema)`.slice(0, 40) }).eq("id", conflito.id);
        await admin.from("wa_etiquetas").update(dados).eq("id", igual.id);
      }
      Object.assign(igual, dados);
    } else {
      const { data: nova } = await admin
        .from("wa_etiquetas")
        .insert({ broker_id: perfil.id, ...dados })
        .select("id, nome, cor, wa_label_id")
        .single();
      if (nova) lista.push(nova);
    }
  }
  const sumiram = lista.filter((e) => e.wa_label_id && !vistos.has(e.wa_label_id)).map((e) => e.id);
  // lista vazia pode ser falha na leitura do WhatsApp: nesse caso não apaga nada
  if (b.etiquetas.length && sumiram.length) await admin.from("wa_etiquetas").delete().in("id", sumiram);
  return etiquetas(perfil);
}

async function criarEtiqueta(perfil: Perfil, corpo: unknown) {
  const b = z
    .object({ nome: z.string().trim().min(1).max(40), cor: zCor.optional(), wa_label_id: z.string().min(1).max(40).optional() })
    .parse(corpo);
  const { data, error } = await admin
    .from("wa_etiquetas")
    .insert({ broker_id: perfil.id, nome: b.nome, ...(b.cor ? { cor: b.cor } : {}), ...(b.wa_label_id ? { wa_label_id: b.wa_label_id } : {}) })
    .select("id, nome, cor, wa_label_id")
    .single();
  if (error) throw new ErroApi(400, error.code === "23505" ? "Você já tem uma etiqueta com esse nome." : error.message);
  return { etiqueta: data };
}

async function apagarEtiqueta(perfil: Perfil, corpo: unknown) {
  const b = z.object({ id: z.string().uuid() }).parse(corpo);
  await admin.from("wa_etiquetas").delete().eq("id", b.id).eq("broker_id", perfil.id);
  return { ok: true };
}

/** Etiquetas do vínculo numa operação só no banco (RPC wa_definir_etiquetas: confere o dono e troca as etiquetas). */
async function definirEtiquetas(perfil: Perfil, vinculoId: string, ids: string[]) {
  const { data, error } = await admin.rpc("wa_definir_etiquetas", {
    _vinculo_id: vinculoId,
    _broker_id: perfil.id,
    _etiquetas: ids,
  });
  if (error) throw new ErroApi(error.message.includes("não encontrada") ? 404 : 400, error.message);
  return (data as string[] | null) ?? [];
}

/**
 * Etiquetas do WhatsApp Business postas na conversa (inclusive pelo celular) →
 * vínculo no banco. As etiquetas só do sistema continuam; muda só se for diferente.
 */
async function sincronizarEtiquetasDoWa(perfil: Perfil, vinculoId: string, idsWa: string[]) {
  const [{ data: minhas }, { data: atuais }] = await Promise.all([
    admin.from("wa_etiquetas").select("id, wa_label_id").eq("broker_id", perfil.id),
    admin.from("wa_vinculo_etiquetas").select("etiqueta_id").eq("vinculo_id", vinculoId),
  ]);
  const doWa = new Set(idsWa);
  const porId = new Map((minhas ?? []).map((e) => [e.id, e.wa_label_id as string | null]));
  const atual = (atuais ?? []).map((x) => x.etiqueta_id);
  const novas = [
    ...atual.filter((id) => !porId.get(id)), // só do sistema
    ...(minhas ?? []).filter((e) => e.wa_label_id && doWa.has(e.wa_label_id)).map((e) => e.id),
  ];
  const igual = novas.length === atual.length && novas.every((id) => atual.includes(id));
  if (!igual) await definirEtiquetas(perfil, vinculoId, novas);
}

async function etiquetarVinculo(perfil: Perfil, corpo: unknown) {
  const b = z.object({ vinculo_id: z.string().uuid(), etiquetas: z.array(z.string().uuid()).max(20) }).parse(corpo);
  return { etiquetas: await definirEtiquetas(perfil, b.vinculo_id, b.etiquetas) };
}

async function prazoVinculo(perfil: Perfil, corpo: unknown) {
  const b = z
    .object({ vinculo_id: z.string().uuid(), retornar_em: z.string().datetime({ offset: true }).nullable(), nota: z.string().max(300).optional() })
    .parse(corpo);
  const v = await vinculoDo(perfil, b.vinculo_id);
  const { error } = await admin
    .from("wa_vinculos")
    .update({ retornar_em: b.retornar_em, retorno_nota: b.retornar_em ? (b.nota ?? null) : null })
    .eq("id", v.id);
  if (error) throw new ErroApi(400, error.message);
  return { retornar_em: b.retornar_em, retorno_nota: b.retornar_em ? (b.nota ?? null) : null };
}

/**
 * Lista das conversas vinculadas do corretor para organizar o dia: filtro por
 * etiqueta e situação; ordem padrão do mais antigo sem contato para o mais novo.
 */
async function lista(perfil: Perfil, corpo: unknown) {
  const b = z
    .object({
      etiqueta_id: z.string().uuid().optional(),
      situacao: z.enum(["todas", "esperando", "aguardando", "vencido", "com_prazo"]).default("todas"),
      sem_contato_dias: z.number().int().min(0).max(3650).optional(),
      ordem: z.enum(["sem_contato", "prazo", "recente"]).default("sem_contato"),
    })
    .parse(corpo);
  let q = admin
    .from("wa_vinculos")
    .select(
      "id, wa_chat_id, telefone, nome_contato, id_cliente_hypnobox, lead_id, ultima_lado, ultima_cliente_em, ultima_corretor_em, ultima_cliente_so_ok, ultimo_contato_em, retornar_em, retorno_nota, n_msgs",
    )
    .eq("broker_id", perfil.id)
    .eq("nao_cliente", false);
  if (b.etiqueta_id) {
    const { data: comEt } = await admin.from("wa_vinculo_etiquetas").select("vinculo_id").eq("etiqueta_id", b.etiqueta_id);
    const idsEt = (comEt ?? []).map((x) => x.vinculo_id);
    if (!idsEt.length) return { itens: [] };
    q = q.in("id", idsEt);
  }
  const agora = new Date().toISOString();
  if (b.situacao === "esperando") q = q.eq("ultima_lado", "<").eq("ultima_cliente_so_ok", false);
  else if (b.situacao === "aguardando") q = q.eq("ultima_lado", ">");
  else if (b.situacao === "vencido") q = q.lte("retornar_em", agora);
  else if (b.situacao === "com_prazo") q = q.not("retornar_em", "is", null);
  if (b.sem_contato_dias)
    q = q.lte("ultimo_contato_em", new Date(Date.now() - b.sem_contato_dias * 864e5).toISOString());
  q =
    b.ordem === "prazo"
      ? q.order("retornar_em", { ascending: true, nullsFirst: false })
      : q.order("ultimo_contato_em", { ascending: b.ordem === "sem_contato", nullsFirst: b.ordem === "sem_contato" });
  const { data, error } = await q.limit(300);
  if (error) throw new ErroApi(400, error.message);
  const itens = data ?? [];
  const [hyp, et] = await Promise.all([
    clientesPorIds([...new Set(itens.map((i) => i.id_cliente_hypnobox).filter(Boolean))] as string[]),
    itens.length
      ? admin.from("wa_vinculo_etiquetas").select("vinculo_id, etiqueta_id").in("vinculo_id", itens.map((i) => i.id))
      : Promise.resolve({ data: [] as { vinculo_id: string; etiqueta_id: string }[] }),
  ]);
  const etPor = new Map<string, string[]>();
  for (const x of et.data ?? []) etPor.set(x.vinculo_id, [...(etPor.get(x.vinculo_id) ?? []), x.etiqueta_id]);
  return {
    itens: itens.map((i) => {
      const h = i.id_cliente_hypnobox ? hyp.get(i.id_cliente_hypnobox) : null;
      return {
        ...i,
        nome: h?.nome || i.nome_contato || i.telefone,
        etapa: h?.etapa ?? null,
        produto: h?.produto ?? null,
        etiquetas: etPor.get(i.id) ?? [],
      };
    }),
  };
}

async function abrirConversa(perfil: Perfil, corpo: unknown) {
  const b = zAbrir.parse(corpo);
  const { data: v } = await admin
    .from("wa_vinculos")
    .select("*")
    .eq("broker_id", perfil.id)
    .eq("wa_chat_id", b.wa_chat_id)
    .maybeSingle();
  if (v && !b.buscar) {
    if (v.nao_cliente) return { ...(await detalhesDoVinculo(v)), sugestoes: null, mensagens: [] };
    // grava as mensagens novas e traz as etiquetas do celular ao mesmo tempo
    const [mensagens] = await Promise.all([
      b.mensagens?.length
        ? gravarMensagens(v.id, b.mensagens as MensagemCompacta[]).then((g) => g.mensagens)
        : mensagensDo(v.id),
      b.etiquetas_wa ? sincronizarEtiquetasDoWa(perfil, v.id, b.etiquetas_wa) : Promise.resolve(),
    ]);
    return { ...(await detalhesDoVinculo(v)), sugestoes: null, mensagens };
  }
  const sugestoes = await buscarCliente(perfil, b.telefone, b.nome);
  return v ? { ...(await detalhesDoVinculo(v)), sugestoes } : { vinculo: null, hypnobox: null, lead: null, sugestoes };
}

async function salvarVinculo(perfil: Perfil, corpo: unknown) {
  const b = zSalvar.parse(corpo);
  const naoCliente = b.nao_cliente === true;
  if (!naoCliente && !b.lead_id && !b.id_cliente_hypnobox)
    throw new ErroApi(400, "Escolha o cliente ou marque como não é cliente.");
  if (b.lead_id && !perfil.global) {
    const { data: l } = await admin.from("leads").select("broker_id").eq("id", b.lead_id).maybeSingle();
    if (l?.broker_id !== perfil.id) throw new ErroApi(403, "Este cliente não é seu no CRM.");
  }
  if (b.id_cliente_hypnobox && !perfil.global) {
    const dono = await corretorNoHypnobox(b.id_cliente_hypnobox);
    if (dono === null) throw new ErroApi(404, "Cliente não encontrado no Hypnobox.");
    if (!mesmoCorretor(dono, perfil.full_name))
      throw new ErroApi(403, "Este cliente é de outro corretor no Hypnobox.");
  }
  const { data, error } = await admin
    .from("wa_vinculos")
    .upsert(
      {
        broker_id: perfil.id,
        wa_chat_id: b.wa_chat_id,
        telefone: b.telefone.replace(/\D/g, "") || null,
        nome_contato: b.nome ?? null,
        lead_id: naoCliente ? null : (b.lead_id ?? null),
        id_cliente_hypnobox: naoCliente ? null : (b.id_cliente_hypnobox ?? null),
        nao_cliente: naoCliente,
        vinculado_por: perfil.id,
      },
      { onConflict: "broker_id,wa_chat_id" },
    )
    .select("*")
    .single();
  if (error) throw new ErroApi(400, error.message);
  if (naoCliente) await admin.from("wa_conversa_blocos").delete().eq("vinculo_id", data.id);
  else await concluirPasso(perfil.id, "vincular");
  return detalhesDoVinculo(data);
}

async function gravarConversa(perfil: Perfil, corpo: unknown) {
  const b = zConversa.parse(corpo);
  const v = await vinculoDo(perfil, b.vinculo_id);
  if (v.nao_cliente) throw new ErroApi(400, "Esta conversa está marcada como não é cliente.");
  return gravarMensagens(v.id, b.mensagens as MensagemCompacta[]);
}

/** Mensagens guardadas de uma conversa (o painel mostra as transcrições já feitas). */
async function lerConversa(perfil: Perfil, corpo: unknown) {
  const b = z.object({ vinculo_id: z.string().uuid() }).parse(corpo);
  const v = await vinculoDo(perfil, b.vinculo_id);
  return { mensagens: await mensagensDo(v.id) };
}

// ── catálogo de imóveis (para a IA só sugerir o que está cadastrado) ────────
type Tipologia = { type?: string; area?: number; vagas?: number; valor_cheio?: number | null };
let catalogoCache: { em: number; texto: string } | null = null;

const reais = (v: number) =>
  v >= 1e6 ? `R$ ${(v / 1e6).toFixed(2).replace(".", ",").replace(/,?0+$/, "")} mi` : `R$ ${Math.round(v / 1e3)} mil`;

/** Bairro do imóvel: o campo da ficha ou o trecho do endereço entre ". " e " - ". */
function bairroDe(endereco: string, ficha: { neighborhood?: string }) {
  if (ficha.neighborhood) return ficha.neighborhood;
  const m = /[.,]\s*([^.,]+?)\s*-\s*[^-]+$/.exec(endereco);
  return m ? m[1] : "";
}

/** Uma linha por imóvel ativo: nome, bairro, cidade, entrega e tipologias (tipo, m², vagas, valor). */
async function catalogoImoveis(): Promise<string> {
  if (catalogoCache && Date.now() - catalogoCache.em < 10 * 60_000) return catalogoCache.texto;
  const { data } = await admin.from("projects").select("name, address, city, description").eq("is_active", true).order("name");
  const linhas: string[] = [];
  for (const p of data ?? []) {
    let ficha: { neighborhood?: string; entrega?: string; typologies?: Tipologia[] } = {};
    try {
      ficha = JSON.parse(p.description || "{}");
    } catch {}
    const tipos = (ficha.typologies ?? []).slice(0, 8);
    if (!tipos.length) continue; // Tabelão e fichas sem tipologia
    const ts = tipos
      .map((t) =>
        [t.type, t.area ? `${t.area} m²` : "", t.vagas != null ? `${t.vagas} vaga${t.vagas === 1 ? "" : "s"}` : "", t.valor_cheio ? reais(t.valor_cheio) : ""]
          .filter(Boolean)
          .join(" "),
      )
      .join("; ");
    linhas.push(
      `- ${p.name} | ${bairroDe(p.address, ficha)}, ${p.city} | ${ficha.entrega || "entrega não informada"} | ${ts}`,
    );
  }
  catalogoCache = { em: Date.now(), texto: linhas.join("\n") };
  return catalogoCache.texto;
}

const quando = (ts: number) =>
  new Date((ts - 3 * 3600) * 1000).toISOString().slice(5, 16).replace("T", " ").replace(/^(\d\d)-(\d\d)/, "$2/$1");

async function sugestao(perfil: Perfil, corpo: unknown) {
  const b = zSugestao.parse(corpo);
  const v = await vinculoDo(perfil, b.vinculo_id);
  const msgs = (await mensagensDo(v.id)).slice(-30);
  const det = await detalhesDoVinculo(v);
  const h = det.hypnobox;
  const cliente = [
    h?.nome || det.lead?.full_name || v.nome_contato ? `Nome: ${h?.nome || det.lead?.full_name || v.nome_contato}` : "",
    h?.etapa ? `Etapa no Hypnobox: ${h.etapa}${h.submomento ? ` (${h.submomento})` : ""}` : "",
    h?.produto ? `Produto de interesse: ${h.produto}` : "",
    h?.dias_sem_atualizar != null ? `Dias sem atualizar no Hypnobox: ${h.dias_sem_atualizar}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const conversa = msgs
    .map((m) => {
      const quem = m.lado === ">" ? "Corretor" : "Cliente";
      const marca = m.tipo === "a" ? (m.texto ? "[áudio transcrito] " : "[áudio sem transcrição]") : m.tipo === "i" ? "[imagem] " : m.tipo === "v" ? "[vídeo] " : m.tipo === "d" ? "[documento] " : "";
      return `[${quando(m.ts)}] ${quem}: ${marca}${m.texto}`;
    })
    .join("\n");
  const catalogo = await catalogoImoveis();
  const sistema =
    "Você ajuda um corretor de imóveis da Paes & Gregori (São Paulo) a responder clientes no WhatsApp. " +
    "Escreva em português do Brasil, no tom de uma conversa de WhatsApp: curto, cordial, direto, sem formalidade excessiva. " +
    "O objetivo é avançar o atendimento: tirar a dúvida, propor o próximo passo (ligação, visita, envio de material) e manter o cliente engajado.\n" +
    "Regras sobre imóveis:\n" +
    "1. Só cite imóveis do CATÁLOGO abaixo, com o nome escrito como está lá. Nunca invente empreendimento, endereço, metragem, número de dormitórios, vagas, preço, disponibilidade ou condição de pagamento.\n" +
    "2. Antes de sugerir, leia na conversa o que o cliente pediu: região ou bairro, dormitórios, vagas, faixa de preço, pronto ou lançamento, compra ou locação. Priorize os imóveis do catálogo na região pedida e que atendem às exigências; considere também o produto de interesse do cliente no Hypnobox.\n" +
    "3. Valores: só use os que estão no catálogo, como referência (\"a partir de\", \"unidades de\"); se o cliente pediu um teto de preço, não ofereça tipologia acima dele.\n" +
    "4. Se nenhum imóvel do catálogo atende (região sem produto, locação, perfil diferente), diga isso com sinceridade e ofereça a alternativa mais próxima do catálogo, explicando a diferença, ou proponha confirmar com o corretor. Não prometa o que não está no catálogo.\n" +
    "5. A Paes & Gregori trabalha com venda; se o cliente quer locação, não ofereça imóvel para alugar.\n" +
    'Responda só com JSON: {"sugestoes":[{"texto":"mensagem pronta para enviar","porque":"em poucas palavras, o objetivo e o imóvel citado"}]}, com 3 opções diferentes entre si.';
  const usuario =
    `CATÁLOGO (imóveis cadastrados; nome | bairro, cidade | entrega | tipologias):\n${catalogo || "(sem imóveis cadastrados)"}\n\n` +
    `${cliente ? `Cliente:\n${cliente}\n\n` : ""}Conversa (mais recente por último):\n${conversa || "(sem mensagens guardadas ainda)"}` +
    `\n\nCorretor: ${perfil.full_name.split(" ")[0]}${b.pedido ? `\nO corretor pediu: ${b.pedido}` : ""}`;
  const r = await pedirJson(perfil.id, "sugestao", sistema, usuario);
  if (!r.ok) throw recusa(r);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lista = Array.isArray((r.json as any)?.sugestoes) ? (r.json as any).sugestoes : [];
  const sugestoes = lista
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => ({ texto: String(s?.texto ?? "").trim(), porque: String(s?.porque ?? "").trim() }))
    .filter((s: { texto: string }) => s.texto)
    .slice(0, 3);
  if (!sugestoes.length) throw new ErroApi(502, "A IA não devolveu sugestões. Tente de novo.");
  await concluirPasso(perfil.id, "sugestao");
  return { sugestoes };
}

async function transcricao(perfil: Perfil, req: Request) {
  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || !audio.size) throw new ErroApi(400, "Áudio não enviado.");
  if (audio.size > MAX_AUDIO) throw new ErroApi(413, "Áudio grande demais para transcrever (máximo 4 MB).");
  const v = await vinculoDo(perfil, String(form.get("vinculo_id") ?? ""));
  const msg = zMensagem.parse({
    id: String(form.get("msg_id") ?? ""),
    ts: Number(form.get("ts")),
    lado: String(form.get("lado")),
    tipo: "a",
    seg: Math.round(Number(form.get("segundos")) || 0),
    texto: "",
  });
  const { data: feita } = await admin
    .from("wa_transcricoes")
    .select("erro")
    .eq("vinculo_id", v.id)
    .eq("msg_id", msg.id.replace(/[^0-9A-Za-z]/g, "").slice(-8))
    .maybeSingle();
  if (feita && !feita.erro) {
    const ja = (await mensagensDo(v.id)).find((m) => m.ts === msg.ts && m.tipo === "a" && m.texto);
    if (ja) return { texto: ja.texto, jaTinha: true };
  }
  const r = await transcrever(perfil.id, audio, "audio.ogg", msg.seg ?? 0);
  await admin.from("wa_transcricoes").upsert({
    vinculo_id: v.id,
    msg_id: msg.id.replace(/[^0-9A-Za-z]/g, "").slice(-8),
    segundos: msg.seg ?? null,
    modelo: "whisper-large-v3-turbo",
    erro: r.ok ? null : r.mensagem,
  });
  if (!r.ok) throw recusa(r);
  await gravarMensagens(v.id, [{ ...msg, texto: r.texto }]);
  await concluirPasso(perfil.id, "transcricao");
  return { texto: r.texto, jaTinha: false };
}

async function usoDeHoje(perfil: Perfil) {
  const dia = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const { data } = await admin
    .from("ia_uso")
    .select("tipo, modelo, pedidos, tokens, segundos_audio, recusas_limite")
    .eq("user_id", perfil.id)
    .eq("dia", dia);
  return { dia, uso: data ?? [] };
}

// ── mapeamento de tempo ─────────────────────────────────────────────────────
const zMetricas = z.object({
  itens: z
    .array(
      z.object({
        acao: z.string().min(1).max(60),
        n: z.number().int().min(1).max(10000),
        ms_total: z.number().int().min(0).max(1e9),
        ms_max: z.number().int().min(0).max(1e7),
        erros: z.number().int().min(0).max(10000),
      }),
    )
    .max(100),
});

async function somarMetrica(userId: string, origem: "faixa" | "servidor", m: { acao: string; n: number; ms_total: number; ms_max: number; erros: number }) {
  await admin.rpc("ext_metricas_somar", {
    _user_id: userId,
    _origem: origem,
    _acao: m.acao,
    _n: m.n,
    _ms_total: m.ms_total,
    _ms_max: m.ms_max,
    _erros: m.erros,
  });
}

/** Tempo da rota por dentro do servidor (as próprias métricas e a versão pública não entram). */
async function medirServidor(userId: string | null, rota: string, inicio: number, erro: boolean) {
  if (!userId || rota === "metricas") return;
  const ms = Date.now() - inicio;
  await somarMetrica(userId, "servidor", { acao: `api:${rota}`.slice(0, 60), n: 1, ms_total: ms, ms_max: ms, erros: erro ? 1 : 0 }).catch(
    () => {},
  );
}

/** Tempos medidos na faixa (já agrupados por ação). */
async function receberMetricas(perfil: Perfil, corpo: unknown) {
  const b = zMetricas.parse(corpo);
  await Promise.all(b.itens.map((m) => somarMetrica(perfil.id, "faixa", m)));
  return { ok: true, recebidas: b.itens.length };
}

// ── despacho ────────────────────────────────────────────────────────────────
export async function atenderExtensao(req: Request): Promise<Response> {
  const headers = { ...cors(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const rota = new URL(req.url).pathname.replace(/^\/api\/ext\/?/, "").replace(/\/$/, "");
  const inicio = Date.now();
  let quem: string | null = null; // para o mapeamento de tempo do servidor
  try {
    let corpo: unknown;
    if (rota === "versao" && req.method === "GET") corpo = { versao: VERSAO_EXTENSAO, download: "/extensao/gestao-whatsapp.zip" };
    else {
      const perfil = await autenticar(req);
      quem = perfil.id;
      const json = () => req.json().catch(() => ({}));
      const post = req.method === "POST";
      if (rota === "sessao" && post) corpo = await sessao(perfil, await json());
      else if (rota === "conectar" && post) corpo = await conectar(perfil, req);
      else if (rota === "conversa/abrir" && post) corpo = await abrirConversa(perfil, await json());
      else if (rota === "vinculo" && post) corpo = await salvarVinculo(perfil, await json());
      else if (rota === "conversa" && post) corpo = await gravarConversa(perfil, await json());
      else if (rota === "conversa/ler" && post) corpo = await lerConversa(perfil, await json());
      else if (rota === "etiquetas" && req.method === "GET") corpo = await etiquetas(perfil);
      else if (rota === "etiquetas" && post) corpo = await criarEtiqueta(perfil, await json());
      else if (rota === "etiquetas/apagar" && post) corpo = await apagarEtiqueta(perfil, await json());
      else if (rota === "etiquetas/sincronizar" && post) corpo = await sincronizarEtiquetas(perfil, await json());
      else if (rota === "vinculo/etiquetas" && post) corpo = await etiquetarVinculo(perfil, await json());
      else if (rota === "vinculo/prazo" && post) corpo = await prazoVinculo(perfil, await json());
      else if (rota === "lista" && post) corpo = await lista(perfil, await json());
      else if (rota === "metricas" && post) corpo = await receberMetricas(perfil, await json());
      else if (rota === "guia/passo" && post) {
        // só o passo concluído pelo favorito "Guia do WhatsApp"
        z.object({ passo: z.literal("disparo") }).parse(await json());
        await concluirPasso(perfil.id, "disparo");
        corpo = { ok: true };
      }
      else if (rota === "ia/sugestao" && post) corpo = await sugestao(perfil, await json());
      else if (rota === "ia/transcrever" && post) corpo = await transcricao(perfil, req);
      else if (rota === "ia/uso" && req.method === "GET") corpo = await usoDeHoje(perfil);
      else throw new ErroApi(404, "Rota da extensão não encontrada.");
    }
    await medirServidor(quem, rota, inicio, false);
    return new Response(JSON.stringify(corpo), { status: 200, headers });
  } catch (e) {
    const status = e instanceof ErroApi ? e.status : e instanceof z.ZodError ? 400 : 500;
    await medirServidor(quem, rota, inicio, status >= 500 || status === 429);
    const erro =
      e instanceof z.ZodError ? "Dados inválidos." : e instanceof Error && status !== 500 ? e.message : "Erro no servidor.";
    if (status === 500) console.error("[api/ext]", e);
    return new Response(JSON.stringify({ erro, ...(e instanceof ErroApi ? e.extra : {}) }), { status, headers });
  }
}
