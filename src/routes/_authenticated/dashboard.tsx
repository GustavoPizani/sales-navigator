import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronDown, Plus, Upload, X, Trash2, Calendar, Bell, Download, DollarSign } from "lucide-react";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Link, useNavigate } from "@tanstack/react-router";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBrokers } from "@/hooks/useBrokers";
import { AppHeader } from "@/components/AppHeader";
import { useDashboardFilters, useDashboardData } from "@/hooks/useDashboard";
import { DashboardCharts, AtendimentosTable, MiniAvatar, formatBRL, StatusChart, VisitsByProductChart } from "@/components/DashboardShared";
import { BarChart, Bar, Tooltip, ResponsiveContainer } from "recharts";
import { AppointmentForm } from "./appointments";

const STATUSES = ["Prospect", "Em Tratativa", "Proposta em Análise", "Proposta Aprovada", "Contrato Gerado", "Contrato Assinado", "Cancelada"];

function normalizeStr(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

function matchProjectName(produto: string, projects: { name: string }[]): string {
  const normP = normalizeStr(produto);
  const exact = projects.find((p) => normalizeStr(p.name) === normP);
  if (exact) return exact.name;
  const wordsA = normP.split(" ").filter((w) => w.length > 2);
  let best = { score: 0.25, name: "" };
  for (const p of projects) {
    const wordsB = new Set(normalizeStr(p.name).split(" ").filter((w) => w.length > 2));
    const common = wordsA.filter((w) => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    const score = union > 0 ? common / union : 0;
    if (score > best.score) best = { score, name: p.name };
  }
  return best.name || produto;
}
const TEMPERATURAS = ["Frio", "Morno", "Quente"] as const;
const SETORES = ["Online", "Salão"] as const;

function KpiCard({ label, value, isLoading, onClick }: { label: string; value: string | number; isLoading?: boolean; onClick?: () => void }) {
  const valueStr = String(value);
  const len = valueStr.length;

  let valueClasses = "text-2xl sm:text-3xl";
  if (len > 18) valueClasses = "text-base sm:text-lg";
  else if (len > 15) valueClasses = "text-lg sm:text-xl";
  else if (len > 12) valueClasses = "text-xl sm:text-2xl";

  return (
    <div
      className={`bg-[var(--navy)] rounded-2xl p-4 flex flex-col justify-center items-center shadow-sm text-center min-h-[100px] transition-all ${onClick ? "cursor-pointer hover:ring-2 hover:ring-[var(--gold)]/60 hover:brightness-110 active:scale-95" : ""}`}
      onClick={onClick}
    >
      {isLoading ? (
        <div className="w-20 h-7 rounded-lg bg-white/20 animate-pulse mb-2" />
      ) : (
        <div className={`font-bold text-white mb-1 ${valueClasses}`}>{value}</div>
      )}
      <div className="text-[10px] sm:text-xs font-semibold text-[var(--gold)] uppercase tracking-wide leading-tight">{label}</div>
      {onClick && <div className="text-[9px] text-white/30 mt-1 uppercase tracking-wide">ver detalhes</div>}
    </div>
  );
}

function KpiDetailModal({
  title,
  items,
  onClose,
  isAdmin,
}: {
  title: string;
  items: { cliente: string; corretor?: string; unidade: string; valor?: number }[];
  onClose: () => void;
  isAdmin?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[80vh] flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <h2 className="font-bold text-[var(--navy)] text-base">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-[var(--navy)] p-1">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {items.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Nenhum registro no período</div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((item, i) => (
                <div key={i} className="px-5 py-3">
                  <div className="font-semibold text-[var(--navy)] text-sm">{item.cliente}</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
                    {isAdmin && item.corretor && (
                      <span className="text-xs text-muted-foreground">Corretor: <span className="font-medium text-[var(--navy)]">{item.corretor}</span></span>
                    )}
                    <span className="text-xs text-muted-foreground">Unidade: <span className="font-medium text-[var(--navy)]">{item.unidade || "—"}</span></span>
                    {item.valor != null && item.valor > 0 && (
                      <span className="text-xs text-muted-foreground">Valor: <span className="font-medium text-[var(--navy)]">{formatBRL(item.valor)}</span></span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { user, isAdmin } = useAuth();
  if (!isAdmin) return <BrokerDashboard user={user} />;
  return <AdminDashboard user={user} />;
}

function NotificationBell({ user, onSelect }: { user: any; onSelect: (appt: any) => void }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const navigate = useNavigate();

  const [seenShifts, setSeenShifts] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(`seen_shifts_${user?.id}`) || "{}");
    } catch {
      return {};
    }
  });

  const apptsQ = useQuery({
    queryKey: ["broker-past-appts", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("appointments")
        .select("*")
        .eq("owner_id", user.id)
        .lte("date", todayStr)
        .order("date", { ascending: false })
        .limit(50);
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const linkedIdsQ = useQuery({
    queryKey: ["linked-appt-ids", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("atendimentos")
        .select("appointment_id")
        .eq("broker_id", user.id)
        .not("appointment_id", "is", null);
      return (data ?? []).map((a: any) => a.appointment_id).filter(Boolean) as string[];
    },
    enabled: !!user?.id,
  });

  const shiftsQ = useQuery({
    queryKey: ["broker-upcoming-shifts", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("shifts")
        .select("*")
        .eq("broker_id", user.id)
        .gte("date", todayStr)
        .order("date", { ascending: true });
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const pendingAppts = useMemo(() =>
    (apptsQ.data ?? []).filter((a) => !(linkedIdsQ.data ?? []).includes(a.id)),
    [apptsQ.data, linkedIdsQ.data]
  );

  const getShiftSignature = (s: any) => `${s.date}_${s.start_time}_${s.end_time}_${s.notes || ""}`;

  const pendingShifts = useMemo(() => {
    const shifts = shiftsQ.data ?? [];
    return shifts.filter(s => seenShifts[s.id] !== getShiftSignature(s));
  }, [shiftsQ.data, seenShifts]);

  const pendingVendasQ = useQuery({
    queryKey: ["pending-vendas-bell", user?.id],
    queryFn: async () => {
      const { data: brokers } = await supabase
        .from("profiles")
        .select("id")
        .eq("manager_id", user.id);
      const brokerIds = (brokers ?? []).map((b: any) => b.id);
      if (brokerIds.length === 0) return [];
      const { data } = await supabase
        .from("vendas")
        .select("*, atendimentos(nome_cliente, id_cliente), profiles(full_name)")
        .in("broker_id", brokerIds)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user?.id && isAdmin,
    refetchInterval: 30000,
  });

  const pendingVendas = pendingVendasQ.data ?? [];

  const approveVenda = useMutation({
    mutationFn: async ({ vendaId, atendimentoId }: { vendaId: string; atendimentoId: string }) => {
      const [r1, r2] = await Promise.all([
        supabase.from("vendas").update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() }).eq("id", vendaId),
        supabase.from("atendimentos").update({ venda: true, status: "Contrato Assinado" }).eq("id", atendimentoId),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
    },
    onSuccess: () => {
      pendingVendasQ.refetch();
      qc.invalidateQueries({ queryKey: ["dashboard-atendimentos"] });
      qc.invalidateQueries({ queryKey: ["dashboard-vendas"] });
      toast.success("Venda aprovada!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rejectVenda = useMutation({
    mutationFn: async (vendaId: string) => {
      const { error } = await supabase
        .from("vendas")
        .update({ status: "rejected" })
        .eq("id", vendaId);
      if (error) throw error;
    },
    onSuccess: () => {
      pendingVendasQ.refetch();
      toast.success("Venda devolvida para o corretor.");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totalPending = pendingAppts.length + pendingShifts.length + pendingVendas.length;

  const handleShiftClick = (s: any) => {
    const next = { ...seenShifts, [s.id]: getShiftSignature(s) };
    setSeenShifts(next);
    localStorage.setItem(`seen_shifts_${user.id}`, JSON.stringify(next));
    setOpen(false);
    navigate({ to: "/schedule" });
  };

  const handleMarkAllShiftsAsRead = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = { ...seenShifts };
    pendingShifts.forEach(s => {
      next[s.id] = getShiftSignature(s);
    });
    setSeenShifts(next);
    localStorage.setItem(`seen_shifts_${user.id}`, JSON.stringify(next));
  };

  return (
    <div className="relative flex-shrink-0">
      <button onClick={() => setOpen(!open)} className="relative p-2 text-white/70 hover:text-white transition-colors">
        <Bell size={20} />
        {totalPending > 0 && (
          <span className="absolute top-1 right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white border-2 border-[var(--navy)]">
            {totalPending}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-border z-50 overflow-hidden flex flex-col max-h-[400px]">
            <div className="px-4 py-3 border-b border-border bg-[var(--surface)] flex justify-between items-center">
              <h3 className="font-semibold text-[var(--navy)] text-sm">Notificações</h3>
              {pendingShifts.length > 0 && (
                <button onClick={handleMarkAllShiftsAsRead} className="text-[10px] font-medium text-muted-foreground hover:text-[var(--navy)] underline">
                  Marcar escalas como lidas
                </button>
              )}
            </div>
            <div className="overflow-y-auto flex-1 p-2 space-y-1">
              {totalPending === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-6">Nenhuma notificação.</p>
              ) : (
                <>
                  {pendingVendas.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase px-2 py-1 flex items-center gap-1">
                        <DollarSign size={10} className="text-green-600" /> Vendas para Aprovar
                      </p>
                      {pendingVendas.map((v: any) => (
                        <div key={v.id} className="p-3 rounded-lg bg-green-50 border border-green-100 flex flex-col gap-2 mb-1">
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-[var(--navy)] text-sm truncate">
                                {(v.atendimentos as any)?.nome_cliente || "Cliente não identificado"}
                              </p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {(v.profiles as any)?.full_name} · {v.produto || "Produto não informado"}
                              </p>
                              {v.unidade && <p className="text-[10px] text-muted-foreground">Unidade: {v.unidade}</p>}
                              {v.valor && <p className="text-xs font-semibold text-green-700">{formatBRL(v.valor)}</p>}
                            </div>
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                              {v.data_venda ? format(new Date(v.data_venda + "T00:00:00"), "dd/MM", { locale: ptBR }) : ""}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => approveVenda.mutate({ vendaId: v.id, atendimentoId: v.atendimento_id })}
                              disabled={approveVenda.isPending}
                              className="flex-1 h-8 rounded-lg bg-green-600 text-white text-xs font-semibold disabled:opacity-50"
                            >
                              Aprovar
                            </button>
                            <button
                              onClick={() => rejectVenda.mutate(v.id)}
                              disabled={rejectVenda.isPending}
                              className="flex-1 h-8 rounded-lg bg-white border border-red-200 text-red-600 text-xs font-semibold disabled:opacity-50"
                            >
                              Rejeitar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {pendingShifts.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase px-2 py-1">Alterações na Escala</p>
                      {pendingShifts.map(s => (
                        <button
                          key={s.id}
                          onClick={() => handleShiftClick(s)}
                          className="w-full text-left p-3 rounded-lg hover:bg-[var(--surface)] border border-transparent hover:border-border transition-colors flex flex-col gap-1"
                        >
                          <div className="flex justify-between items-start gap-2">
                            <span className="font-semibold text-[var(--navy)] text-sm truncate">{seenShifts[s.id] ? "Escala alterada" : "Novo plantão"}</span>
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">{format(new Date(s.date + "T00:00:00"), "dd/MM", { locale: ptBR })}</span>
                          </div>
                          <span className="text-xs text-muted-foreground truncate">{s.start_time.slice(0,5)} às {s.end_time.slice(0,5)}{s.notes ? ` - ${s.notes}` : ""}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {pendingAppts.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase px-2 py-1">Atendimentos Pendentes</p>
                      {pendingAppts.map(a => (
                        <button
                          key={a.id}
                          onClick={() => {
                            onSelect(a);
                            setOpen(false);
                          }}
                          className="w-full text-left p-3 rounded-lg hover:bg-[var(--surface)] border border-transparent hover:border-border transition-colors flex flex-col gap-1"
                        >
                          <div className="flex justify-between items-start gap-2">
                            <span className="font-semibold text-[var(--navy)] text-sm truncate">{a.title}</span>
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">{format(new Date(a.date + "T00:00:00"), "dd/MM", { locale: ptBR })}</span>
                          </div>
                          {a.client_name && <span className="text-xs text-muted-foreground truncate">Cliente: {a.client_name}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AdminDashboard({ user }: { user: any }) {
  const isAdmin = true;
  const filters = useDashboardFilters();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [editingAtendimento, setEditingAtendimento] = useState<any | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, atendimento: any } | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertPreFill, setInsertPreFill] = useState<any | null>(null);
  const [newAppointmentData, setNewAppointmentData] = useState<any | null>(null);
  const [brokerSearch, setBrokerSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"graficos" | "corretores" | "atendimentos">("graficos");
  const [registrarVendaAtendimento, setRegistrarVendaAtendimento] = useState<any | null>(null);
  const [kpiModal, setKpiModal] = useState<null | "vendas" | "tratativas" | "volume">(null);

  const brokersQ = useBrokers({ select: "*", includeInactive: true });

  const teamBrokerIds = (brokersQ.data ?? []).map((b) => b.id);

  const filteredBrokers = useMemo(() => {
    return (brokersQ.data ?? []).filter(b => b.full_name.toLowerCase().includes(brokerSearch.toLowerCase()));
  }, [brokersQ.data, brokerSearch]);

  const { data: atendimentos = [], isPending } = useQuery({
    queryKey: ["dashboard-atendimentos", filters.appliedStartDate, filters.appliedEndDate, filters.appliedBrokerId, user?.id, teamBrokerIds.join(",")],
    queryFn: async () => {
      const dateFilter = `and(data.gte.${filters.appliedStartDate},data.lte.${filters.appliedEndDate}),and(data_atualizacao.gte.${filters.appliedStartDate},data_atualizacao.lte.${filters.appliedEndDate},venda.eq.false)`;

      if (filters.appliedBrokerId !== "all") {
        const { data, error } = await supabase
          .from("atendimentos")
          .select("*, profiles(full_name, color)")
          .eq("broker_id", filters.appliedBrokerId)
          .or(dateFilter);
        if (error) throw error;
        return data ?? [];
      }

      if (teamBrokerIds.length === 0) return [];

      const { data, error } = await supabase
        .from("atendimentos")
        .select("*, profiles(full_name, color)")
        .in("broker_id", teamBrokerIds)
        .or(dateFilter);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && Array.isArray(brokersQ.data),
  });

  const { data: vendas = [] } = useQuery({
    queryKey: ["dashboard-vendas", filters.appliedStartDate, filters.appliedEndDate, filters.appliedBrokerId, teamBrokerIds.join(",")],
    queryFn: async () => {
      const ids = filters.appliedBrokerId !== "all" ? [filters.appliedBrokerId] : teamBrokerIds;
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("vendas")
        .select("*")
        .in("broker_id", ids)
        .eq("status", "approved")
        .gte("data_venda", filters.appliedStartDate)
        .lte("data_venda", filters.appliedEndDate);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && Array.isArray(brokersQ.data),
  });

  const dbData = useDashboardData(atendimentos, vendas);

  const atendimentosById = useMemo(() => {
    const m: Record<string, any> = {};
    atendimentos.forEach(a => { m[a.id] = a; });
    return m;
  }, [atendimentos]);

  const brokersById = useMemo(() => {
    const m: Record<string, string> = {};
    (brokersQ.data ?? []).forEach(b => { m[b.id] = b.full_name; });
    return m;
  }, [brokersQ.data]);

  const vendasModalItems = useMemo(() =>
    vendas.map(v => {
      const atend = atendimentosById[v.atendimento_id];
      return {
        cliente: atend?.nome_cliente || "—",
        corretor: brokersById[v.broker_id] || atend?.profiles?.full_name || "—",
        unidade: atend?.produto || "—",
        valor: Number(v.valor) || 0,
      };
    }),
    [vendas, atendimentosById, brokersById]
  );

  const tratativasModalItems = useMemo(() =>
    atendimentos
      .filter(a => a.status === "Em Tratativa")
      .map(a => ({
        cliente: a.nome_cliente || "—",
        corretor: a.profiles?.full_name || brokersById[a.broker_id] || "—",
        unidade: a.produto || "—",
        valor: Number(a.valor) || 0,
      })),
    [atendimentos, brokersById]
  );

  const projectsQ = useQuery({
    queryKey: ["projects-for-dashboard"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name, city").eq("is_active", true);
      return (data ?? []) as { id: string; name: string; city: string }[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const statusCounts = useMemo(() =>
    STATUSES.map((s) => {
      const filtered = atendimentos.filter((a) => a.status === s);
      const totalValor = filtered.reduce((acc, a) => acc + (Number(a.valor) || 0), 0);
      return { 
        name: s, 
        count: filtered.length,
        Valor: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalValor)
      };
    }),
    [atendimentos]
  );

  const visitsByProduct = useMemo(() => {
    const projects = projectsQ.data ?? [];
    const map: Record<string, { total: number; visitas: number }> = {};
    atendimentos.forEach((a) => {
      if (!a.produto) return;
      const key = matchProjectName(a.produto, projects);
      if (!map[key]) map[key] = { total: 0, visitas: 0 };
      map[key].total++;
      if (a.visita) map[key].visitas++;
    });
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.visitas - a.visitas || b.total - a.total);
  }, [atendimentos, projectsQ.data]);

  const brokerPerformance = useMemo(() => {
    if (!isAdmin) return [];
    const map: Record<string, any> = {};

    (brokersQ.data ?? []).forEach(b => {
      map[b.id] = {
        broker: b, total: 0, visitas: 0, vendas: 0, tratativas: 0, volume: 0, monthly: {},
        statusCounts: Object.fromEntries(STATUSES.map(s => [s, 0]))
      };
    });

    atendimentos.forEach(a => {
      if (!map[a.broker_id]) return;
      const b = map[a.broker_id];
      b.total++;
      if (a.visita) b.visitas++;
      if (a.status && STATUSES.includes(a.status)) b.statusCounts[a.status]++;
      if (a.status === "Em Tratativa") b.tratativas += Number(a.valor) || 0;
      b.monthly[a.data.slice(0, 7)] = (b.monthly[a.data.slice(0, 7)] || 0) + 1;
    });

    // Sales count and volume come from the vendas table
    vendas.forEach(v => {
      if (!map[v.broker_id]) return;
      map[v.broker_id].vendas++;
      map[v.broker_id].volume += Number(v.valor) || 0;
    });

    return Object.values(map).map(b => {
      const conversao = b.total > 0 ? (b.vendas / b.total) * 100 : 0;
      const sparkline = Object.entries(b.monthly).sort((a, b) => a[0].localeCompare(b[0])).map(([m, count]) => ({ name: m, count }));
      return { ...b, conversao, sparkline };
    }).sort((a, b) => b.total - a.total);
  }, [atendimentos, vendas, brokersQ.data, isAdmin]);

  const selectedBroker = filters.brokerId === "all" ? null : brokersQ.data?.find(b => b.id === filters.brokerId);

  const handleExport = () => {
    if (atendimentos.length === 0) {
      toast.error("Nenhum atendimento para exportar.");
      return;
    }

    const headers = [
      "Data", "Corretor", "Nome do Cliente", "Telefone", "E-mail", "ID do Cliente", "Produto",
      "Ocorrência", "Setor", "Visita", "Venda", "Temperatura", "Status", "Valor"
    ];

    const rows = atendimentos.map(a => {
      const corretor = (a.profiles as any)?.full_name || "";
      const dateStr = a.data ? format(new Date(a.data + "T00:00:00"), "dd/MM/yyyy") : "";
      return [
        dateStr, corretor, a.nome_cliente || "", a.telefone || "", a.email || "",
        a.id_cliente || "", a.produto || "", a.ocorrencia || "", a.setor || "",
        a.visita ? "Sim" : "Não", a.venda ? "Sim" : "Não", a.temperatura || "",
        a.status || "", a.valor || 0
      ];
    });

    const csvContent = [
      headers.join(";"),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `atendimentos_${format(new Date(), "yyyyMMdd_HHmmss")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--surface)] pb-nav overflow-hidden">
      <div className="flex-shrink-0">
        <AppHeader 
          title="Dashboard" 
          right={<NotificationBell user={user} onSelect={(appt) => {
            setInsertPreFill({
              appointment_id: appt.id,
              nome_cliente: appt.client_name || "",
              email: appt.client_email || "",
              id_cliente: appt.client_id || "",
              broker_id: user.id
            });
            setInsertOpen(true);
          }} />} 
        />
      </div>

      {/* FILTER BAR */}
      <div className="bg-white px-4 py-3 border-b border-border z-20 shadow-sm flex items-center gap-3 flex-wrap flex-shrink-0">
        <DateRangePicker
          startDate={filters.startDate}
          endDate={filters.endDate}
          onApply={filters.applyDateRange}
          className="flex-1 min-w-[220px]"
        />
        {isAdmin && (
          <div className="relative flex-1 min-w-[180px]">
            <button onClick={() => setIsDropdownOpen(!isDropdownOpen)} className="w-full h-10 px-3 rounded-lg border border-border text-sm flex items-center justify-between bg-white text-left">
              {selectedBroker ? (
                <div className="flex items-center gap-2"><MiniAvatar name={selectedBroker.full_name} color={selectedBroker.color} /><span className="truncate">{selectedBroker.full_name}</span></div>
              ) : <span className="text-muted-foreground">Todos os corretores</span>}
              <ChevronDown size={14} className="text-muted-foreground ml-2 flex-shrink-0" />
            </button>
            {isDropdownOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setIsDropdownOpen(false)} />
                <div className="absolute top-[44px] left-0 w-full bg-white border border-border rounded-lg shadow-xl z-40 max-h-[320px] overflow-hidden flex flex-col py-1">
                  <div className="p-2 border-b border-border flex-shrink-0">
                    <input 
                      type="text" 
                      placeholder="Buscar corretor..." 
                      className="w-full h-9 px-3 rounded-lg bg-[var(--surface)] border border-border text-sm outline-none focus:border-[var(--gold)]"
                      value={brokerSearch}
                      onChange={(e) => setBrokerSearch(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="overflow-y-auto flex-1 py-1">
                    <button onClick={() => { filters.setBrokerId("all"); setIsDropdownOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--surface)] ${filters.brokerId === "all" ? "bg-[var(--surface)] font-semibold" : ""}`}>Todos os corretores</button>
                    {filteredBrokers.map(b => (
                      <button key={b.id} onClick={() => { filters.setBrokerId(b.id); setIsDropdownOpen(false); }} className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-[var(--surface)] ${filters.brokerId === b.id ? "bg-[var(--surface)] font-semibold" : ""}`}>
                        <MiniAvatar name={b.full_name} color={b.color} /><span className="truncate">{b.full_name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="px-4 py-3 flex items-center gap-2 overflow-x-auto hide-scrollbar border-b border-border bg-white z-10 flex-shrink-0">
        <button onClick={() => setActiveTab("graficos")} className={`h-9 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${activeTab === "graficos" ? "bg-[var(--navy)] text-white" : "bg-[var(--surface)] text-[var(--navy)] hover:bg-gray-100"}`}>Gráficos</button>
        <button onClick={() => setActiveTab("corretores")} className={`h-9 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${activeTab === "corretores" ? "bg-[var(--navy)] text-white" : "bg-[var(--surface)] text-[var(--navy)] hover:bg-gray-100"}`}>Desempenho por Corretor</button>
        <button onClick={() => setActiveTab("atendimentos")} className={`h-9 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${activeTab === "atendimentos" ? "bg-[var(--navy)] text-white" : "bg-[var(--surface)] text-[var(--navy)] hover:bg-gray-100"}`}>Atendimentos</button>
      </div>

      <div className="px-4 pt-4 pb-4 flex-1 overflow-y-auto space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 flex-shrink-0">
          <KpiCard label="Total de Atendimentos" value={dbData.totalAtendimentos} isLoading={isPending} />
          <KpiCard label="Total de Visitas" value={dbData.totalVisitas} isLoading={isPending} />
          <KpiCard label="Total de Vendas" value={dbData.totalVendas} isLoading={isPending} onClick={() => setKpiModal("vendas")} />
          <KpiCard label="Em Tratativas" value={formatBRL(dbData.emTratativas)} isLoading={isPending} onClick={() => setKpiModal("tratativas")} />
          <KpiCard label="Volume de Vendas" value={formatBRL(dbData.volumeVendas)} isLoading={isPending} onClick={() => setKpiModal("volume")} />
        </div>

        {activeTab === "graficos" && (
          <>
            {isPending ? (
              <div className="space-y-3">
                {[1,2,3,4].map(i => <div key={i} className="h-48 rounded-2xl bg-gray-100 animate-pulse" />)}
              </div>
            ) : (
              <>
                <DashboardCharts dbData={dbData} />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <StatusChart data={statusCounts} />
                  <VisitsByProductChart data={visitsByProduct} />
                </div>
              </>
            )}
          </>
        )}

        {activeTab === "corretores" && (
          <div className="space-y-4">
            {isPending ? (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {[1,2,3,4,5,6].map(i => <div key={i} className="h-64 rounded-2xl bg-gray-100 animate-pulse" />)}
              </div>
            ) : brokerPerformance.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nenhum corretor encontrado no período.</p>
            ) : (
              <div className={`grid gap-4 ${filters.appliedBrokerId !== 'all' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
                {brokerPerformance.filter(b => filters.appliedBrokerId === 'all' || b.broker.id === filters.appliedBrokerId).map(bp => (
                  <BrokerPerformanceCard key={bp.broker.id} bp={bp} />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "atendimentos" && (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-xl font-bold text-[var(--navy)]">Visão Geral dos Atendimentos</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={handleExport} className="h-9 px-4 rounded-xl bg-white border border-border text-[var(--navy)] font-semibold text-sm flex items-center gap-1.5 cursor-pointer hover:bg-[var(--surface)] transition-colors">
                  <Download size={14} /> Exportar Planilha
                </button>
                <CsvImportButton brokers={brokersQ.data ?? []} />
                <button
                  onClick={() => { setInsertPreFill(null); setInsertOpen(true); }}
                  className="h-9 px-4 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold text-sm flex items-center gap-1.5"
                >
                  <Plus size={14} strokeWidth={2.5} /> Novo Cliente
                </button>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-border shadow-sm">
              {isPending ? (
                <div className="p-4 space-y-3">
                  {[1,2,3,4,5,6,7,8].map(i => (
                    <div key={i} className="flex gap-3">
                      <div className="h-4 w-20 rounded bg-gray-100 animate-pulse" />
                      <div className="h-4 flex-1 rounded bg-gray-100 animate-pulse" />
                      <div className="h-4 w-24 rounded bg-gray-100 animate-pulse" />
                      <div className="h-4 w-16 rounded bg-gray-100 animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : (
                <AtendimentosTable
                  atendimentos={atendimentos}
                  isAdmin={isAdmin}
                  onRowClick={(a) => setEditingAtendimento(a)}
                  onRowContextMenu={(e: any, a: any) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, atendimento: a });
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
          <div className="fixed z-50 bg-white border border-border shadow-xl rounded-lg py-1 w-48" style={{ top: contextMenu.y, left: contextMenu.x }}>
            <button
              className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--surface)] text-[var(--navy)] flex items-center gap-2"
              onClick={() => { setInsertPreFill(contextMenu.atendimento); setInsertOpen(true); setContextMenu(null); }}
            >
              <Plus size={14} /> Novo Atendimento
            </button>
            <button
              className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--surface)] text-[var(--navy)] flex items-center gap-2"
              onClick={() => {
                setNewAppointmentData({
                  client_name: contextMenu.atendimento.nome_cliente,
                  client_id: contextMenu.atendimento.id_cliente,
                  client_email: contextMenu.atendimento.email,
                });
                setContextMenu(null);
              }}
            >
              <Calendar size={14} /> Novo Agendamento
            </button>
            <button
              className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--surface)] text-green-700 flex items-center gap-2"
              onClick={() => { setRegistrarVendaAtendimento(contextMenu.atendimento); setContextMenu(null); }}
            >
              <DollarSign size={14} /> Registrar Venda
            </button>
          </div>
        </>
      )}

      {editingAtendimento && (
        <AtendimentoEditForm
          atendimento={editingAtendimento}
          onClose={() => setEditingAtendimento(null)}
          onScheduleVisit={() => {
            setNewAppointmentData({
              client_name: editingAtendimento.nome_cliente,
              client_id: editingAtendimento.id_cliente,
              client_email: editingAtendimento.email,
            });
            setEditingAtendimento(null);
          }}
          onRegistrarVenda={() => { setRegistrarVendaAtendimento(editingAtendimento); setEditingAtendimento(null); }}
        />
      )}
      {insertOpen && <AtendimentoForm userId={user?.id} brokers={brokersQ.data ?? []} onClose={() => { setInsertOpen(false); setInsertPreFill(null); }} preFill={insertPreFill} />}
      {newAppointmentData && <AppointmentForm appt={null} preFill={newAppointmentData} onClose={() => setNewAppointmentData(null)} />}
      {registrarVendaAtendimento && <RegistrarVendaModal atendimento={registrarVendaAtendimento} onClose={() => setRegistrarVendaAtendimento(null)} />}
      {kpiModal && (
        <KpiDetailModal
          isAdmin
          title={
            kpiModal === "vendas" ? `Total de Vendas (${vendasModalItems.length})` :
            kpiModal === "tratativas" ? `Em Tratativas (${tratativasModalItems.length})` :
            `Volume de Vendas — ${formatBRL(dbData.volumeVendas)}`
          }
          items={kpiModal === "tratativas" ? tratativasModalItems : vendasModalItems}
          onClose={() => setKpiModal(null)}
        />
      )}
    </div>
  );
}

function BrokerDashboard({ user }: { user: any }) {
  const filters = useDashboardFilters();
  const [insertOpen, setInsertOpen] = useState(false);
  const [editingAtendimento, setEditingAtendimento] = useState<any | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, atendimento: any } | null>(null);
  const [insertPreFill, setInsertPreFill] = useState<any | null>(null);
  const [newAppointmentData, setNewAppointmentData] = useState<any | null>(null);
  const [registrarVendaAtendimento, setRegistrarVendaAtendimento] = useState<any | null>(null);
  const [kpiModal, setKpiModal] = useState<null | "vendas" | "tratativas" | "volume">(null);

  const { data: atendimentos = [], isPending } = useQuery({
    queryKey: ["dashboard-atendimentos", filters.appliedStartDate, filters.appliedEndDate, "broker", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("atendimentos")
        .select("*, profiles(full_name, color)")
        .eq("broker_id", user!.id)
        .gte("data", filters.appliedStartDate)
        .lte("data", filters.appliedEndDate);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: vendas = [] } = useQuery({
    queryKey: ["dashboard-vendas", filters.appliedStartDate, filters.appliedEndDate, "broker", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendas")
        .select("*")
        .eq("broker_id", user!.id)
        .eq("status", "approved")
        .gte("data_venda", filters.appliedStartDate)
        .lte("data_venda", filters.appliedEndDate);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const dbData = useDashboardData(atendimentos, vendas);

  const atendimentosById = useMemo(() => {
    const m: Record<string, any> = {};
    atendimentos.forEach(a => { m[a.id] = a; });
    return m;
  }, [atendimentos]);

  const vendasModalItems = useMemo(() =>
    vendas.map(v => {
      const atend = atendimentosById[v.atendimento_id];
      return {
        cliente: atend?.nome_cliente || "—",
        unidade: atend?.produto || "—",
        valor: Number(v.valor) || 0,
      };
    }),
    [vendas, atendimentosById]
  );

  const tratativasModalItems = useMemo(() =>
    atendimentos
      .filter(a => a.status === "Em Tratativa")
      .map(a => ({
        cliente: a.nome_cliente || "—",
        unidade: a.produto || "—",
        valor: Number(a.valor) || 0,
      })),
    [atendimentos]
  );

  return (
    <div className="pb-nav bg-[var(--surface)] min-h-screen">
        <AppHeader 
          title="Dashboard" 
          right={<NotificationBell user={user} onSelect={(appt) => {
            setInsertPreFill({
              appointment_id: appt.id,
              nome_cliente: appt.client_name || "",
              email: appt.client_email || "",
              id_cliente: appt.client_id || "",
              broker_id: user.id
            });
            setInsertOpen(true);
          }} />} 
        />
      <div className="bg-white px-4 py-3 border-b border-border sticky top-[56px] z-20 shadow-sm flex items-center gap-3 flex-wrap">
        <DateRangePicker startDate={filters.startDate} endDate={filters.endDate} onApply={filters.applyDateRange} className="flex-1 min-w-[220px]" />
      </div>

      <div className="px-4 pt-4 pb-8 space-y-6">
        <div className="grid grid-cols-2 gap-3">
          <KpiCard label="Total de Atendimentos" value={dbData.totalAtendimentos} isLoading={isPending} />
          <KpiCard label="Total de Visitas" value={dbData.totalVisitas} isLoading={isPending} />
          <KpiCard label="Total de Vendas" value={dbData.totalVendas} isLoading={isPending} onClick={() => setKpiModal("vendas")} />
          <KpiCard label="Em Tratativas" value={formatBRL(dbData.emTratativas)} isLoading={isPending} onClick={() => setKpiModal("tratativas")} />
          <div className="col-span-2"><KpiCard label="Volume de Vendas" value={formatBRL(dbData.volumeVendas)} isLoading={isPending} onClick={() => setKpiModal("volume")} /></div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-[var(--navy)]">Visão Geral dos Atendimentos</h2>
            <button onClick={() => { setInsertPreFill(null); setInsertOpen(true); }} className="h-9 px-4 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold text-sm flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.5} /> Inserir
            </button>
          </div>
          <div className="bg-white rounded-xl border border-border shadow-sm">
            {isPending ? (
              <div className="p-4 space-y-3">
                {[1,2,3,4,5,6,7,8].map(i => (
                  <div key={i} className="flex gap-3">
                    <div className="h-4 w-20 rounded bg-gray-100 animate-pulse" />
                    <div className="h-4 flex-1 rounded bg-gray-100 animate-pulse" />
                    <div className="h-4 w-24 rounded bg-gray-100 animate-pulse" />
                    <div className="h-4 w-16 rounded bg-gray-100 animate-pulse" />
                  </div>
                ))}
              </div>
            ) : (
              <AtendimentosTable
                atendimentos={atendimentos}
                isAdmin={false}
                onRowClick={(a) => setEditingAtendimento(a)}
                onRowContextMenu={(e: any, a: any) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, atendimento: a });
                }}
              />
            )}
          </div>
        </div>
      </div>

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
          <div className="fixed z-50 bg-white border border-border shadow-xl rounded-lg py-1 w-48" style={{ top: contextMenu.y, left: contextMenu.x }}>
            <button
              className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--surface)] text-[var(--navy)] flex items-center gap-2"
              onClick={() => { setInsertPreFill(contextMenu.atendimento); setInsertOpen(true); setContextMenu(null); }}
            >
              <Plus size={14} /> Novo Atendimento
            </button>
            <button
              className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--surface)] text-[var(--navy)] flex items-center gap-2"
              onClick={() => {
                setNewAppointmentData({
                  client_name: contextMenu.atendimento.nome_cliente,
                  client_id: contextMenu.atendimento.id_cliente,
                  client_email: contextMenu.atendimento.email,
                });
                setContextMenu(null);
              }}
            >
              <Calendar size={14} /> Novo Agendamento
            </button>
            <button
              className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--surface)] text-green-700 flex items-center gap-2"
              onClick={() => { setRegistrarVendaAtendimento(contextMenu.atendimento); setContextMenu(null); }}
            >
              <DollarSign size={14} /> Registrar Venda
            </button>
          </div>
        </>
      )}
      {insertOpen && <AtendimentoForm userId={user?.id} onClose={() => { setInsertOpen(false); setInsertPreFill(null); }} preFill={insertPreFill} />}
      {editingAtendimento && (
        <AtendimentoEditForm
          atendimento={editingAtendimento}
          onClose={() => setEditingAtendimento(null)}
          onScheduleVisit={() => {
            setNewAppointmentData({
              client_name: editingAtendimento.nome_cliente,
              client_id: editingAtendimento.id_cliente,
              client_email: editingAtendimento.email,
            });
            setEditingAtendimento(null);
          }}
          onRegistrarVenda={() => { setRegistrarVendaAtendimento(editingAtendimento); setEditingAtendimento(null); }}
        />
      )}
      {newAppointmentData && <AppointmentForm appt={null} preFill={newAppointmentData} onClose={() => setNewAppointmentData(null)} />}
      {registrarVendaAtendimento && <RegistrarVendaModal atendimento={registrarVendaAtendimento} onClose={() => setRegistrarVendaAtendimento(null)} />}
      {kpiModal && (
        <KpiDetailModal
          title={
            kpiModal === "vendas" ? `Total de Vendas (${vendasModalItems.length})` :
            kpiModal === "tratativas" ? `Em Tratativas (${tratativasModalItems.length})` :
            `Volume de Vendas — ${formatBRL(dbData.volumeVendas)}`
          }
          items={kpiModal === "tratativas" ? tratativasModalItems : vendasModalItems}
          onClose={() => setKpiModal(null)}
        />
      )}
    </div>
  );
}

function AtendimentoEditForm({ atendimento, onClose, onScheduleVisit, onRegistrarVenda }: { atendimento: any; onClose: () => void; onScheduleVisit?: () => void; onRegistrarVenda?: () => void }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [nomeCliente, setNomeCliente] = useState(atendimento.nome_cliente ?? "");
  const [telefone, setTelefone] = useState(atendimento.telefone ?? "");
  const [email, setEmail] = useState(atendimento.email ?? "");
  const [idCliente, setIdCliente] = useState(atendimento.id_cliente ?? "");
  const [produto, setProduto] = useState(atendimento.produto ?? "");
  const [ocorrencia, setOcorrencia] = useState(atendimento.ocorrencia ?? "");
  const [visita, setVisita] = useState(atendimento.visita ?? false);
  const [venda, setVenda] = useState(atendimento.venda ?? false);
  const [temperatura, setTemperatura] = useState(atendimento.temperatura ?? "");
  const [status, setStatus] = useState(atendimento.status ?? "");
  const [valor, setValor] = useState(atendimento.valor ? String(atendimento.valor) : "");
  const dataAtualizacao = (atendimento.data_atualizacao ?? "") as string;

  const projectsQ = useQuery({
    queryKey: ["projects-active"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id,name,tem_plantao").eq("is_active", true).order("name");
      return (data ?? []) as { id: string; name: string; tem_plantao?: boolean }[];
    },
  });

  const selectedProjectObj = (projectsQ.data ?? []).find(p => p.name === produto);

  const save = useMutation({
    mutationFn: async () => {
      const isVenda = venda || atendimento.venda;
      const { error } = await supabase
        .from("atendimentos")
        .update({
          nome_cliente: nomeCliente || null,
          telefone: telefone || null,
          email: email || null,
          id_cliente: idCliente || null,
          produto: produto || null,
          ocorrencia: ocorrencia || null,
          visita,
          venda,
          temperatura: temperatura || null,
          status: status || null,
          valor: valor ? parseFloat(valor.replace(",", ".")) : null,
          data_atualizacao: !isVenda ? (dataAtualizacao || format(new Date(), "yyyy-MM-dd")) : null,
        })
        .eq("id", atendimento.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard-atendimentos"] });
      toast.success("Atendimento atualizado!");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("atendimentos").delete().eq("id", atendimento.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard-atendimentos"] });
      toast.success("Atendimento excluído!");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const fieldCls = "w-full h-11 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm";

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={onClose}>
      <div
        className="bg-white w-full rounded-t-2xl flex flex-col safe-bottom"
        style={{ maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border flex-shrink-0">
          <div>
            <h3 className="text-base font-semibold text-[var(--navy)]">Visualizar Cliente</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{nomeCliente || "Cliente não identificado"}</p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="p-4 rounded-xl bg-gray-50 border border-border space-y-2 mb-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground font-medium">Cadastro</span>
              <span className="text-sm font-medium text-[var(--navy)]">{atendimento.data ? format(new Date(atendimento.data + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR }) : ""}</span>
            </div>
            {!venda && (
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground font-medium">Atualização</span>
                <span className="text-sm font-medium text-[var(--navy)]">
                  {dataAtualizacao ? format(new Date(dataAtualizacao + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR }) : "—"}
                </span>
              </div>
            )}
            {atendimento.setor && (
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-muted-foreground font-medium">Setor</span>
                <span className="text-sm font-medium text-[var(--navy)]">{atendimento.setor}</span>
              </div>
            )}
            {selectedProjectObj?.tem_plantao && (
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-muted-foreground font-medium">Plantão</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Tem Plantão</span>
              </div>
            )}
          </div>

          <input disabled={!isAdmin} className={`${fieldCls} disabled:opacity-70 disabled:cursor-not-allowed`} placeholder="Nome do cliente *" value={nomeCliente} onChange={(e) => setNomeCliente(e.target.value)} />

          <div className="grid grid-cols-2 gap-2">
            <input disabled={!isAdmin} className={`${fieldCls} disabled:opacity-70 disabled:cursor-not-allowed`} placeholder="Telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            <input disabled={!isAdmin} type="email" className={`${fieldCls} disabled:opacity-70 disabled:cursor-not-allowed`} placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input disabled={!isAdmin} className={`${fieldCls} disabled:opacity-70 disabled:cursor-not-allowed`} placeholder="ID do cliente" value={idCliente} onChange={(e) => setIdCliente(e.target.value)} />
            <select className={`${fieldCls} text-[var(--navy)]`} value={produto} onChange={(e) => setProduto(e.target.value)}>
              <option value="">Produto...</option>
              {(projectsQ.data ?? []).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>

          <input className={fieldCls} placeholder="Ocorrência" value={ocorrencia} onChange={(e) => setOcorrencia(e.target.value)} />

          <div className="grid grid-cols-2 gap-2">
            <label className={`flex items-center justify-between px-4 py-3 rounded-xl border cursor-pointer select-none ${visita ? "bg-blue-50 border-blue-200" : "bg-[var(--surface)] border-border"}`}>
              <span className="text-sm font-medium text-[var(--navy)]">Visita</span>
              <input type="checkbox" checked={visita} onChange={(e) => setVisita(e.target.checked)} className="w-5 h-5 accent-[var(--gold)]" />
            </label>
            <label className={`flex items-center justify-between px-4 py-3 rounded-xl border cursor-pointer select-none ${venda ? "bg-green-50 border-green-200" : "bg-[var(--surface)] border-border"}`}>
              <span className="text-sm font-medium text-[var(--navy)]">Venda</span>
              <input type="checkbox" checked={venda} onChange={(e) => setVenda(e.target.checked)} className="w-5 h-5 accent-[var(--gold)]" />
            </label>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Temperatura</label>
            <div className="grid grid-cols-3 gap-2">
              {TEMPERATURAS.map((t) => (
                <button key={t} type="button" onClick={() => setTemperatura(temperatura === t ? "" : t)}
                  className={`h-10 rounded-xl text-sm font-semibold transition-colors ${temperatura === t ? "bg-[var(--navy)] text-white" : "bg-[var(--surface)] text-[var(--navy)] border border-border"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Status</label>
            <select className={fieldCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Selecione...</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <input className={fieldCls} placeholder="Valor (R$)" value={valor} onChange={(e) => setValor(e.target.value)} />
        </div>

        <div className="px-5 pb-5 pt-3 border-t border-border flex gap-2 flex-shrink-0 items-center flex-wrap">
          {isAdmin && (
            <button
              onClick={() => {
                if (window.confirm("Deseja realmente excluir este atendimento?")) {
                  del.mutate();
                }
              }}
              className="h-12 w-12 flex-shrink-0 rounded-xl bg-red-50 text-red-600 flex items-center justify-center"
              title="Excluir"
            >
              <Trash2 size={20} />
            </button>
          )}
          {onScheduleVisit && (
            <button
              type="button"
              onClick={onScheduleVisit}
              className="h-12 w-12 flex-shrink-0 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"
              title="Agendar nova visita"
            >
              <Calendar size={20} />
            </button>
          )}
          {onRegistrarVenda && (
            <button
              type="button"
              onClick={onRegistrarVenda}
              className="h-12 px-3 flex-shrink-0 rounded-xl bg-green-50 text-green-700 font-semibold text-sm flex items-center gap-1.5"
              title="Registrar venda"
            >
              <DollarSign size={16} /> Venda
            </button>
          )}
          <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">Cancelar</button>
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50">
            {save.isPending ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AtendimentoForm({ userId, onClose, preFill, brokers }: { userId: string; onClose: () => void; preFill?: any; brokers?: { id: string; full_name: string }[] }) {
  const qc = useQueryClient();
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [selectedBrokerId, setSelectedBrokerId] = useState(preFill?.broker_id || "");
  const targetUserId = selectedBrokerId || preFill?.broker_id || userId;

  const [linkedApptId, setLinkedApptId] = useState(preFill?.appointment_id || "");
  const [data, setData] = useState(todayStr);
  const [nomeCliente, setNomeCliente] = useState(preFill?.nome_cliente || "");
  const [telefone, setTelefone] = useState(preFill?.telefone || "");
  const [emailCliente, setEmailCliente] = useState(preFill?.email || "");
  const [idCliente, setIdCliente] = useState(preFill?.id_cliente || "");
  const [produto, setProduto] = useState(preFill?.produto || "");
  const [ocorrencia, setOcorrencia] = useState("");
  const [setor, setSetor] = useState("");
  const [visita, setVisita] = useState(false);
  const [venda, setVenda] = useState(false);
  const [temperatura, setTemperatura] = useState("");
  const [status, setStatus] = useState("");
  const [valor, setValor] = useState("");

  const projectsQ = useQuery({
    queryKey: ["projects-active"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id,name").eq("is_active", true).order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const apptsQ = useQuery({
    queryKey: ["broker-past-appts", targetUserId],
    queryFn: async () => {
      const { data } = await supabase.from("appointments").select("*")
        .eq("owner_id", targetUserId).lte("date", todayStr).order("date", { ascending: false }).limit(50);
      return data ?? [];
    },
    enabled: !!targetUserId,
  });

  const linkedIdsQ = useQuery({
    queryKey: ["linked-appt-ids", targetUserId],
    queryFn: async () => {
      const { data } = await supabase.from("atendimentos")
        .select("appointment_id").eq("broker_id", targetUserId).not("appointment_id", "is", null);
      return (data ?? []).map((a: any) => a.appointment_id).filter(Boolean) as string[];
    },
    enabled: !!targetUserId,
  });

  const availableAppts = useMemo(() =>
    (apptsQ.data ?? []).filter((a) => !(linkedIdsQ.data ?? []).includes(a.id)),
    [apptsQ.data, linkedIdsQ.data]
  );

  const handleApptSelect = (apptId: string) => {
    setLinkedApptId(apptId);
    const appt = availableAppts.find((a) => a.id === apptId);
    if (appt) {
      setData(appt.date);
      if (appt.client_name) setNomeCliente(appt.client_name);
      if (appt.client_email) setEmailCliente(appt.client_email);
      if (appt.client_id) setIdCliente(appt.client_id);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        broker_id: targetUserId,
        appointment_id: linkedApptId || null,
        data,
        nome_cliente: nomeCliente,
        telefone: telefone || null,
        email: emailCliente || null,
        id_cliente: idCliente || null,
        produto: produto || null,
        ocorrencia: ocorrencia || null,
        setor: setor || null,
        visita,
        venda,
        temperatura: temperatura || null,
        status: status || null,
        valor: valor ? parseFloat(valor.replace(",", ".")) : null,
      };

      if (idCliente) {
        const { data: existing } = await supabase.from("atendimentos")
          .select("id, venda, status, data")
          .eq("id_cliente", idCliente)
          .eq("broker_id", targetUserId)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existing && !existing.venda && existing.status !== "Contrato Assinado") {
          const { error } = await supabase.from("atendimentos").update({ ...payload, data: existing.data, data_atualizacao: format(new Date(), "yyyy-MM-dd") }).eq("id", existing.id);
          if (error) throw error;
          return;
        }
      }

      const { error } = await supabase.from("atendimentos").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard-atendimentos"] });
      toast.success("Atendimento registrado!");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 overflow-y-auto" onClick={onClose}>
      <div className="bg-white w-full min-h-screen sm:min-h-0 sm:max-w-md sm:mx-auto sm:mt-8 sm:rounded-2xl p-5 safe-top safe-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--navy)]">Inserir Atendimento</h3>
          <button onClick={onClose} className="text-muted-foreground text-sm">Fechar</button>
        </div>
        <div className="space-y-3">
          {brokers && brokers.length > 0 && (
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Corretor *</label>
              <select
                className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm text-[var(--navy)]"
                value={selectedBrokerId}
                onChange={(e) => setSelectedBrokerId(e.target.value)}
              >
                <option value="">Selecione o corretor...</option>
                {brokers.map((b) => (
                  <option key={b.id} value={b.id}>{b.full_name}</option>
                ))}
              </select>
            </div>
          )}
          {availableAppts.length > 0 && (
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Puxar agendamento (opcional)</label>
              <select className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm text-[var(--navy)]" value={linkedApptId} onChange={(e) => handleApptSelect(e.target.value)}>
                <option value="">Nenhum — registro manual</option>
                {availableAppts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {format(new Date(a.date + "T00:00:00"), "dd/MM", { locale: ptBR })} — {a.title}{a.client_name ? ` (${a.client_name})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <input type="date" className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm" value={data} onChange={(e) => setData(e.target.value)} />
          <input className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm" placeholder="Nome do cliente *" value={nomeCliente} onChange={(e) => setNomeCliente(e.target.value)} />

          <div className="grid grid-cols-2 gap-2">
            <input className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border text-sm" placeholder="Telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            <input type="email" className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border text-sm" placeholder="E-mail" value={emailCliente} onChange={(e) => setEmailCliente(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border text-sm" placeholder="ID do cliente" value={idCliente} onChange={(e) => setIdCliente(e.target.value)} />
            <select className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border text-sm text-[var(--navy)]" value={produto} onChange={(e) => setProduto(e.target.value)}>
              <option value="">Produto...</option>
              {(projectsQ.data ?? []).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>

          <input className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm" placeholder="Ocorrência" value={ocorrencia} onChange={(e) => setOcorrencia(e.target.value)} />

          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Setor</label>
            <div className="grid grid-cols-2 gap-2">
              {SETORES.map((s) => (
                <button key={s} onClick={() => setSetor(setor === s ? "" : s)}
                  className={`h-10 rounded-xl text-sm font-semibold transition-colors ${setor === s ? "bg-[var(--navy)] text-white" : "bg-[var(--surface)] text-[var(--navy)] border border-border"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className={`flex items-center justify-between px-4 py-3 rounded-xl border cursor-pointer select-none ${visita ? "bg-blue-50 border-blue-200" : "bg-[var(--surface)] border-border"}`}>
              <span className="text-sm font-medium text-[var(--navy)]">Visita</span>
              <input type="checkbox" checked={visita} onChange={(e) => setVisita(e.target.checked)} className="w-5 h-5 accent-[var(--gold)]" />
            </label>
            <label className={`flex items-center justify-between px-4 py-3 rounded-xl border cursor-pointer select-none ${venda ? "bg-green-50 border-green-200" : "bg-[var(--surface)] border-border"}`}>
              <span className="text-sm font-medium text-[var(--navy)]">Venda</span>
              <input type="checkbox" checked={venda} onChange={(e) => setVenda(e.target.checked)} className="w-5 h-5 accent-[var(--gold)]" />
            </label>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Temperatura</label>
            <div className="grid grid-cols-3 gap-2">
              {TEMPERATURAS.map((t) => (
                <button key={t} onClick={() => setTemperatura(temperatura === t ? "" : t)}
                  className={`h-10 rounded-xl text-sm font-semibold transition-colors ${temperatura === t ? "bg-[var(--navy)] text-white" : "bg-[var(--surface)] text-[var(--navy)] border border-border"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Status</label>
            <select className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm text-[var(--navy)]" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Selecione...</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <input className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm" placeholder="Valor (R$)" value={valor} onChange={(e) => setValor(e.target.value)} />

          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">Cancelar</button>
            <button onClick={() => save.mutate()} disabled={!nomeCliente || save.isPending}
              className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50">
              {save.isPending ? "Salvando..." : "Registrar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BrokerPerformanceCard({ bp }: { bp: any }) {
  return (
    <Link to="/dashboard/corretor/$id" params={{ id: bp.broker.id }} className="bg-white p-4 rounded-2xl shadow-sm border border-border block hover:border-[var(--gold)] transition-colors group h-full flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <MiniAvatar name={bp.broker.full_name} color={bp.broker.color} />
        <div>
          <div className="font-bold text-[var(--navy)] text-sm group-hover:text-[var(--gold)] transition-colors">{bp.broker.full_name}</div>
          <div className="text-xs text-muted-foreground">Corretor</div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center mb-4 pb-4 border-b border-gray-100">
        <div><div className="text-[10px] text-muted-foreground uppercase">Atend.</div><div className="font-bold text-[var(--navy)]">{bp.total}</div></div>
        <div><div className="text-[10px] text-muted-foreground uppercase">Visitas</div><div className="font-bold text-[var(--navy)]">{bp.visitas}</div></div>
        <div><div className="text-[10px] text-muted-foreground uppercase">Vendas</div><div className="font-bold text-[var(--navy)]">{bp.vendas}</div></div>
        <div><div className="text-[10px] text-muted-foreground uppercase">Conv.</div><div className="font-bold text-[var(--navy)]">{bp.conversao.toFixed(1)}%</div></div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-4 text-xs">
        {STATUSES.map(s => (
          <div key={s} className="flex items-center justify-between">
            <span className="text-muted-foreground truncate mr-2" title={s}>{s}</span>
            <span className="font-semibold text-[var(--navy)]">{bp.statusCounts[s]}</span>
          </div>
        ))}
      </div>
      <div className="space-y-1 mt-auto text-sm">
        <div className="h-1.5 w-full bg-gray-100 rounded-full mb-3 mt-1 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(bp.conversao, 100)}%`, backgroundColor: bp.broker.color }} />
        </div>
        <div className="flex justify-between"><span className="text-muted-foreground">Em Tratativas:</span><span className="font-semibold text-[var(--navy)]">{formatBRL(bp.tratativas)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Volume Vendido:</span><span className="font-semibold text-[var(--navy)]">{formatBRL(bp.volume)}</span></div>
      </div>
      {bp.sparkline && bp.sparkline.length > 0 && (
        <div className="h-12 w-full mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bp.sparkline}>
              <Tooltip cursor={{ fill: "transparent" }} contentStyle={{ fontSize: '10px', padding: '4px 8px', borderRadius: '4px' }} />
              <Bar dataKey="count" fill={bp.broker.color} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Link>
  );
}

// ─── Registrar Venda Modal ────────────────────────────────────────────────────

function RegistrarVendaModal({ atendimento, onClose }: { atendimento: any; onClose: () => void }) {
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [dataVenda, setDataVenda] = useState(todayStr);
  const [produto, setProduto] = useState(atendimento.produto ?? "");
  const [unidade, setUnidade] = useState("");
  const [valor, setValor] = useState(atendimento.valor ? String(atendimento.valor) : "");

  const projectsQ = useQuery({
    queryKey: ["projects-active"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id,name").eq("is_active", true).order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const parsedValor = valor ? parseFloat(valor.replace(",", ".")) : null;

      const { error: insertError } = await supabase.from("vendas").insert({
        atendimento_id: atendimento.id,
        broker_id: atendimento.broker_id,
        data_venda: dataVenda,
        produto: produto || null,
        unidade: unidade || null,
        valor: parsedValor,
        status: isAdmin ? "approved" : "pending",
        approved_by: isAdmin ? user?.id : null,
        approved_at: isAdmin ? new Date().toISOString() : null,
      });
      if (insertError) throw insertError;

      // When admin confirms, sync the atendimento flags
      if (isAdmin) {
        const { error: updateError } = await supabase
          .from("atendimentos")
          .update({ venda: true, status: "Contrato Assinado" })
          .eq("id", atendimento.id);
        if (updateError) throw updateError;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard-atendimentos"] });
      qc.invalidateQueries({ queryKey: ["dashboard-vendas"] });
      toast.success(isAdmin ? "Venda registrada!" : "Venda enviada para aprovação do gerente!");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-[var(--navy)] flex items-center gap-2">
              <DollarSign size={18} className="text-green-600" /> Registrar Venda
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">{atendimento.nome_cliente || "Cliente não identificado"}</p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Data da Venda *</label>
            <input
              type="date"
              className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm"
              value={dataVenda}
              onChange={(e) => setDataVenda(e.target.value)}
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Produto *</label>
            <select
              className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm text-[var(--navy)]"
              value={produto}
              onChange={(e) => setProduto(e.target.value)}
            >
              <option value="">Selecione o produto...</option>
              {(projectsQ.data ?? []).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Unidade</label>
            <input
              className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm"
              placeholder="Ex: 205, Torre A Ap 12..."
              value={unidade}
              onChange={(e) => setUnidade(e.target.value)}
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Valor da Venda (R$) *</label>
            <input
              className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm"
              placeholder="Ex: 450000"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>

          {!isAdmin && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-xs text-amber-700 font-medium">Sua venda será enviada para aprovação do gerente antes de ser confirmada.</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium text-sm">Cancelar</button>
            <button
              onClick={() => save.mutate()}
              disabled={!valor || !produto || save.isPending}
              className="flex-1 h-12 rounded-xl bg-green-600 text-white font-semibold text-sm disabled:opacity-50"
            >
              {save.isPending ? "Salvando..." : isAdmin ? "Confirmar Venda" : "Enviar para Aprovação"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CSV Import ───────────────────────────────────────────────────────────────

function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = "";
    } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !inQuotes) {
      if (char === '\r') i++;
      currentRow.push(currentCell.trim());
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += char;
    }
  }
  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }
  return rows.filter(row => row.some(cell => cell.trim() !== ''));
}

function parseBrDate(s: string): string {
  const parts = s.trim().split("/");
  if (parts.length !== 3) return "";
  const [d, m, y] = parts;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function parseValor(s: string): number {
  return parseFloat(s.replace(/R\$\s?/g, "").replace(/\./g, "").replace(",", ".")) || 0;
}

function normalizeStatus(s: string): string {
  if (!s) return "";
  const clean = s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (clean === "prospect") return "Prospect";
  if (clean === "em tratativa" || clean.includes("tratativa")) return "Em Tratativa";
  if (clean === "proposta em analise" || clean.includes("analise")) return "Proposta em Análise";
  if (clean === "proposta aprovada" || clean.includes("aprovada")) return "Proposta Aprovada";
  if (clean === "contrato gerado" || clean.includes("gerado")) return "Contrato Gerado";
  if (clean === "contrato assinado" || clean.includes("assinado")) return "Contrato Assinado";
  if (clean.includes("cancelad")) return "Cancelada";
  return s.trim();
}

function normalizeTemperatura(t: string): string {
  if (!t) return "";
  const clean = t.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (clean === "frio") return "Frio";
  if (clean === "morno") return "Morno";
  if (clean === "quente") return "Quente";
  return t.trim();
}

function normalizeSetor(s: string): string {
  if (!s) return "";
  const clean = s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (clean === "online") return "Online";
  if (clean === "salao") return "Salão";
  return s.trim();
}


function CsvImportButton({ brokers }: { brokers: any[] }) {
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<{ rawRows: any[]; errors: string[] } | null>(null);
  const [brokerId, setBrokerId] = useState("");
  const [loading, setLoading] = useState(false);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCsvText(text);
      if (rows.length < 2) return;
      const headers = rows[0];
      const rawRows: any[] = [];
      const errors: string[] = [];
      const get = (cols: string[], h: string) =>
        cols[headers.findIndex(x => x.toLowerCase().includes(h.toLowerCase()))]?.trim() ?? "";
      for (let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        if (cols.length < 2) continue;
        const dataStr = parseBrDate(get(cols, "data"));
        if (!dataStr) { errors.push(`Linha ${i + 1}: data inválida "${get(cols, "data")}"`); continue; }
        rawRows.push({
          data: dataStr,
          id_cliente: get(cols, "Id do Cliente") || null,
          nome_cliente: get(cols, "Nome Cliente") || get(cols, "nome") || "–",
          telefone: get(cols, "Telefone") || null,
          email: get(cols, "E-mail") || get(cols, "email") || null,
          produto: get(cols, "Produto") || null,
          ocorrencia: get(cols, "orrência") || get(cols, "correncia") || get(cols, "orrencia") || null,
          visita: get(cols, "Visita").toLowerCase().startsWith("sim"),
          venda: get(cols, "Venda").toLowerCase().startsWith("sim"),
          temperatura: normalizeTemperatura(get(cols, "Temperatura")) || null,
          status: normalizeStatus(get(cols, "Status")) || null,
          valor: parseValor(get(cols, "Valor")) || null,
          setor: normalizeSetor(get(cols, "Setor")) || null,
        });
      }
      setBrokerId("");
      setParsed({ rawRows, errors });
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  };

  const handleImport = async () => {
    if (!parsed?.rawRows.length || !brokerId) return;
    setLoading(true);
    const rows = parsed.rawRows.map(r => ({ ...r, broker_id: brokerId }));
    const { error } = await supabase.from("atendimentos").insert(rows as any);
    setLoading(false);
    if (error) { toast.error("Erro ao importar: " + error.message); return; }
    toast.success(`${rows.length} atendimentos importados!`);
    qc.invalidateQueries({ queryKey: ["dashboard-atendimentos"] });
    setParsed(null);
  };

  const selectedBroker = brokers.find(b => b.id === brokerId);

  return (
    <>
      <label className="h-9 px-4 rounded-xl bg-white border border-border text-[var(--navy)] font-semibold text-sm flex items-center gap-1.5 cursor-pointer hover:bg-[var(--surface)] transition-colors">
        <Upload size={14} /> Importar CSV
        <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
      </label>

      {parsed && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setParsed(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[var(--navy)] mb-1">Importar atendimentos</h3>
            <p className="text-sm text-muted-foreground mb-4">
              <span className="font-semibold text-[var(--navy)]">{parsed.rawRows.length} registros</span> encontrados no arquivo.
            </p>

            {/* Broker selector */}
            <div className="mb-4">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
                A qual corretor pertencem esses dados?
              </label>
              <div className="relative">
                <select
                  value={brokerId}
                  onChange={e => setBrokerId(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl bg-[var(--surface)] border border-border text-sm text-[var(--navy)] appearance-none cursor-pointer"
                >
                  <option value="">Selecione o corretor…</option>
                  {brokers.filter(b => b.is_active).map(b => (
                    <option key={b.id} value={b.id}>{b.full_name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
              {selectedBroker && (
                <p className="text-xs text-green-700 font-medium mt-1.5 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: selectedBroker.color }} />
                  Todos os {parsed.rawRows.length} registros serão importados para {selectedBroker.full_name}
                </p>
              )}
            </div>

            {/* Errors */}
            {parsed.errors.length > 0 && (
              <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 space-y-1 max-h-28 overflow-y-auto">
                {parsed.errors.map((err, i) => <p key={i}>{err}</p>)}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setParsed(null)} className="flex-1 h-11 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium text-sm">
                Cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={loading || !brokerId || parsed.rawRows.length === 0}
                className="flex-1 h-11 rounded-xl bg-[var(--navy)] text-white font-bold text-sm disabled:opacity-40"
              >
                {loading ? "Importando…" : `Importar ${parsed.rawRows.length} registros`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
