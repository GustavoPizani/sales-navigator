import { createFileRoute } from "@tanstack/react-router";
import { RequireModule } from "@/components/RequireModule";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, endOfMonth, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, Check, X, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBrokers } from "@/hooks/useBrokers";
import { AppHeader } from "@/components/AppHeader";

export const Route = createFileRoute("/_authenticated/deals")({
  component: DealsPageGuarded,
});

// Rota bloqueada pela matriz de permissões do cargo.
function DealsPageGuarded() {
  return (
    <RequireModule modules={["leads"]}>
      <DealsPage />
    </RequireModule>
  );
}

const statusColors = {
  "Prospect": "bg-gray-100 text-gray-700",
  "Em Tratativa": "bg-cyan-100 text-cyan-700",
  "Proposta em Análise": "bg-blue-100 text-blue-700",
  "Proposta Aprovada": "bg-indigo-100 text-indigo-700",
  "Contrato Gerado": "bg-amber-100 text-amber-700",
  "Contrato Assinado": "bg-green-100 text-green-700",
  "Cancelada": "bg-red-100 text-red-700",
};

const temperaturaColors = {
  "Frio": "bg-slate-100 text-slate-700",
  "Morno": "bg-amber-100 text-amber-700",
  "Quente": "bg-red-100 text-red-700",
};

const setorColors = {
  "Online": "bg-blue-100 text-blue-700",
  "Salão": "bg-amber-100 text-amber-700",
};

