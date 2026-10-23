import { supabase } from "@/integrations/supabase/client";

// Escala pelo link do gerente (sem login). Tudo passa por RPCs que validam o
// token do link; as tabelas pending_* não são acessíveis diretamente.
// (as RPCs ainda não estão nos tipos gerados do Supabase)
const db = supabase as any;

export type PublicSlot = {
  id: string;
  modality: "online" | "salao";
  date: string;
  period: string;
  start_time: string;
  end_time: string;
  /** vagas do turno, definidas pelo admin */
  capacity: number;
  /** escalados no turno */
  used_total?: number;
  /** plantões de quem não está na lista do link (ex.: escalado pelo admin de outra equipe) */
  registered: number;
  /** ids dos corretores da lista (pré-cadastrados e com conta) escalados nessa vaga */
  assigned: string[];
};

export type PublicSchedule = {
  manager_name: string;
  team_name: string;
  central: string;
  plantao: string;
  /** hoje (AAAA-MM-DD, horário de Brasília): dias antes dele não mudam */
  today?: string;
  weeks: string[];
  week: string | null;
  /**
   * registered: corretor da equipe que já tem conta no app;
   * invite_token: convite para o pré-cadastrado finalizar o cadastro
   */
  brokers: {
    id: string;
    name: string;
    registered?: boolean;
    email?: string | null;
    invite_token?: string;
  }[];
  slots: PublicSlot[];
};

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const publicSchedule = {
  load: (token: string, week?: string | null) =>
    call<PublicSchedule | null>("crm_public_schedule", { p_token: token, p_week: week ?? null }),
  /** email: só a parte antes do @ (o domínio @pgvendas.com.br é fixo) */
  addBroker: (token: string, name: string, email: string) =>
    call<string>("crm_public_schedule_add_broker", {
      p_token: token,
      p_name: name,
      p_email: email,
    }),
  setEmail: (token: string, brokerId: string, email: string) =>
    call<void>("crm_public_schedule_set_email", {
      p_token: token,
      p_broker_id: brokerId,
      p_email: email,
    }),
  removeBroker: (token: string, brokerId: string) =>
    call<void>("crm_public_schedule_remove_broker", { p_token: token, p_broker_id: brokerId }),
  assign: (token: string, slotId: string, brokerId: string) =>
    call<void>("crm_public_schedule_assign", {
      p_token: token,
      p_slot_id: slotId,
      p_broker_id: brokerId,
    }),
  unassign: (token: string, slotId: string, brokerId: string) =>
    call<void>("crm_public_schedule_unassign", {
      p_token: token,
      p_slot_id: slotId,
      p_broker_id: brokerId,
    }),
  /** Admin: link individual do gerente (regenerate invalida o anterior). */
  managerLink: (managerId: string, regenerate = false) =>
    call<string>("crm_team_schedule_link", { p_manager_id: managerId, p_regenerate: regenerate }),
};

export type PendingRow = {
  id: string;
  full_name: string;
  manager_id: string;
  shifts: { id: string; slot_id: string }[];
};

/** Corretores pré-cadastrados com plantão nas vagas informadas (tela Escala). */
export async function fetchPendingForSlots(slotIds: string[]): Promise<PendingRow[]> {
  if (slotIds.length === 0) return [];
  const { data, error } = await db
    .from("pending_shifts")
    .select("id, slot_id, pending_brokers(id, full_name, manager_id)")
    .in("slot_id", slotIds);
  if (error) throw error;
  const byBroker = new Map<string, PendingRow>();
  for (const r of (data ?? []) as any[]) {
    const b = r.pending_brokers;
    if (!b) continue;
    if (!byBroker.has(b.id)) byBroker.set(b.id, { ...b, shifts: [] });
    byBroker.get(b.id)!.shifts.push({ id: r.id, slot_id: r.slot_id });
  }
  return [...byBroker.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function deletePendingBroker(id: string) {
  const { error } = await db.from("pending_brokers").delete().eq("id", id);
  if (error) throw error;
}
