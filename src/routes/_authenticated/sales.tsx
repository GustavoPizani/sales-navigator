import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, endOfMonth } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBrokers } from "@/hooks/useBrokers";
import { AppHeader } from "@/components/AppHeader";
import { DealForm } from "./deals";

export const Route = createFileRoute("/_authenticated/sales")({
  component: SalesPage,
});

function SalesPage() {
  const { user, isAdmin, isDirector } = useAuth();
  const isManager = isAdmin || isDirector;
  if (!isManager) return <Navigate to="/dashboard" replace />;

  const [editing, setEditing] = useState<any | null>(null);
  const currentMonth = format(new Date(), "yyyy-MM");
  const [month, setMonth] = useState(currentMonth);
  const [brokerFilter, setBrokerFilter] = useState<string>("all");

  const brokersQ = useBrokers({ select: "id,full_name" });

  const { data: sales = [] } = useQuery({
    queryKey: ["sales", month, brokerFilter, user?.id],
    queryFn: async () => {
      const start = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
      const startDate = `${month}-01`;
      const endDateStr = format(endOfMonth(start), "yyyy-MM-dd");

      let q = supabase
        .from("atendimentos")
        .select("*, profiles(full_name)")
        .eq("venda", true)
        .gte("data", startDate)
        .lte("data", endDateStr)
        .order("data", { ascending: false })
        .order("created_at", { ascending: false });

      if (brokerFilter !== "all") {
        q = q.eq("broker_id", brokerFilter);
      } else {
        const teamIds = (brokersQ.data ?? []).map((b) => b.id);
        const ids = isDirector ? teamIds : [user!.id, ...teamIds];
        if (ids.length === 0) return [];
        q = q.in("broker_id", ids);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!user && brokersQ.isFetched,
  });

  const totalValor = sales.reduce((sum, s) => sum + (s.valor ?? 0), 0);

  return (
    <div className="pb-nav">
      <AppHeader title="Vendas" />

      <div className="px-4 pt-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            type="month"
            className="h-10 px-3 rounded-lg bg-white border border-border text-sm flex-1"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          <select
            className="h-10 px-3 rounded-lg bg-white border border-border text-sm flex-1"
            value={brokerFilter}
            onChange={(e) => setBrokerFilter(e.target.value)}
          >
            <option value="all">Todos os Corretores</option>
            {(brokersQ.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.full_name}
              </option>
            ))}
          </select>
        </div>

        <div className="bg-white rounded-2xl border border-border p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total vendido no período</p>
            <p className="text-xl font-bold text-[var(--navy)]">
              {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(totalValor)}
            </p>
          </div>
          <div className="text-sm text-muted-foreground">{sales.length} venda{sales.length === 1 ? "" : "s"}</div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3">
        {sales.length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">Nenhuma venda encontrada neste período.</p>
        )}

        {sales.map((s) => {
          const prof = s.profiles as any;
          return (
            <button
              key={s.id}
              onClick={() => setEditing(s)}
              className="w-full text-left bg-white p-4 rounded-2xl border border-border flex flex-col gap-2"
            >
              <div className="flex justify-between items-start gap-2">
                <div className="font-semibold text-[var(--navy)] truncate flex-1">{s.nome_cliente}</div>
                <div className="font-bold text-green-700 whitespace-nowrap">
                  {s.valor != null
                    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(s.valor)
                    : "R$ 0,00"}
                </div>
              </div>

              <div className="flex justify-between items-center text-xs text-muted-foreground">
                <div className="truncate">{s.produto || "Sem produto"}</div>
                <div>{format(new Date(s.data + "T00:00:00"), "dd/MM/yyyy")}</div>
              </div>

              {prof?.full_name && (
                <div className="text-xs text-[var(--gold)] font-semibold mt-1">👤 {prof.full_name}</div>
              )}
            </button>
          );
        })}
      </div>

      {editing && <DealForm deal={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
