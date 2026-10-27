import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { secondaryAdmin } from "@/integrations/supabase/secondary.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  JANELA_MENSAGENS,
  codificar,
  comprimir,
  idCurto,
  lerBlocos,
  mesDe,
  paraBytea,
  soConfirmacao,
  type MensagemCompacta,
} from "./formato";
import { linkHypnobox } from "./links";

// Gravações da extensão no banco (sempre pelo servidor, com service role):
// vínculos, conversa em blocos compactos, passos da guia e busca do cliente.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = supabaseAdmin as unknown as SupabaseClient<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const analise = secondaryAdmin as unknown as SupabaseClient<any>;

export type Passo =
  | "baixar" | "instalar" | "whatsapp" | "login" | "chave" | "tom" | "vincular" | "sugestao" | "transcricao" | "disparo";

export async function concluirPasso(userId: string, ...passos: Passo[]) {
  if (!passos.length) return;
  await admin
    .from("ext_guia_progresso")
    .upsert(passos.map((passo) => ({ user_id: userId, passo })), { onConflict: "user_id,passo", ignoreDuplicates: true });
}

const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const fim8 = (tel: string) => soDigitos(tel).slice(-8);
const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

/** O corretor do Hypnobox é este perfil? Compara primeiro nome e algum sobrenome, sem acento. */
export function mesmoCorretor(nomeHypnobox: string | null, nomePerfil: string): boolean {
  const a = semAcento(nomeHypnobox ?? "").split(" ").filter(Boolean);
  const b = semAcento(nomePerfil).split(" ").filter(Boolean);
  if (!a.length || !b.length) return false;
  if (a[0] !== b[0]) return false;
  if (a.length === 1 || b.length === 1) return true;
  return a.slice(1).some((x) => x.length > 2 && b.slice(1).includes(x));
}

const hojeSP = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

/** Etapa como o painel mostra: Venda, Proposta e "Não cliente" = Descartado. */
function etapaDe(r: { momento?: string | null; status_cliente?: string | null; etapa?: string | null }) {
  if (/^vend/i.test(r.momento ?? "")) return "Venda";
  if (/^n[ãa]o cliente$/i.test(r.status_cliente ?? "")) return "Descartado";
  if (/^propost/i.test(r.momento ?? "")) return "Proposta";
  return r.etapa === "Não interessado" ? "Descartado" : (r.etapa ?? null);
}

export type ClienteHypnobox = {
  id_cliente: string;
  nome: string | null;
  etapa: string | null;
  momento: string | null;
  submomento: string | null;
  produto: string | null;
  canal: string | null;
  campanha: string | null;
  cadastro: string | null;
  atualizacao: string | null;
  dias_sem_atualizar: number | null;
  link: string;
};


const COLS_HYP = "id_cliente,nome,corretor,etapa,momento,submomento,status_cliente,produto,canal,campanha,cadastro,atualizacao";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clienteHyp(r: any): ClienteHypnobox {
  const dias = r.atualizacao
    ? Math.max(0, Math.round((Date.parse(hojeSP() + "T00:00:00Z") - Date.parse(r.atualizacao + "T00:00:00Z")) / 864e5))
    : null;
  return {
    id_cliente: r.id_cliente,
    nome: r.nome ?? null,
    etapa: etapaDe(r),
    momento: r.momento ?? null,
    submomento: r.submomento ?? null,
    produto: r.produto ?? null,
    canal: r.canal ?? null,
    campanha: r.campanha ?? null,
    cadastro: r.cadastro ?? null,
    atualizacao: r.atualizacao ?? null,
    dias_sem_atualizar: dias,
    link: linkHypnobox(r.id_cliente),
  };
}

/**
 * Clientes deste corretor com o telefone da conversa: leads do CRM e clientes
 * do Hypnobox (últimos 8 dígitos, para não depender do nono dígito). Cliente de
 * outro corretor não aparece; só avisa que existe. O admin vê todos.
 */
export async function buscarCliente(
  perfil: { id: string; full_name: string; global: boolean },
  telefone: string,
  nome?: string,
) {
  const f8 = fim8(telefone);
  const leads: { id: string; full_name: string; phone: string | null; client_code: string | null; status: string }[] = [];
  let hypnobox: ClienteHypnobox[] = [];
  let deOutroCorretor = false;
  if (f8.length === 8) {
    // CRM e Hypnobox ao mesmo tempo; wa_find_lead (migration 20261006000001)
    // compara os últimos 8 dígitos no banco
    const [{ data: leadId }, { data: hyp }] = await Promise.all([
      admin.rpc("wa_find_lead", { _phone: telefone, _broker_id: perfil.global ? null : perfil.id }),
      analise.from("al_leads").select(COLS_HYP).like("telefone", `%${f8}`).limit(20),
    ]);
    if (leadId) {
      const { data: l } = await admin
        .from("leads")
        .select("id, full_name, phone, client_code, status")
        .eq("id", leadId)
        .maybeSingle();
      if (l) leads.push(l);
    }

    for (const r of hyp ?? []) {
      if (perfil.global || mesmoCorretor(r.corretor, perfil.full_name)) hypnobox.push(clienteHyp(r));
      else deOutroCorretor = true;
    }
  }
  // sem telefone que bata: procura pelo nome, ou pelo e-mail se tiver "@", entre os
  // clientes do corretor (Hypnobox e CRM)
  if (!hypnobox.length && !leads.length && nome && nome.trim().length >= 3) {
    const porEmail = nome.includes("@");
    const termo = porEmail ? nome.trim().toLowerCase().replace(/\s+/g, "") : `%${nome.trim().replace(/[%_]/g, "")}%`;
    const { data: achados } = await analise
      .from("al_leads")
      .select(COLS_HYP)
      .ilike(porEmail ? "email" : "nome", porEmail ? `%${termo.replace(/[%_]/g, "")}%` : termo)
      .limit(20);
    hypnobox = (achados ?? [])
      .filter((r) => perfil.global || mesmoCorretor(r.corretor, perfil.full_name))
      .map(clienteHyp)
      .slice(0, 8);
    let q = admin
      .from("leads")
      .select("id, full_name, phone, client_code, status")
      .ilike(porEmail ? "email" : "full_name", porEmail ? `%${termo.replace(/[%_]/g, "")}%` : termo);
    if (!perfil.global) q = q.eq("broker_id", perfil.id);
    const { data: crm } = await q.order("updated_at", { ascending: false }).limit(8);
    leads.push(...(crm ?? []));
  }
  return { leads, hypnobox, deOutroCorretor };
}

