import { createFileRoute, Link } from "@tanstack/react-router";
import { RequireModule } from "@/components/RequireModule";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { DateRangePicker } from "@/components/DateRangePicker";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { useDashboardFilters, useDashboardData } from "@/hooks/useDashboard";
import { DashboardCharts, KpiCard, formatBRL } from "@/components/DashboardShared";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import { useDashboardLeads } from "@/hooks/useDashboardLeads";

export const Route = createFileRoute("/_authenticated/dashboard/corretor/$id")({
  component: BrokerDashboardPageGuarded,
});

// Rota bloqueada pela matriz de permissões do cargo.
function BrokerDashboardPageGuarded() {
  return (
    <RequireModule modules={["dashboard"]}>
      <BrokerDashboardPage />
    </RequireModule>
  );
}

function BrokerDashboardPage() {
  const { id } = Route.useParams();
  const { isAdmin } = useAuth();
  const filters = useDashboardFilters();

  const brokerQ = useQuery({
    queryKey: ["broker", id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", id).single();
      return data;
    }
  });

  const { atendimentos, vendas } = useDashboardLeads({
    brokerIds: [id],
    from: filters.appliedStartDate,
    to: filters.appliedEndDate,
    dateField: "created_at",
  });

  const { data: visitas = [] } = useQuery({
    queryKey: ["dashboard-visitas", filters.appliedStartDate, filters.appliedEndDate, id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visitas")
        .select("*")
        .eq("broker_id", id)
        .gte("data_visita", filters.appliedStartDate)
        .lte("data_visita", filters.appliedEndDate);
      if (error) throw error;
      return data ?? [];
    },
  });

  const dbData = useDashboardData(atendimentos, vendas, visitas);

  if (!isAdmin) return <div className="p-8 text-center text-red-500">Acesso negado.</div>;

  return (
    <div className="pb-nav bg-[var(--surface)] min-h-screen">
      <AppHeader title={brokerQ.data ? `Desempenho: ${brokerQ.data.full_name}` : "Desempenho do Corretor"} />
      
      <div className="bg-white px-4 py-3 border-b border-border sticky top-0 z-20 shadow-sm flex items-center gap-3">
        <Link to="/dashboard" className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg bg-[var(--surface)] text-muted-foreground hover:text-[var(--navy)]">
          <ChevronLeft size={20} />
        </Link>
        <DateRangePicker startDate={filters.startDate} endDate={filters.endDate} onApply={filters.applyDateRange} className="flex-1" />
      </div>

      <div className="px-4 pt-6 pb-8 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label="Total de Atendimentos" value={dbData.totalAtendimentos} />
          <KpiCard label="Total de Visitas" value={dbData.totalVisitas} />
          <KpiCard label="Total de Vendas" value={dbData.totalVendas} />
          <KpiCard label="Em Contato" value={dbData.emTratativas} />
          <KpiCard label="Volume de Vendas" value={formatBRL(dbData.volumeVendas)} />
        </div>

        <DashboardCharts dbData={dbData} />

        <PipelineBoard
          brokerId={id}
          from={filters.appliedStartDate}
          to={filters.appliedEndDate}
          title="Atendimentos do corretor"
        />
      </div>
    </div>
  );
}