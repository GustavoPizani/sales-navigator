import { useEffect, useMemo, useState } from "react";
import { Columns3, Plus, Search, Table2 } from "lucide-react";
import { KanbanView } from "./KanbanView";
import { TableView } from "./TableView";
import { NewLeadDialog } from "./NewLeadDialog";
import { useAuth } from "@/hooks/useAuth";
import {
  TEMPERATURAS,
  useFunnels,
  useHierarchyMembers,
  useLeads,
  useUpdateLead,
  type LeadStatus,
} from "@/hooks/useLeads";

type ViewMode = "kanban" | "table";

// Preferências por usuário neste navegador (visualização e funil escolhidos).
function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage indisponível */
  }
}

const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Atendimentos (leads) em Kanban ou planilha. Período e corretor vêm dos
 * filtros do dashboard onde o quadro está inserido.
 */
export function PipelineBoard({
  brokerId = "all",
  from = "",
  to = "",
  dateField = "created_at",
  title = "Atendimentos",
}: {
  brokerId?: string;
  from?: string;
  to?: string;
  dateField?: "created_at" | "updated_at";
  title?: string;
}) {
  const { profile, can } = useAuth();
  // "Somente visualização" em Atendimentos: sem criar nem mover leads (o banco também bloqueia)
  const canEdit = can("leads", "edit");
  const funnelsQ = useFunnels();
  const { members } = useHierarchyMembers();
  const updateLead = useUpdateLead();

  const viewKey = `pipeline:view:${profile?.id}`;
  const funnelKey = `pipeline:funnel:${profile?.id}`;
  const [view, setView] = useState<ViewMode>(() =>
    readPref(viewKey) === "table" ? "table" : "kanban",
  );
  const [funnelId, setFunnelId] = useState<string | undefined>(
    () => readPref(funnelKey) ?? undefined,
  );
  const [status, setStatus] = useState<LeadStatus | "all">("active");
  const [temperatura, setTemperatura] = useState("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const funnels = funnelsQ.data ?? [];
  const funnel =
    funnels.find((f) => f.id === funnelId) ?? funnels.find((f) => f.is_default) ?? funnels[0];

  useEffect(() => {
    writePref(viewKey, view);
  }, [viewKey, view]);
  useEffect(() => {
    if (funnel) writePref(funnelKey, funnel.id);
  }, [funnelKey, funnel]);

  // Ganhos/perdidos entram no período pela data do ganho/perda (como no Real Sales).
  const effectiveDateField =
    status === "won" ? "won_at" : status === "lost" ? "lost_at" : dateField;
  const leadsQ = useLeads({
    funnelId: funnel?.id,
    status,
    brokerId,
    temperatura,
    from,
    to,
    dateField: effectiveDateField,
  });

  const leads = useMemo(() => {
    const all = leadsQ.data ?? [];
    const term = normalize(search.trim());
    if (!term) return all;
    const digits = term.replace(/\D/g, "");
    return all.filter(
      (l) =>
        normalize(l.full_name).includes(term) ||
        (l.client_code && normalize(l.client_code).includes(term)) ||
        (l.email && normalize(l.email).includes(term)) ||
        (digits.length >= 3 && l.phone && l.phone.replace(/\D/g, "").includes(digits)),
    );
  }, [leadsQ.data, search]);

  const wonTotal = leads.reduce((sum, l) => sum + (Number(l.won_value) || 0), 0);

  const onMove = (leadId: string, stageId: string) =>
    updateLead.mutate({ id: leadId, patch: { stage_id: stageId } });

  const selectCls = "h-10 px-3 rounded-lg bg-white border border-border text-sm min-w-0";
  const error = funnelsQ.error || leadsQ.error;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-bold text-[var(--navy)] mr-auto">{title}</h2>
        <div
          className="inline-flex rounded-lg border border-border bg-white p-0.5"
          role="group"
          aria-label="Visualização"
        >
          {(
            [
              ["kanban", "Kanban", Columns3],
              ["table", "Planilha", Table2],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={view === key}
              className={`h-9 px-3 rounded-md text-sm font-medium inline-flex items-center gap-1.5 transition-colors ${view === key ? "bg-[var(--navy)] text-white" : "text-muted-foreground hover:text-[var(--navy)]"}`}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!funnel}
            className="h-10 px-4 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Plus size={14} strokeWidth={2.5} /> Novo Cliente
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:flex gap-2">
        <div className="relative col-span-2 sm:flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            className="w-full h-10 pl-9 pr-3 rounded-lg bg-white border border-border text-sm"
            placeholder="Buscar por nome, ID, telefone ou e-mail"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {funnels.length > 1 && (
          <select
            className={`${selectCls} col-span-2`}
            value={funnel?.id ?? ""}
            onChange={(e) => setFunnelId(e.target.value)}
          >
            {funnels.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
        <select
          className={selectCls}
          value={status}
          onChange={(e) => setStatus(e.target.value as LeadStatus | "all")}
        >
          <option value="all">Todos os Status</option>
          <option value="active">Em andamento</option>
          <option value="won">Ganho</option>
          <option value="lost">Perdido</option>
        </select>
        <select
          className={selectCls}
          value={temperatura}
          onChange={(e) => setTemperatura(e.target.value)}
        >
          <option value="all">Temperatura</option>
          {TEMPERATURAS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="text-xs text-muted-foreground">
        {leadsQ.isLoading
          ? "Carregando…"
          : status === "won"
            ? `${leads.length} ganho${leads.length === 1 ? "" : "s"} no período · ${wonTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
            : `${leads.length} lead${leads.length === 1 ? "" : "s"}`}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs break-words">
          Erro ao carregar os atendimentos: {(error as Error).message}
        </div>
      )}

      {!funnelsQ.isLoading && !funnel && (
        <div className="bg-white rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
          Nenhum funil ativo configurado.
        </div>
      )}

      {funnel &&
        !leadsQ.isLoading &&
        (view === "kanban" ? (
          <KanbanView stages={funnel.stages} leads={leads} onMove={onMove} readOnly={!canEdit} />
        ) : (
          <TableView
            stages={funnel.stages}
            leads={leads}
            onMove={onMove}
            readOnly={!canEdit}
            showWon={status === "won"}
          />
        ))}

      {creating && funnel && (
        <NewLeadDialog funnel={funnel} members={members} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}
