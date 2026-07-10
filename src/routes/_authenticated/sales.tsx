import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, endOfMonth } from "date-fns";
import toast from "react-hot-toast";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBrokers } from "@/hooks/useBrokers";
import { AppHeader } from "@/components/AppHeader";

export const Route = createFileRoute("/_authenticated/sales")({
  component: SalesPage,
});

const statusLabels: Record<string, string> = {
  approved: "Aprovada",
  pending: "Pendente",
  rejected: "Rejeitada",
};

const statusColors: Record<string, string> = {
  approved: "bg-green-100 text-green-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
};

function SalesPage() {
  const { isAdmin, isDirector } = useAuth();
  if (!isAdmin && !isDirector) return <Navigate to="/dashboard" replace />;
  return <SalesView />;
}

function SalesView() {
  const { user, isDirector } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const currentMonth = format(new Date(), "yyyy-MM");
  const [month, setMonth] = useState(currentMonth);
  const [brokerFilter, setBrokerFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("approved");

  const brokersQ = useBrokers({ select: "id,full_name", includeInactive: true });

  const { data: vendas = [], error: vendasError } = useQuery({
    queryKey: ["manager-vendas", month, brokerFilter, statusFilter, user?.id, (brokersQ.data ?? []).map((b) => b.id).join(",")],
    queryFn: async () => {
      const start = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
      const startDate = `${month}-01`;
      const endDateStr = format(endOfMonth(start), "yyyy-MM-dd");

      let q = supabase
        .from("vendas")
        .select("*, atendimentos(nome_cliente, id_cliente, produto), profiles!vendas_broker_id_fkey(full_name)")
        .gte("data_venda", startDate)
        .lte("data_venda", endDateStr)
        .order("data_venda", { ascending: false })
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        q = q.eq("status", statusFilter);
      }

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

  const totalValor = vendas.reduce((sum, v) => sum + (Number(v.valor) || 0), 0);

  return (
    <div className="pb-nav">
      <AppHeader title="Vendas" />

      <div className="px-4 pt-4 flex flex-col gap-3">
        {vendasError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs break-words">
            Erro ao buscar vendas: {(vendasError as any).message ?? String(vendasError)}
          </div>
        )}
        {brokersQ.error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs break-words">
            Erro ao buscar corretores: {(brokersQ.error as any).message ?? String(brokersQ.error)}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="month"
            className="h-10 px-3 rounded-lg bg-white border border-border text-sm flex-1"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          <select
            className="h-10 px-3 rounded-lg bg-white border border-border text-sm flex-1"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">Todos os Status</option>
            <option value="approved">Aprovadas</option>
            <option value="pending">Pendentes</option>
            <option value="rejected">Rejeitadas</option>
          </select>
        </div>
        <select
          className="h-10 px-3 rounded-lg bg-white border border-border text-sm w-full"
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

        <div className="bg-white rounded-2xl border border-border p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total no período</p>
            <p className="text-xl font-bold text-[var(--navy)]">
              {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(totalValor)}
            </p>
          </div>
          <div className="text-sm text-muted-foreground">{vendas.length} venda{vendas.length === 1 ? "" : "s"}</div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3">
        {vendas.length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">Nenhuma venda encontrada neste período.</p>
        )}

        {vendas.map((v) => {
          const atend = v.atendimentos as any;
          const prof = v.profiles as any;
          return (
            <button
              key={v.id}
              onClick={() => setEditing(v)}
              className="w-full text-left bg-white p-4 rounded-2xl border border-border flex flex-col gap-2"
            >
              <div className="flex justify-between items-start gap-2">
                <div className="font-semibold text-[var(--navy)] truncate flex-1">{atend?.nome_cliente || "—"}</div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${statusColors[v.status] ?? "bg-gray-100 text-gray-700"}`}>
                  {statusLabels[v.status] ?? v.status}
                </span>
              </div>

              <div className="flex justify-between items-center text-xs text-muted-foreground">
                <div className="truncate">{v.produto || atend?.produto || "Sem produto"}{v.unidade ? ` · ${v.unidade}` : ""}</div>
                <div>{format(new Date(v.data_venda + "T00:00:00"), "dd/MM/yyyy")}</div>
              </div>

              <div className="flex justify-between items-center mt-1">
                <div className="font-bold text-green-700">
                  {v.valor != null
                    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v.valor)
                    : "R$ 0,00"}
                </div>
                {prof?.full_name && (
                  <div className="text-xs text-[var(--gold)] font-semibold">👤 {prof.full_name}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {editing && (
        <VendaForm
          venda={editing}
          onClose={() => setEditing(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["manager-vendas"] })}
        />
      )}
    </div>
  );
}

function formatInitialCurrency(val: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);
}

function parseValor(val: string) {
  if (!val) return null;
  const numeric = val.replace(/\D/g, "");
  if (!numeric) return null;
  return parseInt(numeric, 10) / 100;
}

// After changing/removing a venda, keep atendimentos.venda in sync with
// whether any approved venda still exists for that atendimento.
async function syncAtendimentoFlag(atendimentoId: string) {
  const { data } = await supabase.from("vendas").select("id").eq("atendimento_id", atendimentoId).eq("status", "approved").limit(1);
  const hasApproved = (data ?? []).length > 0;
  await supabase.from("atendimentos").update({ venda: hasApproved, ...(hasApproved ? { status: "Contrato Assinado" } : {}) }).eq("id", atendimentoId);
}

function VendaForm({ venda, onClose, onSaved }: { venda: any; onClose: () => void; onSaved: () => void }) {
  const atend = venda.atendimentos as any;
  const [dataVenda, setDataVenda] = useState(venda.data_venda);
  const [produto, setProduto] = useState(venda.produto ?? "");
  const [unidade, setUnidade] = useState(venda.unidade ?? "");
  const [status, setStatus] = useState(venda.status);
  const [valor, setValor] = useState(venda.valor ? formatInitialCurrency(venda.valor) : "");

  const handleValorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const numeric = e.target.value.replace(/\D/g, "");
    if (!numeric) {
      setValor("");
      return;
    }
    const num = (parseInt(numeric, 10) / 100).toFixed(2);
    setValor(new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(num)));
  };

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("vendas")
        .update({ data_venda: dataVenda, produto: produto || null, unidade: unidade || null, status, valor: parseValor(valor) })
        .eq("id", venda.id);
      if (error) throw error;
      await syncAtendimentoFlag(venda.atendimento_id);
    },
    onSuccess: () => {
      onSaved();
      toast.success("Venda atualizada!");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("vendas").delete().eq("id", venda.id);
      if (error) throw error;
      await syncAtendimentoFlag(venda.atendimento_id);
    },
    onSuccess: () => {
      onSaved();
      toast.success("Venda excluída!");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-white w-full min-h-screen sm:min-h-0 sm:max-w-md sm:mx-auto sm:mt-8 sm:rounded-2xl p-5 safe-top safe-bottom pb-24"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--navy)]">Editar Venda</h3>
          <button onClick={onClose} className="text-muted-foreground">Fechar</button>
        </div>

        <div className="space-y-4">
          <div className="bg-[var(--surface)] rounded-xl p-3 border border-border text-sm">
            <p className="text-xs text-muted-foreground">Cliente</p>
            <p className="font-semibold text-[var(--navy)]">{atend?.nome_cliente || "—"}</p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Data da Venda</label>
            <input
              type="date"
              className="w-full h-12 px-3 rounded-xl bg-[var(--surface)] border border-border"
              value={dataVenda}
              onChange={(e) => setDataVenda(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Produto</label>
            <input
              className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
              value={produto}
              onChange={(e) => setProduto(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Unidade</label>
            <input
              className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
              value={unidade}
              onChange={(e) => setUnidade(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Valor (R$)</label>
            <input
              type="text"
              className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
              placeholder="R$ 0,00"
              value={valor}
              onChange={handleValorChange}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
            <select
              className="w-full h-12 px-3 rounded-xl bg-[var(--surface)] border border-border"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="approved">Aprovada</option>
              <option value="pending">Pendente</option>
              <option value="rejected">Rejeitada</option>
            </select>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Deseja realmente excluir esta venda?")) del.mutate();
              }}
              className="w-12 h-12 flex-shrink-0 flex items-center justify-center rounded-xl bg-red-50 text-red-600"
            >
              <Trash2 size={20} />
            </button>
            <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">
              Cancelar
            </button>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="flex-1 h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold disabled:opacity-60"
            >
              {save.isPending ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
