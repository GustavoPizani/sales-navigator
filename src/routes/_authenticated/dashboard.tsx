import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronDown, Plus, Upload, X } from "lucide-react";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Link } from "@tanstack/react-router";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBrokers } from "@/hooks/useBrokers";
import { AppHeader } from "@/components/AppHeader";
import { useDashboardFilters, useDashboardData } from "@/hooks/useDashboard";
import { DashboardCharts, AtendimentosTable, KpiCard, MiniAvatar, formatBRL, StatusChart, VisitsByProductChart } from "@/components/DashboardShared";
import { BarChart, Bar, Tooltip, ResponsiveContainer } from "recharts";

const STATUSES = ["Prospect", "Proposta em Análise", "Proposta Aprovada", "Contrato Gerado", "Contrato Assinado", "Cancelada"];

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

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { user, isAdmin } = useAuth();
  if (!isAdmin) return <BrokerDashboard user={user} />;
  return <AdminDashboard user={user} />;
}

function AdminDashboard({ user }: { user: any }) {
  const isAdmin = true;
  const filters = useDashboardFilters();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [editingAtendimento, setEditingAtendimento] = useState<any | null>(null);

  const brokersQ = useBrokers({ select: "*", includeInactive: true });

  const teamBrokerIds = (brokersQ.data ?? []).map((b) => b.id);

  const { data: atendimentos = [], isPending } = useQuery({
    queryKey: ["dashboard-atendimentos", filters.appliedStartDate, filters.appliedEndDate, filters.appliedBrokerId, user?.id, teamBrokerIds.join(",")],
    queryFn: async () => {
      // Specific broker selected — no need for team filter
      if (filters.appliedBrokerId !== "all") {
        const { data, error } = await supabase
          .from("atendimentos")
          .select("*, profiles(full_name, color)")
          .eq("broker_id", filters.appliedBrokerId)
          .gte("data", filters.appliedStartDate)
          .lte("data", filters.appliedEndDate);
        if (error) throw error;
        return data ?? [];
      }

      // Admin "all" mode: filter ONLY to this manager's team
      // Guard: if no team brokers loaded yet, return empty to avoid showing all data
      if (teamBrokerIds.length === 0) return [];

      const { data, error } = await supabase
        .from("atendimentos")
        .select("*, profiles(full_name, color)")
        .in("broker_id", teamBrokerIds)
        .gte("data", filters.appliedStartDate)
        .lte("data", filters.appliedEndDate);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && Array.isArray(brokersQ.data),
  });

  const dbData = useDashboardData(atendimentos);

  const projectsQ = useQuery({
    queryKey: ["projects-for-dashboard"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name, city").eq("is_active", true);
      return (data ?? []) as { id: string; name: string; city: string }[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const statusCounts = useMemo(() =>
    STATUSES.map((s) => ({ name: s, count: atendimentos.filter((a) => a.status === s).length })),
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
      map[b.id] = { broker: b, total: 0, visitas: 0, vendas: 0, tratativas: 0, volume: 0, monthly: {} };
    });

    atendimentos.forEach(a => {
      if (!map[a.broker_id]) return;
      const b = map[a.broker_id];
      b.total++;
      if (a.visita) b.visitas++;
      if (a.venda) b.vendas++;
      const isTratativa = ["Prospect", "Proposta em Análise", "Proposta Aprovada", "Contrato Gerado"].includes(a.status ?? "");
      if (isTratativa) b.tratativas += Number(a.valor) || 0;
      if (a.status === "Contrato Assinado") b.volume += Number(a.valor) || 0;
      b.monthly[a.data.slice(0, 7)] = (b.monthly[a.data.slice(0, 7)] || 0) + 1;
    });

    return Object.values(map).map(b => {
      const conversao = b.total > 0 ? (b.vendas / b.total) * 100 : 0;
      const sparkline = Object.entries(b.monthly).sort((a,b) => a[0].localeCompare(b[0])).map(([m, count]) => ({ name: m, count }));
      return { ...b, conversao, sparkline };
    }).sort((a, b) => b.total - a.total);
  }, [atendimentos, brokersQ.data, isAdmin]);

  const selectedBroker = filters.brokerId === "all" ? null : brokersQ.data?.find(b => b.id === filters.brokerId);

  return (
    <div className="pb-nav bg-[var(--surface)] min-h-screen">
      <AppHeader title="Dashboard" />

      {/* FILTER BAR */}
      <div className="bg-white px-4 py-3 border-b border-border sticky top-0 z-20 shadow-sm flex items-center gap-3 flex-wrap">
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
                <div className="absolute top-[44px] left-0 w-full bg-white border border-border rounded-lg shadow-xl z-40 max-h-[280px] overflow-y-auto py-1">
                  <button onClick={() => { filters.setBrokerId("all"); setIsDropdownOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--surface)] ${filters.brokerId === "all" ? "bg-[var(--surface)] font-semibold" : ""}`}>Todos os corretores</button>
                  {(brokersQ.data ?? []).map(b => (
                    <button key={b.id} onClick={() => { filters.setBrokerId(b.id); setIsDropdownOpen(false); }} className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-[var(--surface)] ${filters.brokerId === b.id ? "bg-[var(--surface)] font-semibold" : ""}`}>
                      <MiniAvatar name={b.full_name} color={b.color} /><span className="truncate">{b.full_name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="px-4 pt-4 pb-8 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label="Total de Atendimentos" value={dbData.totalAtendimentos} />
          <KpiCard label="Total de Visitas" value={dbData.totalVisitas} />
          <KpiCard label="Total de Vendas" value={dbData.totalVendas} />
          <KpiCard label="Em Tratativas" value={formatBRL(dbData.emTratativas)} />
          <KpiCard label="Volume de Vendas" value={formatBRL(dbData.volumeVendas)} />
        </div>

        <DashboardCharts dbData={dbData} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <StatusChart data={statusCounts} />
          <VisitsByProductChart data={visitsByProduct} />
        </div>

        {isAdmin && brokerPerformance.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-[var(--navy)]">Desempenho por Corretor</h2>
            <div className={`grid gap-4 ${filters.appliedBrokerId !== 'all' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
              {brokerPerformance.filter(b => filters.appliedBrokerId === 'all' || b.broker.id === filters.appliedBrokerId).map(bp => (
                <BrokerPerformanceCard key={bp.broker.id} bp={bp} />
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-[var(--navy)]">Visão Geral dos Atendimentos</h2>
            <CsvImportButton brokers={brokersQ.data ?? []} />
          </div>
          <AtendimentosTable atendimentos={atendimentos} isAdmin={isAdmin} onRowClick={(a) => setEditingAtendimento(a)} />
        </div>
      </div>

      {editingAtendimento && <AtendimentoEditForm atendimento={editingAtendimento} onClose={() => setEditingAtendimento(null)} />}
    </div>
  );
}

function BrokerDashboard({ user }: { user: any }) {
  const filters = useDashboardFilters();
  const [insertOpen, setInsertOpen] = useState(false);
  const [editingAtendimento, setEditingAtendimento] = useState<any | null>(null);

  const { data: atendimentos = [] } = useQuery({
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

  const dbData = useDashboardData(atendimentos);

  return (
    <div className="pb-nav bg-[var(--surface)] min-h-screen">
      <AppHeader title="Dashboard" />
      <div className="bg-white px-4 py-3 border-b border-border sticky top-0 z-20 shadow-sm">
        <DateRangePicker startDate={filters.startDate} endDate={filters.endDate} onApply={filters.applyDateRange} className="w-full" />
      </div>

      <div className="px-4 pt-4 pb-8 space-y-6">
        <div className="grid grid-cols-2 gap-3">
          <KpiCard label="Total de Atendimentos" value={dbData.totalAtendimentos} />
          <KpiCard label="Total de Visitas" value={dbData.totalVisitas} />
          <KpiCard label="Total de Vendas" value={dbData.totalVendas} />
          <KpiCard label="Em Tratativas" value={formatBRL(dbData.emTratativas)} />
          <div className="col-span-2"><KpiCard label="Volume de Vendas" value={formatBRL(dbData.volumeVendas)} /></div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-[var(--navy)]">Visão Geral dos Atendimentos</h2>
            <button onClick={() => setInsertOpen(true)} className="h-9 px-4 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold text-sm flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.5} /> Inserir
            </button>
          </div>
          <AtendimentosTable atendimentos={atendimentos} isAdmin={false} onRowClick={(a) => setEditingAtendimento(a)} />
        </div>
      </div>

      {insertOpen && <AtendimentoForm userId={user?.id} onClose={() => setInsertOpen(false)} />}
      {editingAtendimento && <AtendimentoEditForm atendimento={editingAtendimento} onClose={() => setEditingAtendimento(null)} />}
    </div>
  );
}

function AtendimentoEditForm({ atendimento, onClose }: { atendimento: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [produto, setProduto] = useState(atendimento.produto ?? "");
  const [ocorrencia, setOcorrencia] = useState(atendimento.ocorrencia ?? "");
  const [visita, setVisita] = useState(atendimento.visita ?? false);
  const [venda, setVenda] = useState(atendimento.venda ?? false);
  const [temperatura, setTemperatura] = useState(atendimento.temperatura ?? "");
  const [status, setStatus] = useState(atendimento.status ?? "");
  const [valor, setValor] = useState(atendimento.valor ? String(atendimento.valor) : "");

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("atendimentos")
        .update({
          produto: produto || null,
          ocorrencia: ocorrencia || null,
          visita,
          venda,
          temperatura: temperatura || null,
          status: status || null,
          valor: valor ? parseFloat(valor.replace(",", ".")) : null,
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
            <h3 className="text-base font-semibold text-[var(--navy)]">Editar Atendimento</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{atendimento.nome_cliente}</p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <input className={fieldCls} placeholder="Produto" value={produto} onChange={(e) => setProduto(e.target.value)} />
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
                <button key={t} onClick={() => setTemperatura(temperatura === t ? "" : t)}
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

        <div className="px-5 pb-5 pt-3 border-t border-border flex gap-2 flex-shrink-0">
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

function AtendimentoForm({ userId, onClose }: { userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const todayStr = format(new Date(), "yyyy-MM-dd");

  const [linkedApptId, setLinkedApptId] = useState("");
  const [data, setData] = useState(todayStr);
  const [nomeCliente, setNomeCliente] = useState("");
  const [telefone, setTelefone] = useState("");
  const [emailCliente, setEmailCliente] = useState("");
  const [idCliente, setIdCliente] = useState("");
  const [produto, setProduto] = useState("");
  const [ocorrencia, setOcorrencia] = useState("");
  const [setor, setSetor] = useState("");
  const [visita, setVisita] = useState(false);
  const [venda, setVenda] = useState(false);
  const [temperatura, setTemperatura] = useState("");
  const [status, setStatus] = useState("");
  const [valor, setValor] = useState("");

  const apptsQ = useQuery({
    queryKey: ["broker-past-appts", userId],
    queryFn: async () => {
      const { data } = await supabase.from("appointments").select("*")
        .eq("owner_id", userId).lte("date", todayStr).order("date", { ascending: false }).limit(50);
      return data ?? [];
    },
    enabled: !!userId,
  });

  const linkedIdsQ = useQuery({
    queryKey: ["linked-appt-ids", userId],
    queryFn: async () => {
      const { data } = await supabase.from("atendimentos")
        .select("appointment_id").eq("broker_id", userId).not("appointment_id", "is", null);
      return (data ?? []).map((a: any) => a.appointment_id).filter(Boolean) as string[];
    },
    enabled: !!userId,
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
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("atendimentos").insert({
        broker_id: userId,
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
      });
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
            <input className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border text-sm" placeholder="Produto" value={produto} onChange={(e) => setProduto(e.target.value)} />
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
    <Link to="/dashboard/corretor/$id" params={{ id: bp.broker.id }} className="bg-white p-4 rounded-2xl shadow-sm border border-border block hover:border-[var(--gold)] transition-colors group">
      <div className="flex items-center gap-3 mb-4">
        <MiniAvatar name={bp.broker.full_name} color={bp.broker.color} />
        <div>
          <div className="font-bold text-[var(--navy)] text-sm group-hover:text-[var(--gold)] transition-colors">{bp.broker.full_name}</div>
          <div className="text-xs text-muted-foreground">Corretor</div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center mb-3">
        <div><div className="text-[10px] text-muted-foreground uppercase">Atend.</div><div className="font-bold text-[var(--navy)]">{bp.total}</div></div>
        <div><div className="text-[10px] text-muted-foreground uppercase">Visitas</div><div className="font-bold text-[var(--navy)]">{bp.visitas}</div></div>
        <div><div className="text-[10px] text-muted-foreground uppercase">Vendas</div><div className="font-bold text-[var(--navy)]">{bp.vendas}</div></div>
        <div><div className="text-[10px] text-muted-foreground uppercase">Conv.</div><div className="font-bold text-[var(--navy)]">{bp.conversao.toFixed(1)}%</div></div>
      </div>
      <div className="h-1.5 w-full bg-gray-100 rounded-full mb-4 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(bp.conversao, 100)}%`, backgroundColor: bp.broker.color }} />
      </div>
      <div className="space-y-1 mb-4 text-sm">
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
