import { ReactNode, useState, useMemo } from "react";
import { format, parseISO } from "date-fns";
import { ArrowUp, ArrowDown, Check, X, Search } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList, Cell } from "recharts";

const STATUS_HEX: Record<string, string> = {
  "Prospect": "#6B7280",
  "Em Tratativa": "#0891B2",
  "Proposta em Análise": "#2563EB",
  "Proposta Aprovada": "#4F46E5",
  "Contrato Gerado": "#D97706",
  "Contrato Assinado": "#16A34A",
  "Venda Pendente": "#F59E0B",
  "Cancelada": "#DC2626",
};

export const formatBRL = (val: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);

export const statusColors: Record<string, string> = {
  "Prospect": "bg-gray-100 text-gray-700",
  "Em Tratativa": "bg-cyan-100 text-cyan-700",
  "Proposta em Análise": "bg-blue-100 text-blue-700",
  "Proposta Aprovada": "bg-indigo-100 text-indigo-700",
  "Contrato Gerado": "bg-amber-100 text-amber-700",
  "Contrato Assinado": "bg-green-100 text-green-700",
  "Venda Pendente": "bg-yellow-100 text-yellow-700",
  "Cancelada": "bg-red-100 text-red-700",
};

export const temperaturaColors = { "Frio": "bg-slate-100 text-slate-700", "Morno": "bg-amber-100 text-amber-700", "Quente": "bg-red-100 text-red-700" };
export const setorColors = { "Online": "bg-blue-100 text-blue-700", "Salão": "bg-amber-100 text-amber-700" };

export function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[var(--navy)] rounded-2xl p-4 flex flex-col justify-center items-center shadow-sm text-center min-h-[100px]">
      <div className="text-2xl sm:text-3xl font-bold text-white mb-1">{value}</div>
      <div className="text-xs sm:text-xs font-semibold text-[var(--gold)] uppercase tracking-wide leading-tight">{label}</div>
    </div>
  );
}

export function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="bg-white p-4 rounded-2xl shadow-sm border border-border flex flex-col">
      <h3 className={`text-sm font-semibold text-[var(--navy)] italic text-center ${subtitle ? "" : "mb-4"}`}>{title}</h3>
      {subtitle && <p className="text-xs text-muted-foreground text-center mt-0.5 mb-4">{subtitle}</p>}
      <div className="flex-1 w-full min-w-0">{children}</div>
    </div>
  );
}

export function MiniAvatar({ name, color }: { name?: string; color?: string }) {
  const initials = name ? name.split(" ").slice(0, 2).map((n: string) => n[0]).join("").toUpperCase() : "?";
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ backgroundColor: color || "#CCC" }}>
      {initials}
    </div>
  );
}

