import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, MessageCircle } from "lucide-react";
import { LeadBadges } from "./LeadCard";
import { whatsappUrl, type FunnelStage, type Lead } from "@/hooks/useLeads";

type SortKey =
  | "full_name"
  | "client_code"
  | "stage"
  | "temperatura"
  | "project"
  | "broker"
  | "source"
  | "created_at"
  | "stage_changed_at"
  | "won_value"
  | "won_at";

const TEMP_ORDER: Record<string, number> = { Quente: 0, Morno: 1, Frio: 2 };

export function TableView({
  stages,
  leads,
  onMove,
  showWon = false,
  readOnly = false,
}: {
  stages: FunnelStage[];
  leads: Lead[];
  onMove: (leadId: string, stageId: string) => void;
  /** colunas de valor e data da venda (filtro "Ganho") */
  showWon?: boolean;
  /** somente visualização: etapa não pode ser trocada */
  readOnly?: boolean;
}) {
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({
    key: "created_at",
    asc: false,
  });
  const stageOrder = useMemo(() => new Map(stages.map((s, i) => [s.id, i])), [stages]);

  const sorted = useMemo(() => {
    const val = (l: Lead): string | number => {
      switch (sort.key) {
        case "stage":
          return stageOrder.get(l.stage_id) ?? 99;
        case "temperatura":
          return l.temperatura ? TEMP_ORDER[l.temperatura] : 9;
        case "project":
          return l.project?.name?.toLowerCase() ?? "￿";
        case "broker":
          return l.broker?.full_name?.toLowerCase() ?? "￿";
        case "won_value":
          return Number(l.won_value) || 0;
        case "client_code":
          return l.client_code?.toLowerCase() ?? "￿";
        case "full_name":
          return l.full_name.toLowerCase();
        default:
          return (l as any)[sort.key] ?? "";
      }
    };
    return [...leads].sort((a, b) => {
      const va = val(a),
        vb = val(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.asc ? cmp : -cmp;
    });
  }, [leads, sort, stageOrder]);

  const Th = ({
    k,
    children,
    className = "",
  }: {
    k: SortKey;
    children: React.ReactNode;
    className?: string;
  }) => (
    <th className={`px-3 py-2.5 text-left font-semibold whitespace-nowrap ${className}`}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-[var(--navy)]"
        onClick={() =>
          setSort((s) => ({
            key: k,
            asc: s.key === k ? !s.asc : k !== "created_at" && k !== "stage_changed_at",
          }))
        }
      >
        {children}
        {sort.key === k && (sort.asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );

  if (leads.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
        Nenhum lead encontrado
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-[var(--surface)] text-xs text-muted-foreground border-b border-border">
          <tr>
            <Th k="full_name" className="sticky left-0 bg-[var(--surface)] z-10">
              Nome
            </Th>
            <Th k="client_code">ID do cliente</Th>
            <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">Contato</th>
            <Th k="stage">Etapa</Th>
            <Th k="temperatura">Situação</Th>
            <Th k="project">Imóvel</Th>
            <Th k="broker">Corretor</Th>
            <Th k="source">Origem</Th>
            <Th k="created_at">Criado em</Th>
            <Th k="stage_changed_at">Na etapa desde</Th>
            {showWon && <Th k="won_value">Valor da venda</Th>}
            {showWon && <Th k="won_at">Data do ganho</Th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map((lead) => (
            <tr
              key={lead.id}
              className="hover:bg-[var(--surface)] cursor-pointer"
              onClick={() => navigate({ to: "/leads/$leadId", params: { leadId: lead.id } })}
            >
              <td className="px-3 py-2.5 font-semibold text-[var(--navy)] whitespace-nowrap sticky left-0 bg-white max-w-[200px] truncate">
                {lead.full_name}
              </td>
              <td className="px-3 py-2.5 text-xs whitespace-nowrap">{lead.client_code || "—"}</td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <div className="min-w-0">
                    <div>{lead.phone || "—"}</div>
                    {lead.email && <div className="truncate max-w-[180px]">{lead.email}</div>}
                  </div>
                  {lead.phone && (
                    <a
                      href={whatsappUrl(lead.phone)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 rounded-full hover:bg-green-500/15"
                      aria-label="Abrir WhatsApp"
                    >
                      <MessageCircle size={14} className="text-green-600" />
                    </a>
                  )}
                </div>
              </td>
              <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                <select
                  className="h-8 pl-2 pr-6 rounded-lg border border-border text-xs font-medium bg-white"
                  style={{
                    borderLeft: `4px solid ${stages.find((s) => s.id === lead.stage_id)?.color ?? "#e5e7eb"}`,
                  }}
                  value={lead.stage_id}
                  disabled={readOnly}
                  onChange={(e) => onMove(lead.id, e.target.value)}
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <div className="flex gap-1">
                  <LeadBadges lead={lead} />
                </div>
              </td>
              <td className="px-3 py-2.5 text-xs whitespace-nowrap max-w-[160px] truncate">
                {lead.project?.name ?? "—"}
              </td>
              <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                {lead.broker ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: lead.broker.color }}
                    />
                    {lead.broker.full_name}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2.5 text-xs whitespace-nowrap capitalize">
                {lead.campaign || lead.source}
              </td>
              <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                {format(new Date(lead.created_at), "dd/MM/yy HH:mm")}
              </td>
              <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                {format(new Date(lead.stage_changed_at), "dd/MM/yy")}
              </td>
              {showWon && (
                <td className="px-3 py-2.5 text-xs whitespace-nowrap font-semibold text-green-700">
                  {lead.won_value != null
                    ? Number(lead.won_value).toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })
                    : "—"}
                </td>
              )}
              {showWon && (
                <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                  {lead.won_at ? format(new Date(lead.won_at), "dd/MM/yy") : "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
