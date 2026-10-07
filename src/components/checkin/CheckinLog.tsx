import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { Download, FileSpreadsheet, PencilLine, X } from "lucide-react";
import toast from "react-hot-toast";
import { AppHeader } from "@/components/AppHeader";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useShiftPeriods } from "@/hooks/useRoulette";

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
const eventInfo = (event: string) =>
  EVENT_INFO[event] ?? { label: event, className: "bg-gray-100 text-gray-600" };

const PAGE_SIZE = 100;

const hhmm = (t: string) => t.slice(0, 5);
const brDate = (d: string) => d.split("-").reverse().join("/");
const timeOf = (iso: string) => format(new Date(iso), "HH:mm");
const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/** O que o ajuste determinou, em texto. */
function overrideLabel(override: string | null): string {
  return override === "presente"
    ? "Considerar presente"
    : override === "falta"
      ? "Considerar falta"
      : "Observação";
}

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
    return `${overrideLabel(r.event_override)}. ${r.justification ?? ""} — por ${r.created_by_name ?? "—"}`;
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
      let presences = 0;
      let absences = 0;
      let justified = 0;
      let substitutions = 0;
      const arrivals: number[] = [];
      for (const [key, t] of p.turns) {
        const present = t.override ? t.override === "presente" : t.present;
        const missed = t.override ? t.override === "falta" : t.missed && !t.present;
        if (present) {
          presences++;
          presentDays.add(key.split("_")[0]);
        }
        if (missed) absences++;
        // falta registrada pelo sistema que um ajuste transformou em presença
        if (t.missed && !t.present && t.override === "presente") justified++;
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
      const turns = presences + absences;
      return {
        id,
        name: p.name,
        team: p.team,
        turns,
        presences,
        presentDays: presentDays.size,
        absences,
        justified,
        substitutions,
        rate: turns > 0 ? Math.round((presences / turns) * 100) : null,
        avgArrival:
          avg == null
            ? "—"
            : `${String(Math.floor(avg / 60)).padStart(2, "0")}:${String(avg % 60).padStart(2, "0")}`,
      };
    })
    // quem mais falta primeiro
    .sort((a, b) => b.absences - a.absences || a.name.localeCompare(b.name));
}

/**
 * Log de check-ins (somente ADM e RH). `embedded`: dentro da aba da tela de
 * Check-in, sem cabeçalho próprio.
 */