const CHART_TOOLTIP = { borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" };
const formatBRLCompact = (val: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(val);

function ChartEmpty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground text-center py-10">{children}</p>;
}

/** Total do mês numa barra só, dividida entre os que avançaram (yes) e os que não (no). */
function MonthlySplitChart({ title, subtitle, data, yes, no, empty }: {
  title: string;
  subtitle: string;
  data: { name: string; Sim: number; Não: number }[];
  yes: string;
  no: string;
  empty: string;
}) {
  const hasData = data.some((d) => d.Sim > 0 || d.Não > 0);
  return (
    <ChartCard title={title} subtitle={subtitle}>
      {!hasData ? (
        <ChartEmpty>{empty}</ChartEmpty>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#6B7280" }} />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#6B7280" }} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} contentStyle={CHART_TOOLTIP} />
            <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: "8px" }} />
            <Bar dataKey="Sim" name={yes} stackId="total" fill="#B28069" maxBarSize={56}>
              <LabelList dataKey="Sim" position="center" style={{ fontSize: 11, fill: "#FFFFFF", fontWeight: 700 }} formatter={(v: number) => (v > 0 ? v : "")} />
            </Bar>
            <Bar dataKey="Não" name={no} stackId="total" fill="#D4D4D4" radius={[4, 4, 0, 0]} maxBarSize={56}>
              <LabelList dataKey="Não" position="center" style={{ fontSize: 11, fill: "#2D2D2D", fontWeight: 700 }} formatter={(v: number) => (v > 0 ? v : "")} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

export function DashboardCharts({ dbData }: { dbData: any }) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MonthlySplitChart
          title="Atendimentos por mês"
          subtitle="Quantos clientes do mês chegaram a visitar"
          data={dbData.chart1Data}
          yes="Com visita"
          no="Sem visita"
          empty="Nenhum atendimento no período."
        />
        <MonthlySplitChart
          title="Visitas por mês"
          subtitle="Quantas visitas do mês viraram venda"
          data={dbData.chart2Data}
          yes="Viraram venda"
          no="Sem venda"
          empty="Nenhuma visita no período."
        />
      </div>
      <div className="grid grid-cols-1 gap-4">
        <ChartCard title="Valor vendido por mês" subtitle="Soma das vendas aprovadas">
          {!dbData.chart5Data.some((d: any) => d.valor > 0) ? (
            <ChartEmpty>Nenhuma venda no período.</ChartEmpty>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dbData.chart5Data} margin={{ top: 24, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#6B7280" }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6B7280" }} tickFormatter={formatBRLCompact} width={70} />
                <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} formatter={(v: number) => [formatBRL(v), "Vendido"]} contentStyle={CHART_TOOLTIP} />
                <Bar dataKey="valor" fill="#2D2D2D" radius={[4, 4, 0, 0]} maxBarSize={56}>
                  <LabelList dataKey="valor" position="top" formatter={(v: number) => (v > 0 ? formatBRLCompact(v) : "")} style={{ fontSize: 11, fill: "#6B7280", fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </>
  );
}

export function StatusChart({ data }: { data: any[] }) {
  const filtered = data.filter((d) => d.count > 0);
  // Sem dados o card continua no lugar (com aviso), para não deixar o vizinho sozinho na linha.
  if (filtered.length === 0)
    return (
      <ChartCard title="Atendimentos por Status">
        <ChartEmpty>Nenhum atendimento no período.</ChartEmpty>
      </ChartCard>
    );
  return (
    <ChartCard title="Atendimentos por Status">
      <ResponsiveContainer width="100%" height={filtered.length * 46 + 16}>
        <BarChart data={filtered} layout="vertical" margin={{ top: 0, right: 60, left: 0, bottom: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6B7280" }} width={145} />
          <Tooltip 
            cursor={{ fill: "rgba(0,0,0,0.04)" }} 
            content={({ active, payload, label }: any) => {
              if (active && payload && payload.length) {
                return (
                  <div className="bg-white p-3 rounded-lg shadow-md border border-border">
                    <p className="font-semibold text-sm text-[var(--navy)] mb-1">{label}</p>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p>Atendimentos: <span className="font-medium text-[var(--navy)]">{payload[0].value}</span></p>
                      {payload[0].payload.Valor && <p>Valor Total: <span className="font-medium text-[var(--navy)]">{payload[0].payload.Valor}</span></p>}
                    </div>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={22}>
            {filtered.map((entry) => (
              <Cell key={entry.name} fill={entry.color ?? STATUS_HEX[entry.name] ?? "#6B7280"} />
            ))}
            <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: "#6B7280", fontWeight: 600 }} formatter={(v: number) => (v > 0 ? v : "")} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function VisitsByProductChart({ data }: { data: { name: string; visitas: number; total: number }[] }) {
  if (data.length === 0)
    return (
      <ChartCard title="Visitas por Produto">
        <ChartEmpty>Nenhuma visita no período.</ChartEmpty>
      </ChartCard>
    );
  const sliced = data.slice(0, 15);
  return (
    <ChartCard title="Visitas por Produto">
      <ResponsiveContainer width="100%" height={sliced.length * 46 + 16}>
        <BarChart data={sliced} layout="vertical" margin={{ top: 0, right: 60, left: 0, bottom: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#6B7280" }} width={145} />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
            formatter={(value: any, _name: any, item: any) => [`${value} de ${item.payload.total} atendimentos`, "Visitas"]}
          />
          <Bar dataKey="visitas" name="Visitas" fill="#2D2D2D" radius={[0, 4, 4, 0]} barSize={22}>
            <LabelList dataKey="visitas" position="right" style={{ fontSize: 11, fill: "#6B7280", fontWeight: 600 }} formatter={(v: number) => (v > 0 ? v : "")} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function AtendimentosTable({ atendimentos, isAdmin, onRowClick, onRowContextMenu }: {
  atendimentos: any[];
  isAdmin: boolean;
  onRowClick?: (a: any) => void;
  onRowContextMenu?: (e: any, a: any) => void;
}) {
  const [sortConfig, setSortConfig] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "data", dir: "desc" });
  const [page, setPage] = useState(1);
  const [phoneSearch, setPhoneSearch] = useState("");
  const [clientIdSearch, setClientIdSearch] = useState("");

  const filtered = useMemo(() => {
    let result = atendimentos;
    if (phoneSearch.trim()) {
      const digits = phoneSearch.replace(/\D/g, "");
      result = result.filter((a) => a.telefone && a.telefone.replace(/\D/g, "").includes(digits));
    }
    if (clientIdSearch.trim()) {
      result = result.filter(a => a.id_cliente && a.id_cliente.toLowerCase().includes(clientIdSearch.toLowerCase()));
    }
    return result;
  }, [atendimentos, phoneSearch, clientIdSearch]);

  const sortedAtendimentos = useMemo(() => {
    let sortable = [...filtered];
    sortable.sort((a, b) => {
      let valA = a[sortConfig.key];
      let valB = b[sortConfig.key];
      if (sortConfig.key === "corretor") { valA = a.profiles?.full_name || ""; valB = b.profiles?.full_name || ""; }
      else if (sortConfig.key === "valor") { valA = Number(a.valor) || 0; valB = Number(b.valor) || 0; }
      if (valA < valB) return sortConfig.dir === "asc" ? -1 : 1;
      if (valA > valB) return sortConfig.dir === "asc" ? 1 : -1;
      return 0;
    });
    return sortable;
  }, [filtered, sortConfig]);

  const paginated = sortedAtendimentos.slice((page - 1) * 20, page * 20);

  const footerTotals = useMemo(() => {
    return atendimentos.reduce((acc, a) => {
        if (a.visita) acc.visitas++; if (a.venda) acc.vendas++; acc.valor += Number(a.valor) || 0; return acc;
      }, { visitas: 0, vendas: 0, valor: 0 });
  }, [atendimentos]);

  const handleSort = (key: string) => {
    setSortConfig((prev) => ({ key, dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc" }));
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortConfig.key !== col) return null;
    return sortConfig.dir === "asc" ? <ArrowUp size={14} className="inline ml-1" /> : <ArrowDown size={14} className="inline ml-1" />;
  };

  const tableCols = [
    { key: "data", label: "Data" },
    { key: "data_atualizacao", label: "Atualização" },
    { key: "id_cliente", label: "Id do Cliente" },
    { key: "nome_cliente", label: "Nome Cliente" },
    { key: "telefone", label: "Telefone" },
    { key: "email", label: "E-mail" },
    { key: "produto", label: "Produto" },
    { key: "ocorrencia", label: "Ocorrência" },
    { key: "visita", label: "Visita" },
    { key: "venda", label: "Venda" },
    { key: "temperatura", label: "Temperatura" },
    { key: "status", label: "Status" },
    { key: "valor", label: "Valor" },
    { key: "corretor", label: "Corretor" },
    { key: "setor", label: "Setor" },
  ];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              className="w-full h-9 pl-8 pr-3 rounded-lg bg-[var(--surface)] border border-border text-sm outline-none focus:border-[var(--navy)]"
              placeholder="Buscar por telefone..."
              value={phoneSearch}
              onChange={(e) => { setPhoneSearch(e.target.value); setPage(1); }}
            />
            {phoneSearch && (
              <button onClick={() => { setPhoneSearch(""); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-[var(--navy)]">
                <X size={13} />
              </button>
            )}
          </div>
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              className="w-full h-9 pl-8 pr-3 rounded-lg bg-[var(--surface)] border border-border text-sm outline-none focus:border-[var(--navy)]"
              placeholder="Buscar por ID do Cliente..."
              value={clientIdSearch}
              onChange={(e) => { setClientIdSearch(e.target.value); setPage(1); }}
            />
            {clientIdSearch && (
              <button onClick={() => { setClientIdSearch(""); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-[var(--navy)]">
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left border-collapse">
          <thead className="bg-[var(--surface)] text-[var(--navy)] text-xs uppercase">
            <tr>
              {tableCols.map((col) => {
                if (!isAdmin && col.key === "corretor") return null;
                return (
                  <th key={col.key} className="px-4 py-3 cursor-pointer hover:bg-gray-200 transition-colors whitespace-nowrap" onClick={() => handleSort(col.key)}>
                    {col.label} <SortIcon col={col.key} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 15 : 14} className="px-4 py-8 text-center text-muted-foreground">Nenhum atendimento encontrado para o período selecionado.</td>
              </tr>
            ) : (
              paginated.map((a) => (
                <tr
                  key={a.id}
                  className={`border-b border-border hover:bg-[#FDF8EC] transition-colors ${onRowClick ? "cursor-pointer" : ""}`}
                  onClick={() => onRowClick?.(a)}
                  onContextMenu={(e) => onRowContextMenu?.(e, a)}
                >
                  <td className="px-4 py-3 whitespace-nowrap">{format(parseISO(a.data), "dd/MM/yyyy")}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{a.data_atualizacao ? format(parseISO(a.data_atualizacao), "dd/MM/yyyy") : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{a.id_cliente || "—"}</td>
                  <td className="px-4 py-3 font-medium text-[var(--navy)]">{a.nome_cliente}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap min-w-[140px]">{a.telefone || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{a.email || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{a.produto || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[150px] truncate" title={a.ocorrencia}>{a.ocorrencia || "—"}</td>
                  <td className="px-4 py-3 text-center">{a.visita ? <Check size={16} className="text-green-600 inline" /> : <X size={16} className="text-red-500 inline" />}</td>
                  <td className="px-4 py-3 text-center">{a.venda ? <Check size={16} className="text-green-600 inline" /> : <X size={16} className="text-red-500 inline" />}</td>
                  <td className="px-4 py-3">{a.temperatura && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${temperaturaColors[a.temperatura as keyof typeof temperaturaColors]}`}>{a.temperatura}</span>}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${statusColors[a.status as keyof typeof statusColors]}`}>{a.status}</span></td>
                  <td className="px-4 py-3 text-right font-medium text-[var(--navy)] whitespace-nowrap">{formatBRL(Number(a.valor) || 0)}</td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2"><MiniAvatar name={a.profiles?.full_name} color={a.profiles?.color} /><span className="truncate max-w-[120px]">{a.profiles?.full_name}</span></div>
                    </td>
                  )}
                  <td className="px-4 py-3">{a.setor && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${setorColors[a.setor as keyof typeof setorColors]}`}>{a.setor}</span>}</td>
                </tr>
              ))
            )}
          </tbody>
          {paginated.length > 0 && (
            <tfoot className="bg-[var(--surface)] text-[var(--navy)] font-bold text-xs border-t-2 border-[var(--navy)]">
              <tr>
                <td colSpan={8} className="px-4 py-3 text-right uppercase">Totais:</td>
                <td className="px-4 py-3 text-center">{footerTotals.visitas}</td>
                <td className="px-4 py-3 text-center">{footerTotals.vendas}</td>
                <td colSpan={2}></td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{formatBRL(footerTotals.valor)}</td>
                <td colSpan={isAdmin ? 2 : 1}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {sortedAtendimentos.length > 0 && (
        <div className="flex items-center justify-between px-4 py-3 bg-white border-t border-border">
          <div className="text-sm text-muted-foreground">Mostrando {(page - 1) * 20 + 1}–{Math.min(page * 20, sortedAtendimentos.length)} de {sortedAtendimentos.length} registros</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 rounded-md border border-border disabled:opacity-50 text-sm font-medium">Anterior</button>
            <button onClick={() => setPage((p) => Math.min(Math.ceil(sortedAtendimentos.length / 20), p + 1))} disabled={page === Math.ceil(sortedAtendimentos.length / 20)} className="px-3 py-1 rounded-md border border-border disabled:opacity-50 text-sm font-medium">Próximo</button>
          </div>
        </div>
      )}
    </div>
  );
}