/** Nome do corretor do cliente no Hypnobox (null = cliente não existe na análise). */
export async function corretorNoHypnobox(idCliente: string): Promise<string | null> {
  const { data } = await analise.from("al_leads").select("corretor").eq("id_cliente", idCliente).maybeSingle();
  return data ? String(data.corretor ?? "") : null;
}

/** Vários clientes do Hypnobox de uma vez (lista da faixa). */
export async function clientesPorIds(ids: string[]): Promise<Map<string, ClienteHypnobox>> {
  const out = new Map<string, ClienteHypnobox>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await analise.from("al_leads").select(COLS_HYP).in("id_cliente", ids.slice(i, i + 200));
    for (const r of data ?? []) out.set(r.id_cliente, clienteHyp(r));
  }
  return out;
}

export async function clientePorId(idCliente: string): Promise<ClienteHypnobox | null> {
  const { data } = await analise.from("al_leads").select(COLS_HYP).eq("id_cliente", idCliente).maybeSingle();
  return data ? clienteHyp(data) : null;
}

// ── conversa ────────────────────────────────────────────────────────────────

export async function mensagensDo(vinculoId: string): Promise<MensagemCompacta[]> {
  const { data } = await admin.from("wa_conversa_blocos").select("dados").eq("vinculo_id", vinculoId).order("mes");
  return lerBlocos((data ?? []) as { dados: string }[]);
}

/**
 * Junta as mensagens novas às guardadas, fica só com as últimas JANELA_MENSAGENS
 * (o que serve de contexto) e regrava os blocos por mês. Sem repetir: a mesma
 * mensagem (id + horário) entra uma vez; uma transcrição nova substitui o texto.
 */
export async function gravarMensagens(vinculoId: string, novas: MensagemCompacta[]) {
  const guardadas = await mensagensDo(vinculoId);
  const chave = (m: MensagemCompacta) => `${idCurto(m.id)}|${m.ts}`;
  const porChave = new Map(guardadas.map((m) => [chave(m), m]));
  for (const n of novas) {
    const m = { ...n, id: idCurto(n.id), texto: n.texto.slice(0, 4000) };
    const velha = porChave.get(chave(m));
    // não apaga uma transcrição já feita quando a extensão manda o áudio de novo sem texto
    if (velha && velha.tipo === "a" && velha.texto && !m.texto) continue;
    porChave.set(chave(m), m);
  }
  const todas = [...porChave.values()].sort((a, b) => a.ts - b.ts).slice(-JANELA_MENSAGENS);

  const porMes = new Map<string, MensagemCompacta[]>();
  for (const m of todas) {
    const mes = mesDe(m.ts);
    if (!porMes.has(mes)) porMes.set(mes, []);
    porMes.get(mes)!.push(m);
  }
  const linhas = [];
  for (const [mes, ms] of porMes) {
    const texto = codificar(ms);
    const ultCli = [...ms].reverse().find((m) => m.lado === "<");
    const ultCor = [...ms].reverse().find((m) => m.lado === ">");
    const ult = ms[ms.length - 1];
    linhas.push({
      vinculo_id: vinculoId,
      mes,
      formato: 1,
      dados: paraBytea(await comprimir(texto)),
      tamanho_texto: new TextEncoder().encode(texto).length,
      n_msgs: ms.length,
      primeira_msg_em: new Date(ms[0].ts * 1000).toISOString(),
      ultima_msg_id: ult.id,
      ultima_msg_em: new Date(ult.ts * 1000).toISOString(),
      ultima_cliente_em: ultCli ? new Date(ultCli.ts * 1000).toISOString() : null,
      ultima_corretor_em: ultCor ? new Date(ultCor.ts * 1000).toISOString() : null,
      ultima_lado: ult.lado,
      ultima_cliente_so_ok: ult.lado === "<" && ult.tipo === undefined && soConfirmacao(ult.texto),
      atualizado_em: new Date().toISOString(),
    });
  }
  if (linhas.length) {
    const { error } = await admin.from("wa_conversa_blocos").upsert(linhas, { onConflict: "vinculo_id,mes" });
    if (error) throw new Error(error.message);
  }
  // meses que saíram da janela
  const meses = [...porMes.keys()];
  let apagar = admin.from("wa_conversa_blocos").delete().eq("vinculo_id", vinculoId);
  if (meses.length) apagar = apagar.not("mes", "in", `(${meses.map((m) => `"${m}"`).join(",")})`);
  await apagar;
  return { guardadas: todas.length, mensagens: todas };
}
