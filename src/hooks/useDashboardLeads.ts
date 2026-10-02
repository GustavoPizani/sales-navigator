import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useFunnels } from "@/hooks/useLeads";

/**
 * Fonte dos dashboards (gráficos, KPIs, desempenho por corretor) a partir dos
 * leads do CRM, no mesmo formato que os antigos `atendimentos`/`vendas`, para
 * reaproveitar os cálculos existentes (useDashboardData etc.).
 *
 * - atendimento = lead (data = cadastro, data_atualizacao = última alteração)
 * - status = nome da etapa; "Ganho"/"Perdido" para leads encerrados
 * - visita = lead chegou à etapa "Visita realizada" ou além
 * - em_contato = lead na etapa "Em contato" (KPI "Em Contato")
 * - venda = lead ganho (vendas do período pela data do ganho)
 */

const VISIT_OR_LATER = new Set(["visit_done", "proposal", "sale"]);

const localDate = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "yyyy-MM-dd") : null;
const startOfDayIso = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const endOfDayIso = (d: string) => new Date(`${d}T23:59:59.999`).toISOString();

const DASHBOARD_LEAD_SELECT =
  "id,full_name,client_code,phone,email,status,temperatura,won_value,won_at,broker_id,created_at,updated_at," +
  "broker:profiles!leads_broker_id_fkey(full_name,color),project:projects(name)," +
  "stage:funnel_stages(name,kind,color,sort_order)";

type DashboardLeadRow = {
  id: string;
  full_name: string;
  client_code: string | null;
  phone: string | null;
  email: string | null;
  status: "active" | "won" | "lost";
  temperatura: string | null;
  won_value: number | null;
  won_at: string | null;
  broker_id: string;
  created_at: string;
  updated_at: string;
  broker: { full_name: string; color: string } | null;
  project: { name: string } | null;
  stage: { name: string; kind: string | null; color: string; sort_order: number } | null;
};

export const WON_LABEL = "Ganho";
export const LOST_LABEL = "Perdido";

function toAtendimento(l: DashboardLeadRow) {
  const kind = l.stage?.kind ?? null;
  return {
    id: l.id,
    lead_id: l.id,
    data: localDate(l.created_at)!,
    data_atualizacao: localDate(l.updated_at),
    nome_cliente: l.full_name,
    id_cliente: l.client_code,
    telefone: l.phone,
    email: l.email,
    produto: l.project?.name ?? null,
    status:
      l.status === "won" ? WON_LABEL : l.status === "lost" ? LOST_LABEL : (l.stage?.name ?? null),
    temperatura: l.temperatura,
    valor: l.won_value,
    venda: l.status === "won",
    visita: l.status === "won" || (!!kind && VISIT_OR_LATER.has(kind)),
    em_contato: l.status === "active" && kind === "contact",
    setor: null as string | null,
    ocorrencia: null as string | null,
    broker_id: l.broker_id,
    profiles: l.broker,
  };
}

export type DashboardAtendimento = ReturnType<typeof toAtendimento>;

export function useDashboardLeads({
  brokerIds,
  from,
  to,
  dateField,
  enabled = true,
}: {
  /** undefined = todos que o usuário enxerga (RLS); [] = nenhum */
  brokerIds?: string[];
  from: string;
  to: string;
  dateField: "created_at" | "updated_at";
  enabled?: boolean;
}) {
  const funnelsQ = useFunnels();
  const idsKey = brokerIds?.join(",") ?? "all";

  const leadsQ = useQuery({
    queryKey: ["dashboard-leads", from, to, dateField, idsKey],
    enabled,
    queryFn: async () => {
      if (brokerIds && brokerIds.length === 0) return [];
      let q = supabase
        .from("leads")
        .select(DASHBOARD_LEAD_SELECT)
        .gte(dateField, startOfDayIso(from))
        .lte(dateField, endOfDayIso(to))
        .limit(5000);
      if (brokerIds) q = q.in("broker_id", brokerIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as DashboardLeadRow[];
    },
  });

  // Vendas do período = leads ganhos com data do ganho no período.
  const wonQ = useQuery({
    queryKey: ["dashboard-won-leads", from, to, idsKey],
    enabled,
    queryFn: async () => {
      if (brokerIds && brokerIds.length === 0) return [];
      let q = supabase
        .from("leads")
        .select(DASHBOARD_LEAD_SELECT)
        .eq("status", "won")
        .gte("won_at", startOfDayIso(from))
        .lte("won_at", endOfDayIso(to))
        .limit(5000);
      if (brokerIds) q = q.in("broker_id", brokerIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as DashboardLeadRow[];
    },
  });

  const atendimentos = useMemo(() => (leadsQ.data ?? []).map(toAtendimento), [leadsQ.data]);

  const vendas = useMemo(
    () =>
      (wonQ.data ?? []).map((l) => ({
        id: l.id,
        atendimento_id: l.id,
        broker_id: l.broker_id,
        valor: Number(l.won_value) || 0,
        data_venda: localDate(l.won_at)!,
        status: "approved",
        nome_cliente: l.full_name,
        produto: l.project?.name ?? null,
      })),
    [wonQ.data],
  );

  // Etapas do funil padrão + Ganho/Perdido, na ordem, com as cores das etapas.
  const statuses = useMemo(() => {
    const funnels = funnelsQ.data ?? [];
    const funnel = funnels.find((f) => f.is_default) ?? funnels[0];
    const stages = (funnel?.stages ?? []).map((s) => ({ name: s.name, color: s.color }));
    return [
      ...stages,
      { name: WON_LABEL, color: "#16A34A" },
      { name: LOST_LABEL, color: "#DC2626" },
    ];
  }, [funnelsQ.data]);

  return {
    atendimentos,
    vendas,
    statuses,
    isPending: leadsQ.isPending || wonQ.isPending,
    error: leadsQ.error || wonQ.error,
  };
}