function DealsPage() {
  const { user, isAdmin } = useAuth();
  const [editing, setEditing] = useState<any | "new" | null>(null);

  const currentMonth = format(new Date(), "yyyy-MM");
  const [month, setMonth] = useState(currentMonth);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [brokerFilter, setBrokerFilter] = useState<string>("all");

  const brokersQ = useBrokers({ select: "id,full_name", enabled: isAdmin });

  const { data: deals = [] } = useQuery({
    queryKey: ["deals", month, statusFilter, brokerFilter],
    queryFn: async () => {
      const startDate = `${month}-01`;
      const start = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
      const end = endOfMonth(start);
      const endDateStr = format(end, "yyyy-MM-dd");

      let q = supabase
        .from("atendimentos")
        .select("*, profiles(full_name)")
        .gte("data", startDate)
        .lte("data", endDateStr)
        .order("data", { ascending: false })
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        q = q.eq("status", statusFilter);
      }

      if (isAdmin && brokerFilter !== "all") {
        q = q.eq("broker_id", brokerFilter);
      } else if (!isAdmin) {
        q = q.eq("broker_id", user!.id);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const title = isAdmin ? "Atendimentos do Time" : "Meus Atendimentos";

  return (
    <div className="pb-nav">
      <AppHeader title={title} />

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
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">Todos os Status</option>
            <option value="Prospect">Prospect</option>
            <option value="Em Tratativa">Em Tratativa</option>
            <option value="Proposta em Análise">Proposta em Análise</option>
            <option value="Proposta Aprovada">Proposta Aprovada</option>
            <option value="Contrato Gerado">Contrato Gerado</option>
            <option value="Contrato Assinado">Contrato Assinado</option>
            <option value="Cancelada">Cancelada</option>
          </select>
        </div>
        {isAdmin && (
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
        )}
      </div>

      <div className="px-4 pt-4 space-y-3">
        {deals.length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">Nenhum atendimento encontrado.</p>
        )}

        {deals.map((a) => {
          const prof = a.profiles as any;
          return (
            <button
              key={a.id}
              onClick={() => setEditing(a)}
              className="w-full text-left bg-white p-4 rounded-2xl border border-border flex flex-col gap-2"
            >
              <div className="flex justify-between items-start gap-2">
                <div className="font-semibold text-[var(--navy)] truncate flex-1">{a.nome_cliente}</div>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                    statusColors[a.status as keyof typeof statusColors]
                  }`}
                >
                  {a.status}
                </span>
              </div>

              <div className="flex justify-between items-center text-xs text-muted-foreground mt-1">
                <div className="truncate">{a.produto || "Sem produto"}</div>
                <div>{format(parseISO(a.data), "dd/MM/yyyy")}</div>
              </div>

              <div className="flex justify-between items-center mt-2">
                <div className="font-medium text-[var(--navy)] text-sm">
                  {a.valor != null
                    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(a.valor)
                    : "R$ 0,00"}
                </div>
                <div className="flex gap-1.5">
                  {a.temperatura && (
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        temperaturaColors[a.temperatura as keyof typeof temperaturaColors]
                      }`}
                    >
                      {a.temperatura}
                    </span>
                  )}
                  {a.setor && (
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        setorColors[a.setor as keyof typeof setorColors]
                      }`}
                    >
                      {a.setor}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs mt-3 pt-2 border-t border-border">
                <div className="flex items-center gap-1 font-medium">
                  <span className="text-muted-foreground">Visita:</span>
                  {a.visita ? <Check size={14} className="text-green-600" /> : <X size={14} className="text-red-500" />}
                </div>
                <div className="flex items-center gap-1 font-medium">
                  <span className="text-muted-foreground">Venda:</span>
                  {a.venda ? <Check size={14} className="text-green-600" /> : <X size={14} className="text-red-500" />}
                </div>
                {isAdmin && prof?.full_name && (
                  <div className="ml-auto text-[10px] text-muted-foreground truncate max-w-[120px]">
                    👤 {prof.full_name}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <button
        onClick={() => setEditing("new")}
        className="fixed right-4 bottom-24 z-30 w-14 h-14 rounded-full bg-[var(--gold)] text-[var(--navy)] shadow-lg flex items-center justify-center"
        aria-label="Novo Atendimento"
      >
        <Plus size={28} strokeWidth={2.5} />
      </button>

      {editing && <DealForm deal={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const maskPhone = (val: string) => {
  const d = val.replace(/\D/g, "");
  if (!d) return "";
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
};

const formatInitialCurrency = (val: number) => {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);
};

const parseValor = (val: string) => {
  if (!val) return null;
  const numeric = val.replace(/\D/g, "");
  if (!numeric) return null;
  return parseInt(numeric, 10) / 100;
};

export function DealForm({ deal, onClose }: { deal: any; onClose: () => void }) {
  const { user, isAdmin, isDirector } = useAuth();
  const qc = useQueryClient();

  const [data, setData] = useState(deal?.data ?? format(new Date(), "yyyy-MM-dd"));
  const [nomeCliente, setNomeCliente] = useState(deal?.nome_cliente ?? "");
  const [idCliente, setIdCliente] = useState(deal?.id_cliente ?? "");
  const [telefone, setTelefone] = useState(deal?.telefone ?? "");
  const [email, setEmail] = useState(deal?.email ?? "");
  const [produto, setProduto] = useState(deal?.produto ?? "");
  const [setor, setSetor] = useState(deal?.setor ?? "Online");
  const [ocorrencia, setOcorrencia] = useState(deal?.ocorrencia ?? "");
  const [temperatura, setTemperatura] = useState(deal?.temperatura ?? "Frio");
  const [visita, setVisita] = useState(deal?.visita ?? false);
  const [venda, setVenda] = useState(deal?.venda ?? false);
  const [status, setStatus] = useState(deal?.status ?? "Prospect");
  const [valor, setValor] = useState(deal?.valor ? formatInitialCurrency(deal.valor) : "");
  const [brokerId, setBrokerId] = useState(deal?.broker_id ?? user?.id);

  const projectsQ = useQuery({
    queryKey: ["projects-active"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id,name").eq("is_active", true).order("name");
      return data ?? [];
    },
  });

  const brokersQ = useBrokers({ select: "id,full_name", enabled: isAdmin });

  const handleValorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const numeric = e.target.value.replace(/\D/g, "");
    if (!numeric) {
      setValor("");
      return;
    }
    const num = (parseInt(numeric, 10) / 100).toFixed(2);
    const formatted = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(num));
    setValor(formatted);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        broker_id: brokerId,
        data,
        nome_cliente: nomeCliente,
        id_cliente: idCliente || null,
        telefone: telefone || null,
        email: email || null,
        produto: produto || null,
        setor,
        ocorrencia: ocorrencia || null,
        temperatura,
        visita,
        venda,
        status,
        valor: parseValor(valor),
      };

      if (deal) {
        const { error } = await supabase.from("atendimentos").update(payload).eq("id", deal.id);
        if (error) throw error;
      } else {
        if (idCliente) {
          const { data: existing } = await supabase.from("atendimentos")
            .select("id, venda, status")
            .eq("id_cliente", idCliente)
            .order("id", { ascending: false })
            .limit(1)
            .maybeSingle();
            
          if (existing && !existing.venda && existing.status !== "Contrato Assinado") {
            const { error } = await supabase.from("atendimentos").update(payload).eq("id", existing.id);
            if (error) throw error;
            return;
          }
        }

        const { error } = await supabase.from("atendimentos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals"] });
      toast.success("Atendimento registrado!");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("atendimentos").delete().eq("id", deal.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals"] });
      toast.success("Atendimento excluído!");
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-white w-full min-h-screen sm:min-h-0 sm:max-w-md sm:mx-auto sm:mt-8 sm:rounded-2xl p-5 safe-top safe-bottom pb-24"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--navy)]">{deal ? "Visualizar Cliente" : "Novo atendimento"}</h3>
          <button onClick={onClose} className="text-muted-foreground">
            Fechar
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Data *</label>
            <input
              type="date"
              required
              disabled={!!deal}
              className={`w-full h-12 px-3 rounded-xl border border-border ${deal ? "bg-gray-50 text-gray-500 cursor-not-allowed" : "bg-[var(--surface)]"}`}
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Nome do Cliente *</label>
            <input
              required
              disabled={!!deal}
              className={`w-full h-12 px-4 rounded-xl border border-border ${deal ? "bg-gray-50 text-gray-500 cursor-not-allowed" : "bg-[var(--surface)]"}`}
              value={nomeCliente}
              onChange={(e) => setNomeCliente(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">ID do Cliente</label>
            <input
              disabled={!!deal}
              className={`w-full h-12 px-4 rounded-xl border border-border ${deal ? "bg-gray-50 text-gray-500 cursor-not-allowed" : "bg-[var(--surface)]"}`}
              value={idCliente}
              onChange={(e) => setIdCliente(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Telefone</label>
            <input
              type="tel"
              disabled={!!deal}
              className={`w-full h-12 px-4 rounded-xl border border-border ${deal ? "bg-gray-50 text-gray-500 cursor-not-allowed" : "bg-[var(--surface)]"}`}
              placeholder="(00) 00000-0000"
              value={telefone}
              onChange={(e) => setTelefone(maskPhone(e.target.value))}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">E-mail</label>
            <input
              type="email"
              disabled={!!deal}
              className={`w-full h-12 px-4 rounded-xl border border-border ${deal ? "bg-gray-50 text-gray-500 cursor-not-allowed" : "bg-[var(--surface)]"}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Produto</label>
            <select
              className="w-full h-12 px-3 rounded-xl bg-[var(--surface)] border border-border text-[var(--navy)]"
              value={produto}
              onChange={(e) => setProduto(e.target.value)}
            >
              <option value="">Selecione o produto...</option>
              {(projectsQ.data ?? []).map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Setor *</label>
            <div className={`flex gap-1 p-1 rounded-xl border border-border ${deal ? "bg-gray-50 pointer-events-none opacity-70" : "bg-[var(--surface)]"}`}>
              {["Online", "Salão"].map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setSetor(opt as any)}
                  className={`flex-1 h-9 rounded-lg text-sm font-semibold transition-colors ${
                    setor === opt ? "bg-white text-[var(--navy)] shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Ocorrência</label>
            <textarea
              className="w-full px-4 py-3 rounded-xl bg-[var(--surface)] border border-border min-h-[80px]"
              placeholder="Descreva o atendimento..."
              value={ocorrencia}
              onChange={(e) => setOcorrencia(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Temperatura *</label>
            <div className="flex gap-1 bg-[var(--surface)] p-1 rounded-xl border border-border">
              {["Frio", "Morno", "Quente"].map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setTemperatura(opt as any)}
                  className={`flex-1 h-9 rounded-lg text-sm font-semibold transition-colors ${
                    temperatura === opt ? "bg-white text-[var(--navy)] shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Visita? *</label>
            <div className="flex gap-1 bg-[var(--surface)] p-1 rounded-xl border border-border">
              {[false, true].map((val) => (
                <button
                  key={String(val)}
                  type="button"
                  onClick={() => setVisita(val)}
                  className={`flex-1 h-9 rounded-lg text-sm font-semibold transition-colors ${
                    visita === val ? "bg-white text-[var(--navy)] shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {val ? "Sim" : "Não"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Venda? *</label>
            <div className="flex gap-1 bg-[var(--surface)] p-1 rounded-xl border border-border">
              {[false, true].map((val) => (
                <button
                  key={String(val)}
                  type="button"
                  onClick={() => setVenda(val)}
                  className={`flex-1 h-9 rounded-lg text-sm font-semibold transition-colors ${
                    venda === val ? "bg-white text-[var(--navy)] shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {val ? "Sim" : "Não"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Status *</label>
            <select
              required
              className="w-full h-12 px-3 rounded-xl bg-[var(--surface)] border border-border"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="Prospect">Prospect</option>
              <option value="Em Tratativa">Em Tratativa</option>
              <option value="Proposta em Análise">Proposta em Análise</option>
              <option value="Proposta Aprovada">Proposta Aprovada</option>
              <option value="Contrato Gerado">Contrato Gerado</option>
              <option value="Contrato Assinado">Contrato Assinado</option>
              <option value="Cancelada">Cancelada</option>
            </select>
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

          {isAdmin && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Corretor (Admin)</label>
              <select
                className="w-full h-12 px-3 rounded-xl bg-[var(--surface)] border border-border"
                value={brokerId}
                onChange={(e) => setBrokerId(e.target.value)}
              >
                {(brokersQ.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.full_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-2 pt-4">
            {deal && (isAdmin || isDirector || deal.broker_id === user?.id) && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Deseja realmente excluir este atendimento?")) {
                    del.mutate();
                  }
                }}
                className="w-12 h-12 flex-shrink-0 flex items-center justify-center rounded-xl bg-red-50 text-red-600"
              >
                <Trash2 size={20} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={save.isPending}
              className="flex-1 h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold disabled:opacity-60"
            >
              {save.isPending ? "Salvando..." : "Salvar Atendimento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}