export function CheckinLog({ embedded = false }: { embedded?: boolean }) {
  // RH lê e exporta; só o admin registra ajustes e vê os filtros de ajuste (o banco também bloqueia)
  const { profile, isSuperAdmin: canAdjust } = useAuth();
  const periods = useShiftPeriods();
  const [from, setFrom] = useState(ymd(startOfMonth(new Date())));
  const [to, setTo] = useState(ymd(new Date()));
  const [userId, setUserId] = useState("all");
  const [team, setTeam] = useState("all");
  const [event, setEvent] = useState("all");
  const [tab, setTab] = useState<"rows" | "summary">("rows");
  const [adjusting, setAdjusting] = useState<LogRow | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const logQ = useQuery({
    queryKey: ["checkin-log", from, to],
    enabled: !!from && !!to,
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
  // ajuste mais recente de cada registro: o original aparece marcado como "Ajustado"
  const adjustOf = useMemo(() => {
    const map = new Map<string, LogRow>();
    [...all]
      .filter((r) => r.event === "ajuste" && r.adjusts_id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .forEach((r) => map.set(r.adjusts_id!, r));
    return map;
  }, [all]);
  // pessoa e equipe valem para tudo (lista, assiduidade e relatório)
  const scoped = useMemo(
    () =>
      all.filter(
        (r) =>
          (userId === "all" || r.user_id === userId) && (team === "all" || r.team_name === team),
      ),
    [all, userId, team],
  );
  // o filtro de evento vale só para a lista de registros
  const rows = useMemo(
    () =>
      scoped.filter((r) =>
        event === "all"
          ? true
          : event === "falta_aberta"
            ? r.event === "falta" && !adjustOf.has(r.id)
            : r.event === event,
      ),
    [scoped, event, adjustOf],
  );
  const summary = useMemo(() => buildSummary(scoped), [scoped]);

  useEffect(() => setVisible(PAGE_SIZE), [from, to, userId, team, event]);

  const turnName = (r: { start_time: string }) =>
    periods.find((p) => p.start === hhmm(r.start_time))?.label;
  const turnText = (r: { start_time: string; end_time: string }) =>
    `${turnName(r) ? `${turnName(r)} ` : ""}${hhmm(r.start_time)}–${hhmm(r.end_time)}`;

  const exportRows = (list: LogRow[]) =>
    list.map((r) => {
      const adj = adjustOf.get(r.id);
      return {
        Data: brDate(r.turn_date),
        Turno: turnText(r),
        Hora: timeOf(r.occurred_at),
        Pessoa: r.user_name,
        Equipe: r.team_name ?? "",
        Evento: eventInfo(r.event).label,
        Ajustado: adj ? overrideLabel(adj.event_override) : "",
        Local: r.location_label ?? "",
        "Distância (m)": r.distance_m ?? "",
        Latitude: r.lat ?? "",
        Longitude: r.lng ?? "",
        Detalhe: detailOf(r),
      };
    });
  const exportSummary = () =>
    summary.map((s) => ({
      Pessoa: s.name,
      Equipe: s.team,
      "Turnos escalados": s.turns,
      Presenças: s.presences,
      "Dias presentes": s.presentDays,
      Faltas: s.absences,
      "Faltas justificadas (ajuste)": s.justified,
      "Presença (%)": s.rate ?? "",
      Substituições: s.substitutions,
      "Horário médio de chegada": s.avgArrival,
    }));
  // faltas do período e o que foi feito com cada uma, mais os demais ajustes
  const exportAbsences = () =>
    scoped
      .filter((r) => r.event !== "ajuste" && (r.event === "falta" || adjustOf.has(r.id)))
      .sort((a, b) => a.turn_date.localeCompare(b.turn_date) || a.user_name.localeCompare(b.user_name))
      .map((r) => {
        const adj = adjustOf.get(r.id);
        return {
          Data: brDate(r.turn_date),
          Turno: turnText(r),
          Pessoa: r.user_name,
          Equipe: r.team_name ?? "",
          "Registro original": eventInfo(r.event).label,
          "Situação final": adj?.event_override
            ? adj.event_override === "presente"
              ? "Presente (ajuste)"
              : "Falta (ajuste)"
            : r.event === "falta"
              ? "Falta"
              : eventInfo(r.event).label,
          Justificativa: adj?.justification ?? "",
          "Ajustado por": adj?.created_by_name ?? "",
          "Ajustado em": adj ? format(new Date(adj.created_at), "dd/MM/yyyy HH:mm") : "",
        };
      });

  const downloadCsv = () => {
    const data = tab === "rows" ? exportRows(rows) : exportSummary();
    if (!data.length) return toast("Nada para exportar.", { icon: "ℹ️" });
    const cols = Object.keys(data[0]);
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      cols.map(esc).join(";"),
      ...data.map((d) => cols.map((c) => esc((d as Record<string, unknown>)[c])).join(";")),
    ].join("\r\n");
    save(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `checkins_${from}_${to}.csv`);
  };

  // Relatório do RH: um Excel com resumo, assiduidade, faltas/ajustes e registros.
  const [building, setBuilding] = useState(false);
  const downloadReport = async () => {
    if (!scoped.length) return toast("Nada para exportar no período.", { icon: "ℹ️" });
    setBuilding(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const total = (k: "turns" | "presences" | "absences" | "justified") =>
        summary.reduce((acc, s) => acc + s[k], 0);
      const turnsTotal = total("turns");

      const resumo = wb.addWorksheet("Resumo");
      resumo.columns = [{ width: 34 }, { width: 44 }];
      (
        [
          ["Relatório de check-ins", ""],
          ["Período", `${brDate(from)} a ${brDate(to)}`],
          ["Equipe", team === "all" ? "Todas" : team],
          ["Pessoa", userId === "all" ? "Todas" : (users.find(([id]) => id === userId)?.[1] ?? "")],
          ["Gerado em", format(new Date(), "dd/MM/yyyy HH:mm")],
          ["Gerado por", profile?.full_name ?? ""],
          ["", ""],
          ["Pessoas", summary.length],
          ["Turnos escalados", turnsTotal],
          ["Presenças", total("presences")],
          ["Faltas", total("absences")],
          ["Faltas justificadas por ajuste", total("justified")],
          ["Presença geral (%)", turnsTotal ? Math.round((total("presences") / turnsTotal) * 100) : ""],
        ] as [string, string | number][]
      ).forEach((line) => resumo.addRow(line));
      resumo.getRow(1).font = { bold: true, size: 14 };
      resumo.getColumn(1).font = { bold: true };
      resumo.getRow(1).font = { bold: true, size: 14 };

      for (const [name, data] of [
        ["Assiduidade", exportSummary()],
        ["Faltas e ajustes", exportAbsences()],
        ["Registros", exportRows(scoped)],
      ] as const) {
        const ws = wb.addWorksheet(name);
        if (!data.length) {
          ws.addRow(["Nenhum registro no período."]);
          continue;
        }
        const cols = Object.keys(data[0]);
        ws.columns = cols.map((c) => ({
          header: c,
          key: c,
          width: c === "Detalhe" || c === "Justificativa" ? 60 : 22,
        }));
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state: "frozen", ySplit: 1 }];
        data.forEach((d) => ws.addRow(d));
      }
      const buf = await wb.xlsx.writeBuffer();
      save(
        new Blob([buf], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `relatorio-checkins_${from}_${to}.xlsx`,
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível gerar o relatório.");
    } finally {
      setBuilding(false);
    }
  };

  const setPeriod = (start: Date, end: Date) => {
    setFrom(ymd(start));
    setTo(ymd(end));
  };
  const lastMonth = subMonths(new Date(), 1);

  const inputCls = "h-10 px-3 rounded-lg bg-white border border-border text-sm";
  const shown = rows.slice(0, visible);

  const AdjustButton = ({ row }: { row: LogRow }) =>
    !canAdjust || row.event === "ajuste" ? null : (
      <button
        onClick={() => setAdjusting(row)}
        className="h-9 px-2.5 rounded-lg border border-border bg-white text-xs font-semibold text-[var(--navy)] inline-flex items-center gap-1.5 hover:bg-[var(--surface)]"
      >
        <PencilLine size={13} /> Ajustar
      </button>
    );
  const AdjustedNote = ({ row }: { row: LogRow }) => {
    const adj = adjustOf.get(row.id);
    return adj ? (
      <p className="text-xs text-purple-800 bg-purple-50 border border-purple-100 rounded-lg px-2 py-1 mt-1">
        <span className="font-semibold">Ajustado: {overrideLabel(adj.event_override)}.</span>{" "}
        {adj.justification} — por {adj.created_by_name ?? "—"}
      </p>
    ) : null;
  };

  return (
    <div className={embedded ? undefined : "pb-nav"}>
      {!embedded && <AppHeader title="Log de check-ins" />}
      <div className={embedded ? "space-y-3" : "px-4 pt-4 max-w-6xl mx-auto space-y-3"}>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-xs text-muted-foreground block mb-0.5">De</span>
            <input
              type="date"
              className={`${inputCls} w-full`}
              value={from}
              max={to}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground block mb-0.5">Até</span>
            <input
              type="date"
              className={`${inputCls} w-full`}
              value={to}
              min={from}
              onChange={(e) => e.target.value && setTo(e.target.value)}
            />
          </label>
          <select
            className={`${inputCls} min-w-0`}
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
            className={`${inputCls} min-w-0`}
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
          <div className="col-span-2 flex gap-2">
            <button
              type="button"
              onClick={() => setPeriod(startOfMonth(new Date()), new Date())}
              className="h-10 px-3 rounded-lg bg-white border border-border text-sm font-medium text-[var(--navy)]"
            >
              Este mês
            </button>
            <button
              type="button"
              onClick={() => setPeriod(startOfMonth(lastMonth), endOfMonth(lastMonth))}
              className="h-10 px-3 rounded-lg bg-white border border-border text-sm font-medium text-[var(--navy)]"
            >
              Mês passado
            </button>
          </div>
        </div>

        {/* Relatório do RH */}
        <section className="bg-white rounded-2xl border border-border p-4 flex flex-wrap items-center gap-3">
          <div className="flex items-start gap-3 mr-auto min-w-0">
            <div className="h-10 w-10 rounded-xl bg-[var(--gold)]/15 text-[var(--gold-dark)] flex items-center justify-center flex-shrink-0">
              <FileSpreadsheet size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-[var(--navy)]">Relatório para o RH</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Excel de {brDate(from)} a {brDate(to)} com quatro abas: resumo, assiduidade por
                pessoa, faltas e ajustes, e todos os registros. Usa a pessoa e a equipe escolhidas
                acima.
              </p>
            </div>
          </div>
          <button
            onClick={downloadReport}
            disabled={building || logQ.isLoading}
            className="h-10 px-4 rounded-lg bg-[var(--navy)] text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 w-full sm:w-auto justify-center"
          >
            <Download size={15} /> {building ? "Gerando…" : "Baixar relatório"}
          </button>
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-white p-0.5" role="tablist">
            {(
              [
                ["rows", `Registros (${rows.length})`],
                ["summary", `Assiduidade (${summary.length})`],
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
          {tab === "rows" && (
            <select
              className={inputCls}
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              aria-label="Evento"
            >
              <option value="all">Todos os eventos</option>
              <option value="falta">Faltas</option>
              {canAdjust && <option value="falta_aberta">Faltas sem ajuste</option>}
              {canAdjust && <option value="ajuste">Ajustes</option>}
              <option value="checkin">Check-ins</option>
              <option value="standby">Stand-by</option>
              <option value="substituicao">Substituições</option>
              <option value="nao_alocado">Sem vaga</option>
            </select>
          )}
          <button
            onClick={downloadCsv}
            className="ml-auto h-10 px-3 rounded-lg bg-white border border-border text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <Download size={15} /> CSV desta lista
          </button>
        </div>

        {logQ.error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs">
            Erro ao carregar o log: {(logQ.error as Error).message}
          </div>
        )}
        {logQ.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {!logQ.isLoading && tab === "rows" && rows.length === 0 && (
          <p className="bg-white rounded-2xl border border-border p-8 text-center text-sm text-muted-foreground">
            Nenhum registro com esses filtros.
          </p>
        )}

        {/* celular: um cartão por registro */}
        {!logQ.isLoading && tab === "rows" && rows.length > 0 && (
          <ul className="sm:hidden space-y-2">
            {shown.map((r) => {
              const info = eventInfo(r.event);
              const detail = detailOf(r);
              return (
                <li key={r.id} className="bg-white rounded-2xl border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--navy)] truncate">{r.user_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {brDate(r.turn_date)} · {turnText(r)}
                        {r.team_name ? ` · ${r.team_name}` : ""}
                      </p>
                    </div>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${info.className}`}
                    >
                      {info.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Às {timeOf(r.occurred_at)}
                    {r.location_label ? ` · ${r.location_label}` : ""}
                    {r.distance_m != null ? ` · ${r.distance_m} m` : ""}
                  </p>
                  {detail && <p className="text-xs text-muted-foreground mt-1">{detail}</p>}
                  <AdjustedNote row={r} />
                  {canAdjust && r.event !== "ajuste" && (
                    <div className="mt-2 flex justify-end">
                      <AdjustButton row={r} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* computador: tabela */}
        {!logQ.isLoading && tab === "rows" && rows.length > 0 && (
          <div className="hidden sm:block bg-white rounded-2xl border border-border overflow-x-auto">
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
                {shown.map((r) => {
                  const info = eventInfo(r.event);
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="px-3 py-2 whitespace-nowrap">{brDate(r.turn_date)}</td>
                      <td
                        className="px-3 py-2 whitespace-nowrap text-muted-foreground"
                        title={`${hhmm(r.start_time)}–${hhmm(r.end_time)}`}
                      >
                        {turnName(r) ?? `${hhmm(r.start_time)}–${hhmm(r.end_time)}`}
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
                        {adjustOf.has(r.id) && (
                          <span className="ml-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                            Ajustado
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.location_label ?? "—"}
                        {r.distance_m != null && (
                          <span className="text-xs text-muted-foreground"> · {r.distance_m} m</span>
                        )}
                        {r.lat != null && r.lng != null && (
                          <a
                            href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=18/${r.lat}/${r.lng}`}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1.5 text-xs text-[var(--gold-dark)] underline"
                          >
                            mapa
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground min-w-[220px]">
                        {detailOf(r)}
                        <AdjustedNote row={r} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <AdjustButton row={r} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!logQ.isLoading && tab === "rows" && rows.length > visible && (
          <button
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
            className="w-full h-11 rounded-xl bg-white border border-border text-sm font-semibold text-[var(--navy)]"
          >
            Mostrar mais ({rows.length - visible} restantes)
          </button>
        )}

        {!logQ.isLoading && tab === "summary" && summary.length === 0 && (
          <p className="bg-white rounded-2xl border border-border p-8 text-center text-sm text-muted-foreground">
            Nenhum registro no período.
          </p>
        )}

        {/* Assiduidade no celular: cartões */}
        {!logQ.isLoading && tab === "summary" && summary.length > 0 && (
          <ul className="sm:hidden space-y-2">
            {summary.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    setUserId(s.id);
                    setTab("rows");
                  }}
                  className="w-full text-left bg-white rounded-2xl border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--navy)] truncate">{s.name}</p>
                      <p className="text-xs text-muted-foreground">Equipe {s.team}</p>
                    </div>
                    <span
                      className={`text-lg font-bold tabular-nums ${s.rate != null && s.rate < 80 ? "text-red-600" : "text-[var(--navy)]"}`}
                    >
                      {s.rate != null ? `${s.rate}%` : "—"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {s.presences} de {s.turns} turno(s) ·{" "}
                    <span className={s.absences > 0 ? "font-semibold text-red-600" : ""}>
                      {s.absences} falta(s)
                    </span>
                    {s.justified > 0 && ` · ${s.justified} justificada(s)`} · chegada {s.avgArrival}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!logQ.isLoading && tab === "summary" && summary.length > 0 && (
          <div className="hidden sm:block bg-white rounded-2xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface)] text-xs text-muted-foreground">
                <tr className="text-left">
                  <th className="px-3 py-2.5 font-semibold">Pessoa</th>
                  <th className="px-3 py-2.5 font-semibold">Equipe</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Turnos</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Presenças</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Faltas</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Justificadas</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Presença</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Substituições</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Chegada média</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button
                        onClick={() => {
                          setUserId(s.id);
                          setTab("rows");
                        }}
                        className="font-medium text-[var(--navy)] underline decoration-border underline-offset-2 hover:decoration-[var(--navy)]"
                        title="Ver os registros desta pessoa"
                      >
                        {s.name}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{s.team}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.turns}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.presences}</td>
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${s.absences > 0 ? "text-red-600" : ""}`}
                    >
                      {s.absences}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.justified}</td>
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${s.rate != null && s.rate < 80 ? "text-red-600" : ""}`}
                    >
                      {s.rate != null ? `${s.rate}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.substitutions}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.avgArrival}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Os registros não podem ser editados nem excluídos. Correções são feitas por um ajuste do
          administrador, que fica gravado com a justificativa e o autor. Em Assiduidade, "Turnos" soma presenças e
          faltas; faltas ajustadas para presente contam como presença.
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
          {hhmm(row.end_time)} · {eventInfo(row.event).label}
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
        <p className="text-xs text-muted-foreground">
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
