import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { mesmoCorretor } from "@/lib/extensao/dados.server";

// Corretores do Hypnobox ligados aos do sistema: equipe = gerente no sistema (a
// mesma da escala e do check-in), não o campo "gerente" do Hypnobox. Linhas em
// texto, como o resto dos dados da Análise Hypnobox.

type Perfil = { id: string; full_name: string; manager_id: string | null };

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

/** Perfil do corretor do Hypnobox: o mesmo critério da extensão e, sem ele, apelido do primeiro nome (Carol = CAROLLINE). */
function perfilDe(nomeHyp: string, perfis: Perfil[]): Perfil | null {
  const iguais = perfis.filter((p) => mesmoCorretor(nomeHyp, p.full_name));
  if (iguais.length === 1) return iguais[0];
  if (iguais.length > 1) return iguais.find((p) => semAcento(p.full_name) === semAcento(nomeHyp)) ?? null;
  const a = semAcento(nomeHyp).split(" ")[0] ?? "";
  const prefixo = perfis.filter((p) => {
    const b = semAcento(p.full_name).split(" ")[0] ?? "";
    return Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a));
  });
  return prefixo.length === 1 ? prefixo[0] : null;
}

/** Todas as linhas, de mil em mil (o limite por consulta do Supabase). */
async function todas<T>(pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const linhas: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await pagina(de, de + 999);
    if (error) throw new Error(error.message);
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) return linhas;
  }
}

/**
 * corretores_sistema: um por corretor ativo (corretor = nome no Hypnobox, ou o do
 * sistema em maiúsculas se ainda não apareceu lá). turnos_sistema: um por
 * corretor e dia com escala ou check-in.
 */
export async function corretoresDoSistema(nomesHyp: string[]) {
  const [{ data: P, error }, S, C] = await Promise.all([
    supabaseAdmin.from("profiles").select("id, full_name, role, manager_id, is_active, is_test"),
    todas((de, ate) => supabaseAdmin.from("shifts").select("broker_id, date, missed_at").order("id").range(de, ate)),
    todas((de, ate) =>
      supabaseAdmin.from("roulette_checkins").select("broker_id, turn_date, status, kind").order("id").range(de, ate),
    ),
  ]);
  if (error) throw new Error(`profiles: ${error.message}`);
  const perfis = (P ?? []).filter((p) => p.role === "broker" && p.is_active && !p.is_test) as Perfil[];
  const porId = new Map((P ?? []).map((p) => [p.id, p]));

  const nomeHypDe = new Map<string, string>();
  for (const nome of nomesHyp) {
    const p = perfilDe(nome, perfis);
    if (p && !nomeHypDe.has(p.id)) nomeHypDe.set(p.id, nome);
  }
  const chave = (p: Perfil) => nomeHypDe.get(p.id) ?? p.full_name.trim().toUpperCase();
  const corretores = perfis.map((p) => {
    const g = p.manager_id ? porId.get(p.manager_id) : null;
    return {
      corretor: chave(p),
      nome: p.full_name.trim(),
      equipe: g ? g.full_name.trim().toUpperCase() : "SEM EQUIPE",
      no_hypnobox: nomeHypDe.has(p.id) ? "1" : "",
    };
  });

  // dia a dia: escalado (e se faltou) e check-in (validado na escala ou plantão extra)
  const ativos = new Map(perfis.map((p) => [p.id, p]));
  const dias = new Map<string, { corretor: string; data: string; escalado: string; falta: string; checkin: string; extra: string }>();
  const dia = (id: string, data: string) => {
    const k = id + "|" + data;
    let d = dias.get(k);
    if (!d) dias.set(k, (d = { corretor: chave(ativos.get(id)!), data, escalado: "", falta: "", checkin: "", extra: "" }));
    return d;
  };
  for (const s of S) {
    if (!ativos.has(s.broker_id)) continue;
    const d = dia(s.broker_id, s.date);
    d.escalado = "1";
    if (s.missed_at) d.falta = "1";
  }
  for (const c of C) {
    if (!ativos.has(c.broker_id) || (c.status !== "validated" && c.status !== "allocated")) continue;
    const d = dia(c.broker_id, c.turn_date);
    d.checkin = "1";
    if (c.kind === "standby") d.extra = "1";
  }
  return { corretores, turnos: [...dias.values()].sort((a, b) => a.data.localeCompare(b.data)) };
}
