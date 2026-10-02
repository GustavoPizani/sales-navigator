import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import { Download, FileSpreadsheet, PencilLine, X } from "lucide-react";
import toast from "react-hot-toast";
import { AppHeader } from "@/components/AppHeader";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type LogRow = Database["public"]["Tables"]["checkin_log"]["Row"];

const EVENT_INFO: Record<string, { label: string; className: string }> = {
  checkin: { label: "Check-in", className: "bg-green-100 text-green-700" },
  standby: { label: "Stand-by", className: "bg-amber-100 text-amber-800" },
  substituicao: { label: "Substituição", className: "bg-blue-100 text-blue-700" },
  aguardando_admin: { label: "Aguardando decisão", className: "bg-orange-100 text-orange-700" },
  nao_alocado: { label: "Sem vaga", className: "bg-gray-100 text-gray-600" },
  falta: { label: "Falta", className: "bg-red-100 text-red-700" },
  ajuste: { label: "Ajuste", className: "bg-purple-100 text-purple-700" },
};

const hhmm = (t: string) => t.slice(0, 5);
const brDate = (d: string) => d.split("-").reverse().join("/");
const timeOf = (iso: string) => format(new Date(iso), "HH:mm");

function detailOf(r: LogRow): string {
  if (r.event === "substituicao")
    return [
      r.slot_team_name ? `Assumiu vaga da equipe ${r.slot_team_name}` : "Assumiu vaga",
      r.replaced_names ? `no lugar de ${r.replaced_names}` : "(vaga não preenchida)",
      r.created_by_name ? `— decisão de ${r.created_by_name}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  if (r.event === "ajuste")
    return `${r.event_override === "presente" ? "Considerar presente. " : r.event_override === "falta" ? "Considerar falta. " : ""}${r.justification ?? ""} — por ${r.created_by_name ?? "—"}`;
  if (r.event === "nao_alocado" && r.created_by_name) return `Decisão de ${r.created_by_name}`;
  return "";
}

/** Resumo de assiduidade por pessoa, já considerando os ajustes. */
function buildSummary(rows: LogRow[]) {
  type Turn = {
    present: boolean;
    missed: boolean;
    arrival: string | null;
    substituted: boolean;
    override: string | null;
    overrideAt: string;
  };
  const people = new Map<string, { name: string; team: string; turns: Map<string, Turn> }>();
  // ordem cronológica de criação, para o ajuste mais recente prevalecer
  const ordered = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const r of ordered) {
    if (!people.has(r.user_id))
      people.set(r.user_id, { name: r.user_name, team: r.team_name ?? "—", turns: new Map() });
    const p = people.get(r.user_id)!;
    const key = `${r.turn_date}_${hhmm(r.start_time)}`;
    if (!p.turns.has(key))
      p.turns.set(key, {
        present: false,
        missed: false,
        arrival: null,
        substituted: false,
        override: null,
        overrideAt: "",
      });
    const t = p.turns.get(key)!;
    if (r.event === "checkin" || r.event === "standby") {
      t.present = true;
      if (!t.arrival) t.arrival = r.occurred_at;
    } else if (r.event === "substituicao") t.substituted = true;
    else if (r.event === "falta") t.missed = true;
    else if (r.event === "ajuste" && r.event_override) {
      t.override = r.event_override;
      t.overrideAt = r.occurred_at;
    }
  }
  return [...people.entries()]
    .map(([id, p]) => {
      const presentDays = new Set<string>();
      let absences = 0;
      let substitutions = 0;
      const arrivals: number[] = [];
      for (const [key, t] of p.turns) {
        const present = t.override ? t.override === "presente" : t.present;
        const missed = t.override ? t.override === "falta" : t.missed && !t.present;
        if (present) presentDays.add(key.split("_")[0]);
        if (missed) absences++;
        if (t.substituted) substitutions++;
        const arrival = t.arrival ?? (t.override === "presente" ? t.overrideAt : null);
        if (present && arrival) {
          const d = new Date(arrival);
          arrivals.push(d.getHours() * 60 + d.getMinutes());
        }
      }
      const avg = arrivals.length
        ? Math.round(arrivals.reduce((a, b) => a + b, 0) / arrivals.length)
        : null;
      return {
        id,
        name: p.name,
        team: p.team,
        presentDays: presentDays.size,
        absences,
        substitutions,
        avgArrival:
          avg == null
            ? "—"
            : `${String(Math.floor(avg / 60)).padStart(2, "0")}:${String(avg % 60).padStart(2, "0")}`,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Log de check-ins (somente ADM e RH). `embedded`: dentro da aba da tela de
 * Check-in, sem cabeçalho próprio.
 */
export function CheckinLog({ embedded = false }: { embedded?: boolean }) {
  const [from, setFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [userId, setUserId] = useState("all");
  const [team, setTeam] = useState("all");
  const [tab, setTab] = useState<"rows" | "summary">("rows");
  const [adjusting, setAdjusting] = useState<LogRow | null>(null);

  const logQ = useQuery({
    queryKey: ["checkin-log", from, to],
    queryFn: async (): Promise<LogRow[]> => {
      const { data, error } = await supabase
        .from("checkin_log")
        .select("*")
        .gte("turn_date", from)
        .lte("turn_date", to)
        .order("occurred_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const all = logQ.data ?? [];
  const users = useMemo(
    () =>
      [...new Map(all.map((r) => [r.user_id, r.user_name])).entries()].sort((a, b) =>
        a[1].localeCompare(b[1]),
      ),
    [all],
  );
  const teams = useMemo(
    () => [...new Set(all.map((r) => r.team_name).filter(Boolean) as string[])].sort(),
    [all],
  );
  const rows = useMemo(
    () =>
      all.filter(
        (r) =>
          (userId === "all" || r.user_id === userId) && (team === "all" || r.team_name === team),
      ),
    [all, userId, team],
  );
  const summary = useMemo(() => buildSummary(rows), [rows]);

  const exportRows = () =>
    rows.map((r) => ({
      Data: brDate(r.turn_date),
      Turno: `${hhmm(r.start_time)}–${hhmm(r.end_time)}`,
      Hora: timeOf(r.occurred_at),
      Pessoa: r.user_name,
      Equipe: r.team_name ?? "",
      Evento: EVENT_INFO[r.event]?.label ?? r.event,
      Local: r.location_label ?? "",
      "Distância (m)": r.distance_m ?? "",
      Latitude: r.lat ?? "",
      Longitude: r.lng ?? "",
      Detalhe: detailOf(r),
    }));
  const exportSummary = () =>
    summary.map((s) => ({
      Pessoa: s.name,
      Equipe: s.team,
      "Dias presentes": s.presentDays,
      Faltas: s.absences,
      Substituições: s.substitutions,
      "Horário médio de chegada": s.avgArrival,
    }));

  const downloadCsv = () => {
    const data = tab === "rows" ? exportRows() : exportSummary();
    if (!data.length) return toast("Nada para exportar.", { icon: "ℹ️" });
    const cols = Object.keys(data[0]);
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      cols.map(esc).join(";"),
      ...data.map((d) => cols.map((c) => esc((d as Record<string, unknown>)[c])).join(";")),
    ].join("\r\n");
    save(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `checkins_${from}_${to}.csv`);
  };

  const downloadXlsx = async () => {
    if (!rows.length) return toast("Nada para exportar.", { icon: "ℹ️" });
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    for (const [name, data] of [
      ["Registros", exportRows()],
      ["Assiduidade", exportSummary()],
    ] as const) {
      const ws = wb.addWorksheet(name);
      if (!data.length) continue;
      const cols = Object.keys(data[0]);
      ws.columns = cols.map((c) => ({ header: c, key: c, width: c === "Detalhe" ? 60 : 20 }));
      ws.getRow(1).font = { bold: true };
      data.forEach((d) => ws.addRow(d));
    }
    const buf = await wb.xlsx.writeBuffer();
    save(
      new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      `checkins_${from}_${to}.xlsx`,
    );
  };

  const inputCls = "h-10 px-3 rounded-lg bg-white border border-border text-sm";

  return (
    <div className={embedded ? undefined : "pb-nav"}>
      {!embedded && <AppHeader title="Log de check-ins" />}
      <div className={embedded ? "space-y-3" : "px-4 pt-4 max-w-6xl mx-auto space-y-3"}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-[11px] text-muted-foreground block mb-0.5">De</span>
            <input
              type="date"
              className={inputCls}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground block mb-0.5">Até</span>
            <input
              type="date"
              className={inputCls}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <select
            className={inputCls}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            aria-label="Pessoa"
          >
            <option value="all">Todas as pessoas</option>
            {users.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            className={inputCls}
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            aria-label="Equipe"
          >
            <option value="all">Todas as equipes</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                Equipe {t}
              </option>
            ))}
          </select>
          <div className="ml-auto flex gap-2">
            <button
              onClick={downloadCsv}
              className="h-10 px-3 rounded-lg bg-white border border-border text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <Download size={15} /> CSV
            </button>
            <button
              onClick={downloadXlsx}
              className="h-10 px-3 rounded-lg bg-[var(--navy)] text-white text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <FileSpreadsheet size={15} /> Excel
            </button>
          </div>
        </div>

        <div className="inline-flex rounded-lg border border-border bg-white p-0.5" role="tablist">
          {(
            [
              ["rows", `Registros (${rows.length})`],
              ["summary", "Assiduidade"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`h-9 px-3 rounded-md text-sm font-medium ${tab === k ? "bg-[var(--navy)] text-white" : "text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {logQ.error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs">
            Erro ao carregar o log: {(logQ.error as Error).message}
          </div>
        )}
        {logQ.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {!logQ.isLoading && tab === "rows" && (
          <div className="bg-white rounded-2xl border border-border overflow-x-auto">
            {rows.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Nenhum registro no período.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[var(--surface)] text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-3 py-2.5 font-semibold">Data</th>
                    <th className="px-3 py-2.5 font-semibold">Turno</th>
                    <th className="px-3 py-2.5 font-semibold">Hora</th>
                    <th className="px-3 py-2.5 font-semibold">Pessoa</th>
                    <th className="px-3 py-2.5 font-semibold">Equipe</th>
                    <th className="px-3 py-2.5 font-semibold">Evento</th>
                    <th className="px-3 py-2.5 font-semibold">Local</th>
                    <th className="px-3 py-2.5 font-semibold">Detalhe</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => {
                    const info = EVENT_INFO[r.event] ?? {
                      label: r.event,
                      className: "bg-gray-100 text-gray-600",
                    };
                    return (
                      <tr key={r.id}>
                        <td className="px-3 py-2 whitespace-nowrap">{brDate(r.turn_date)}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                          {hhmm(r.start_time)}–{hhmm(r.end_time)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap font-semibold text-[var(--navy)]">
                          {timeOf(r.occurred_at)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.user_name}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                          {r.team_name ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span
                            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${info.className}`}
                          >
                            {info.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.location_label ?? "—"}
                          {r.distance_m != null && (
                            <span className="text-[11px] text-muted-foreground">
                              {" "}
                              · {r.distance_m} m
                            </span>
                          )}
                          {r.lat != null && r.lng != null && (
                            <a
                              href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=18/${r.lat}/${r.lng}`}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-1.5 text-[11px] text-[var(--gold-dark)] underline"
                            >
                              mapa
                            </a>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground min-w-[220px]">
                          {detailOf(r)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {r.event !== "ajuste" && (
                            <button
                              onClick={() => setAdjusting(r)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-[var(--navy)] hover:bg-[var(--surface)]"
                              aria-label="Registrar ajuste"
                              title="Registrar ajuste"
                            >
                              <PencilLine size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {!logQ.isLoading && tab === "summary" && (
          <div className="bg-white rounded-2xl border border-border overflow-x-auto">
            {summary.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Nenhum registro no período.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[var(--surface)] text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-3 py-2.5 font-semibold">Pessoa</th>
                    <th className="px-3 py-2.5 font-semibold">Equipe</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Dias presentes</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Faltas</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Substituições</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Chegada média</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {summary.map((s) => (
                    <tr key={s.id}>
                      <td className="px-3 py-2 font-medium text-[var(--navy)] whitespace-nowrap">
                        {s.name}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {s.team}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">{s.presentDays}</td>
                      <td
                        className={`px-3 py-2 text-right font-semibold ${s.absences > 0 ? "text-red-600" : ""}`}
                      >
                        {s.absences}
                      </td>
                      <td className="px-3 py-2 text-right">{s.substitutions}</td>
                      <td className="px-3 py-2 text-right">{s.avgArrival}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Os registros não podem ser editados nem excluídos. Correções são feitas por um ajuste, que
          fica gravado com a justificativa e o autor.
        </p>
      </div>

      {adjusting && <AdjustSheet row={adjusting} onClose={() => setAdjusting(null)} />}
    </div>
  );
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function AdjustSheet({ row, onClose }: { row: LogRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [justification, setJustification] = useState("");
  const [override, setOverride] = useState<"" | "presente" | "falta">("");
  const [time, setTime] = useState("");

  const adjust = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("crm_checkin_log_adjust", {
        p_log_id: row.id,
        p_justification: justification,
        p_event_override: override || undefined,
        p_occurred_at: time ? new Date(`${row.turn_date}T${time}:00`).toISOString() : undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checkin-log"] });
      toast.success("Ajuste registrado.");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          adjust.mutate();
        }}
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--navy)]">Registrar ajuste</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground p-1"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          {row.user_name} · {brDate(row.turn_date)} · turno {hhmm(row.start_time)}–
          {hhmm(row.end_time)} · {EVENT_INFO[row.event]?.label ?? row.event}
        </p>
        <label className="block">
          <span className="text-xs text-muted-foreground font-medium mb-1 block">
            Efeito na assiduidade
          </span>
          <select
            className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
            value={override}
            onChange={(e) => setOverride(e.target.value as "" | "presente" | "falta")}
          >
            <option value="">Só observação (não muda presença/falta)</option>
            <option value="presente">Considerar presente</option>
            <option value="falta">Considerar falta</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground font-medium mb-1 block">
            Horário corrigido (opcional)
          </span>
          <input
            type="time"
            className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground font-medium mb-1 block">
            Justificativa *
          </span>
          <textarea
            className="w-full min-h-[90px] p-3 rounded-xl bg-[var(--surface)] border border-border text-sm"
            placeholder="Ex.: atestado médico entregue; falha no GPS confirmada pelo gerente…"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
        </label>
        <p className="text-[11px] text-muted-foreground">
          O registro original é mantido; o ajuste fica gravado com o seu nome.
        </p>
        <button
          type="submit"
          disabled={!justification.trim() || adjust.isPending}
          className="w-full h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50"
        >
          {adjust.isPending ? "Salvando…" : "Registrar ajuste"}
        </button>
      </form>
    </div>
  );
}
