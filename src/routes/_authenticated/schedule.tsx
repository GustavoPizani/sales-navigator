import { createFileRoute, Link } from "@tanstack/react-router";
import { RequireModule } from "@/components/RequireModule";
import { useMemo, useState, useEffect, Fragment } from "react";
import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { addDays, differenceInDays, format, parseISO, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, Trash2, Upload, Loader2, X, Link as LinkIcon, Copy, CheckCircle2, MessageCircle, FileDown, ChevronDown, MoreHorizontal, MapPinCheck, CalendarRange, CalendarDays } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBrokers } from "@/hooks/useBrokers";
import { AppHeader } from "@/components/AppHeader";
import { usePdvLabels, useShiftPeriods } from "@/hooks/useRoulette";
import { TeamQuotaButton } from "@/components/schedule/TeamQuotaEditor";
import { ScheduleLinksButton } from "@/components/schedule/ScheduleLinks";
import { deletePendingBroker, fetchPendingForSlots, type PendingRow } from "@/lib/publicSchedule";
import { confirmDialog } from "@/components/ConfirmDialog";

export const Route = createFileRoute("/_authenticated/schedule")({
  component: SchedulePageGuarded,
});

// Rota bloqueada pela matriz de permissões do cargo.
function SchedulePageGuarded() {
  return (
    <RequireModule modules={["schedule"]}>
      <SchedulePage />
    </RequireModule>
  );
}

type Shift = {
  id: string; broker_id: string; manager_id: string; date: string;
  start_time: string; end_time: string; notes: string | null; slot_id: string | null;
};

const EXPORT_DAY_LABELS = ["SEGUNDA", "TERÇA", "QUARTA", "QUINTA", "SEXTA", "SÁBADO", "DOMINGO"];

async function exportScheduleXlsx({ weekStart, days, brokers, shifts }: { weekStart: Date; days: Date[]; brokers: any[]; shifts: Shift[] }) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Escala");
  const numCols = 1 + days.length;

  ws.columns = [{ width: 6 }, ...days.map(() => ({ width: 18 }))];

  const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
  const thinBorder = { style: "thin" as const, color: { argb: "FFCCCCCC" } };

  let rowIdx = 1;

  ws.mergeCells(rowIdx, 1, rowIdx, numCols);
  const titleCell = ws.getCell(rowIdx, 1);
  titleCell.value = "PROGRAMAÇÃO - ESCALA";
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = fill("FFC6E8C6");
  ws.getRow(rowIdx).height = 24;
  rowIdx++;

  for (const period of PERIODS) {
    ws.mergeCells(rowIdx, 1, rowIdx, numCols);
    const pCell = ws.getCell(rowIdx, 1);
    pCell.value = period.label.toUpperCase();
    pCell.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    pCell.alignment = { horizontal: "center", vertical: "middle" };
    pCell.fill = fill("FF4C9A4C");
    ws.getRow(rowIdx).height = 20;
    rowIdx++;

    const dayRow = ws.getRow(rowIdx);
    days.forEach((_d, i) => {
      const c = dayRow.getCell(i + 2);
      c.value = EXPORT_DAY_LABELS[i];
      c.font = { bold: true };
      c.alignment = { horizontal: "center" };
      c.fill = fill("FFF6A821");
    });
    rowIdx++;

    const dateRow = ws.getRow(rowIdx);
    days.forEach((d, i) => {
      const c = dateRow.getCell(i + 2);
      c.value = format(d, "d/M");
      c.font = { bold: true };
      c.alignment = { horizontal: "center" };
      c.fill = fill("FF9DC3E6");
    });
    rowIdx++;

    const perDay = days.map((d) => {
      const ds = format(d, "yyyy-MM-dd");
      return shifts
        .filter((s) => s.date === ds && derivePeriod(s.start_time) === period.val)
        .map((s) => brokers.find((b) => b.id === s.broker_id)?.full_name)
        .filter((n): n is string => !!n);
    });
    const maxRows = Math.max(1, ...perDay.map((arr) => arr.length));

    for (let r = 0; r < maxRows; r++) {
      const row = ws.getRow(rowIdx);
      const slotCell = row.getCell(1);
      slotCell.value = r + 1;
      slotCell.alignment = { horizontal: "center" };
      slotCell.fill = fill("FFFFFF99");
      slotCell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
      perDay.forEach((names, i) => {
        const c = row.getCell(i + 2);
        c.value = names[r] ?? "";
        c.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
      });
      rowIdx++;
    }

    const totalRow = ws.getRow(rowIdx);
    totalRow.getCell(1).fill = fill("FFF6A821");
    perDay.forEach((names, i) => {
      const c = totalRow.getCell(i + 2);
      c.value = names.length;
      c.font = { bold: true };
      c.alignment = { horizontal: "center" };
      c.fill = fill("FFF6A821");
    });
    rowIdx += 2;
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `escala_${format(weekStart, "yyyy-MM-dd")}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Vincula plantões lançados à mão às vagas da semana (mesma data e horário), para a contagem de vagas bater. */
async function fixShiftLinks(managerId: string, qc: QueryClient) {
  if (
    !(await confirmDialog({
      title: "Corrigir os vínculos das vagas?",
      description: "Os turnos preenchidos à mão serão ligados às vagas de mesma data e horário, corrigindo a contagem de vagas disponíveis.",
      confirmLabel: "Corrigir",
    }))
  )
    return;
  try {
    const { data: myConfigs, error: cfgErr } = await supabase.from("shift_configs").select("id").eq("manager_id", managerId);
    if (cfgErr) throw cfgErr;
    const configIds = (myConfigs ?? []).map((c) => c.id);
    if (configIds.length === 0) {
      toast("Nenhuma escala com link gerada ainda.", { icon: "ℹ️" });
      return;
    }

    const { data: slots, error: slotsErr } = await supabase
      .from("shift_slots")
      .select("id, date, start_time, end_time")
      .in("config_id", configIds);
    if (slotsErr) throw slotsErr;

    const { data: looseShifts, error: shiftsErr } = await supabase
      .from("shifts")
      .select("id, date, start_time, end_time")
      .eq("manager_id", managerId)
      .is("slot_id", null);
    if (shiftsErr) throw shiftsErr;

    const slotByKey = new Map((slots ?? []).map((s) => [`${s.date}_${s.start_time}_${s.end_time}`, s.id]));
    const toFix = (looseShifts ?? [])
      .map((s) => ({ id: s.id, slotId: slotByKey.get(`${s.date}_${s.start_time}_${s.end_time}`) }))
      .filter((s): s is { id: string; slotId: string } => !!s.slotId);

    if (toFix.length === 0) {
      toast("Nenhum turno solto encontrado — tudo já está vinculado.", { icon: "✅" });
      return;
    }

    const results = await Promise.all(
      toFix.map((s) => supabase.from("shifts").update({ slot_id: s.slotId }).eq("id", s.id))
    );
    const failed = results.filter((r) => r.error);
    if (failed.length > 0) throw failed[0].error;

    qc.invalidateQueries({ queryKey: ["shifts"] });
    toast.success(`${toFix.length} turno(s) vinculado(s) às vagas correspondentes!`);
  } catch (err: any) {
    toast.error(err.message || "Erro ao corrigir vínculos");
  }
}

type Modality = "online" | "salao";
/** Filtro de local da grade: os dois PDVs juntos ou um só. */
type LocFilter = "all" | Modality;

/** "6 – 12 de out" (ou "29 de set – 5 de out" quando a semana vira o mês). */
function weekLabel(weekStart: Date) {
  const end = addDays(weekStart, 6);
  return weekStart.getMonth() === end.getMonth()
    ? `${format(weekStart, "d")} – ${format(end, "d 'de' MMM", { locale: ptBR })}`
    : `${format(weekStart, "d 'de' MMM", { locale: ptBR })} – ${format(end, "d 'de' MMM", { locale: ptBR })}`;
}

function SchedulePage() {
  const { isAdmin, isSuperAdmin, user } = useAuth();
  const qc = useQueryClient();
  const pdvLabels = usePdvLabels();
  // horários dos turnos definidos pelo admin (regras de check-in)
  const shiftPeriods = useShiftPeriods();
  PERIODS = shiftPeriods.map((p) => ({ val: p.key, label: p.label, start: p.start, end: p.end }));
  const thisWeekStr = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  // Central e Plantão aparecem juntos na grade; o filtro só serve para isolar um local.
  const [loc, setLoc] = useState<LocFilter>("all");
  const [busy, setBusy] = useState<null | "export" | "fix">(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const startStr = format(weekStart, "yyyy-MM-dd");
  const endStr = format(addDays(weekStart, 6), "yyyy-MM-dd");

  // Cada gerente faz a escala da própria equipe; o admin escolhe qual equipe ver/editar.
  const managersQ = useQuery({
    queryKey: ["schedule-managers"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,team_name,color")
        .eq("role", "master")
        .eq("is_active", true)
        .order("team_name");
      if (error) throw error;
      return data ?? [];
    },
  });
  // admin: "all" = todas as equipes juntas, cada uma na cor do gerente
  const [pickedManagerId, setPickedManagerId] = useState<string>("all");
  const managerId = isSuperAdmin ? pickedManagerId : (user?.id ?? "");
  const allTeams = isSuperAdmin && managerId === "all";
  const teams = useMemo(
    () =>
      (managersQ.data ?? []).map((m: any) => ({ id: m.id as string, label: (m.team_name || m.full_name) as string, color: m.color as string })),
    [managersQ.data],
  );

  const brokersQ = useBrokers({ select: "id,full_name,color,role,is_active,manager_id", enabled: isAdmin });
  const brokers = useMemo(
    () => (brokersQ.data ?? []).filter((b: any) => !isSuperAdmin || allTeams || b.manager_id === managerId),
    [brokersQ.data, isSuperAdmin, allTeams, managerId],
  );

  const shiftsQ = useQuery({
    queryKey: ["shifts", startStr, endStr, isAdmin, user?.id],
    queryFn: async () => {
      let q = supabase.from("shifts").select("*").gte("date", startStr).lte("date", endStr);
      if (!isAdmin) q = q.eq("broker_id", user!.id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Shift[];
    },
  });

  // Vagas da semana nos dois PDVs. O admin define o total do turno e o gerente
  // escolhe o PDV de cada corretor, então a capacidade de cada vaga é calculada.
  const slotsQ = useQuery({
    queryKey: ["shift-slots-capacity", startStr, managerId],
    enabled: isAdmin && !!managerId,
    queryFn: async () => {
      let cq = supabase.from("shift_configs").select("id, manager_id, modality").eq("week_start_date", startStr);
      if (managerId !== "all") cq = cq.eq("manager_id", managerId);
      const { data: configs } = await cq;
      if (!configs?.length) return [];
      const { data } = await supabase
        .from("shift_slots")
        .select("id, date, start_time, end_time, capacity, config_id")
        .in("config_id", configs.map((c) => c.id));
      const modalityOf = new Map(configs.map((c) => [c.id, c.modality]));
      return (data ?? []).map((sl) => ({ ...sl, modality: (modalityOf.get(sl.config_id ?? "") === "salao" ? "salao" : "online") as Modality }));
    },
  });
  const allSlots = slotsQ.data ?? [];

  // Local de cada plantão: o da vaga (slot) da configuração da semana; plantões
  // sem vaga vinculada contam como Central.
  const slotModality = useMemo(() => new Map((slotsQ.data ?? []).map((sl) => [sl.id, sl.modality])), [slotsQ.data]);
  const teamShifts = useMemo(() => {
    const teamIds = new Set(brokers.map((b: any) => b.id));
    return (shiftsQ.data ?? []).filter((sh) => teamIds.has(sh.broker_id));
  }, [shiftsQ.data, brokers]);
  const gridShifts = useMemo(
    () =>
      loc === "all"
        ? teamShifts
        : teamShifts.filter((sh) => ((sh.slot_id && slotModality.get(sh.slot_id)) || "online") === loc),
    [teamShifts, loc, slotModality],
  );

  // Corretores pré-cadastrados pelo link do gerente (ainda sem usuário no app).
  const slotIdsKey = (slotsQ.data ?? []).map((sl) => sl.id).sort().join(",");
  const pendingQ = useQuery({
    queryKey: ["pending-shifts", slotIdsKey],
    enabled: isAdmin && slotIdsKey.length > 0,
    queryFn: () => fetchPendingForSlots(slotIdsKey.split(",")),
  });
  const allPending = slotIdsKey ? (pendingQ.data ?? []) : [];
  const pending = useMemo(() => {
    if (loc === "all") return allPending;
    return allPending
      .map((p) => ({ ...p, shifts: p.shifts.filter((ps) => slotModality.get(ps.slot_id) === loc) }))
      .filter((p) => p.shifts.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQ.data, slotIdsKey, loc, slotModality]);

  const runExport = async () => {
    setBusy("export");
    try {
      await exportScheduleXlsx({ weekStart, days, brokers, shifts: gridShifts });
    } catch (err: any) {
      toast.error(err.message || "Erro ao exportar planilha");
    } finally {
      setBusy(null);
    }
  };
  const runFix = async () => {
    setBusy("fix");
    await fixShiftLinks(managerId, qc);
    setBusy(null);
  };

  return (
    <div className="pb-nav">
      <AppHeader title={isAdmin ? "Escala" : "Minha Escala"} />
      <div className="px-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Semana anterior" className="h-10 w-10 inline-flex items-center justify-center rounded-lg bg-white border border-border"><ChevronLeft size={18} /></button>
            <p className="font-semibold text-[var(--navy)] text-sm sm:text-base whitespace-nowrap min-w-[8.5rem] text-center">{weekLabel(weekStart)}</p>
            <button onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Próxima semana" className="h-10 w-10 inline-flex items-center justify-center rounded-lg bg-white border border-border"><ChevronRight size={18} /></button>
            {startStr !== thisWeekStr && (
              <button onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="h-10 px-3 rounded-lg bg-white border border-border text-sm font-medium text-[var(--navy)]">
                Hoje
              </button>
            )}
          </div>
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              {isSuperAdmin && (
                <TeamQuotaButton teams={teams} defaultManagerId={allTeams ? undefined : managerId} />
              )}
              {!allTeams && <ScheduleLinksButton managerId={managerId} />}
              {/* ações de vez em quando ficam no menu, com nome */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button aria-label="Mais ações" className="h-10 w-10 rounded-xl bg-white border border-border text-[var(--navy)] inline-flex items-center justify-center">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <MoreHorizontal size={18} />}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem disabled={busy !== null} onSelect={runExport}>
                    <FileDown size={15} /> Exportar planilha
                  </DropdownMenuItem>
                  {!allTeams && (
                    <DropdownMenuItem disabled={busy !== null} onSelect={runFix}>
                      <LinkIcon size={15} /> Corrigir vínculos das vagas
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {isSuperAdmin &&
              ((managersQ.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma equipe ainda. Cadastre os gerentes na tela Time.</p>
              ) : (
                <select
                  value={managerId}
                  onChange={(e) => setPickedManagerId(e.target.value)}
                  className="h-10 px-3 rounded-lg bg-white border border-border text-sm"
                  aria-label="Equipe"
                >
                  <option value="all">Todas as equipes</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      Equipe {t.label}
                    </option>
                  ))}
                </select>
              ))}
            <div className="inline-flex rounded-lg border border-border bg-white p-0.5" role="group" aria-label="Local">
              {([["all", "Todos os locais"], ["online", pdvLabels.central], ["salao", pdvLabels.plantao]] as const).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setLoc(m)}
                  aria-pressed={loc === m}
                  className={`h-9 px-3 rounded-md text-sm font-medium ${loc === m ? "bg-[var(--navy)] text-white" : "text-muted-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {allTeams && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {teams.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} /> {t.label}
                  </span>
                ))}
              </div>
            )}
            {allTeams && <span className="text-xs text-muted-foreground w-full">Para gerar o link da escala, escolha uma equipe.</span>}
          </div>
        )}

        {isAdmin ? (
          <AdminGrid
            days={days}
            brokers={brokers}
            shifts={gridShifts}
            pending={pending}
            allSlots={allSlots}
            allShifts={shiftsQ.data ?? []}
            allPending={allPending}
            defaultModality={loc === "salao" ? "salao" : "online"}
            managerId={managerId}
            teams={isSuperAdmin ? teams.filter((t) => allTeams || t.id === managerId) : undefined}
          />
        ) : (
          <BrokerWeek days={days} shifts={shiftsQ.data ?? []} />
        )}
      </div>
    </div>
  );
}

const periodLabel = (s: { start_time: string; end_time: string }) =>
  PERIODS.find((p) => p.val === derivePeriod(s.start_time))?.label ?? `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`;

/** Minha Escala (corretor): o próximo plantão em destaque e a semana, com hoje marcado. */
function BrokerWeek({ days, shifts }: { days: Date[]; shifts: Shift[] }) {
  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");
  const tomorrowStr = format(addDays(now, 1), "yyyy-MM-dd");
  const sorted = [...shifts].sort((a, b) => `${a.date}${a.start_time}`.localeCompare(`${b.date}${b.start_time}`));
  // próximo plantão que ainda não terminou
  const next = sorted.find((s) => new Date(`${s.date}T${s.end_time.slice(0, 5)}:00`).getTime() > now.getTime());
  const dayName = (ds: string) =>
    ds === todayStr ? "Hoje" : ds === tomorrowStr ? "Amanhã" : format(new Date(`${ds}T00:00:00`), "EEEE, d 'de' MMM", { locale: ptBR });

  return (
    <div className="space-y-2 max-w-2xl mx-auto">
      {next && (
        <div className="bg-[var(--navy)] text-white rounded-2xl p-4">
          <p className="text-xs uppercase tracking-wide text-white/60">Próximo plantão</p>
          <p className="text-lg font-bold mt-0.5 first-letter:uppercase">{dayName(next.date)}</p>
          <p className="text-sm text-white/85">
            {periodLabel(next)} · {next.start_time.slice(0, 5)}–{next.end_time.slice(0, 5)} · {next.notes || "Central"}
          </p>
          {next.date === todayStr && (
            <Link
              to="/checkin"
              className="mt-3 h-11 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold text-sm inline-flex items-center justify-center gap-2 w-full"
            >
              <MapPinCheck size={16} /> Ir para o check-in
            </Link>
          )}
        </div>
      )}
      {shifts.length === 0 && (
        <p className="bg-white rounded-xl border border-border p-4 text-sm text-muted-foreground text-center">
          Você não tem plantão nesta semana.
        </p>
      )}
      {days.map((d) => {
        const ds = format(d, "yyyy-MM-dd");
        const my = sorted.filter((s) => s.date === ds);
        const isToday = ds === todayStr;
        const label = (
          <p className={`text-xs uppercase tracking-wide ${isToday ? "font-bold text-[var(--gold-dark)]" : "text-muted-foreground"}`}>
            {format(d, "EEE, d 'de' MMM", { locale: ptBR })}
            {isToday && " · hoje"}
          </p>
        );
        // dia sem plantão: uma linha só
        if (my.length === 0)
          return (
            <div key={ds} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${isToday ? "bg-white border-[var(--gold)]" : "border-transparent"}`}>
              {label}
              <span className="text-xs text-muted-foreground">Sem plantão</span>
            </div>
          );
        return (
          <div key={ds} className={`bg-white rounded-xl p-3 border ${isToday ? "border-[var(--gold)]" : "border-border"}`}>
            {label}
            {my.map((s) => (
              <div key={s.id} className="mt-1.5">
                <p className="font-semibold text-[var(--navy)]">
                  {periodLabel(s)}
                  <span className="font-normal text-muted-foreground text-xs ml-1.5">({s.start_time.slice(0,5)} – {s.end_time.slice(0,5)})</span>
                </p>
                <p className="text-xs text-[var(--gold-dark)] font-semibold mt-0.5">{s.notes || "Central"}</p>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

type GridSlot = { id: string; date: string; start_time: string; end_time: string; capacity: number; modality: Modality };
type Team = { id: string; label: string; color: string };
type PeriodVal = "manha" | "tarde" | "noite";

/**
 * Grade da semana (admin e gerente), com Central e Plantão juntos. No
 * computador, uma tabela por turno; no celular, um dia por vez.
 */
function AdminGrid({ days, brokers, shifts, pending, allSlots, allShifts, allPending, defaultModality, managerId, teams }: { days: Date[]; brokers: any[]; /** plantões exibidos (já com o filtro de local) */ shifts: Shift[]; pending: PendingRow[]; /** os dois PDVs: o total de vagas do turno vale para Central + Plantão */ allSlots: GridSlot[]; allShifts: Shift[]; allPending: PendingRow[]; /** local sugerido ao escalar alguém */ defaultModality: Modality; managerId: string; teams?: Team[] }) {
  const labels = usePdvLabels();
  // Visão do admin: corretores agrupados por equipe, plantões na cor do gerente.
  const teamById = useMemo(() => new Map((teams ?? []).map((t) => [t.id, t])), [teams]);
  const groups = useMemo(() => {
    if (!teams) return [{ team: null as null | Team, brokers, pending }];
    const list = teams.map((t) => ({ team: t as null | Team, brokers: brokers.filter((b) => b.manager_id === t.id), pending: pending.filter((p) => p.manager_id === t.id) }));
    const others = brokers.filter((b) => !teamById.has(b.manager_id));
    if (others.length) list.push({ team: null, brokers: others, pending: [] });
    return list.filter((g) => g.brokers.length > 0 || g.pending.length > 0);
  }, [teams, brokers, teamById, pending]);
  const qc = useQueryClient();
  const slotById = useMemo(() => new Map(allSlots.map((sl) => [sl.id, sl])), [allSlots]);
  const modalityOf = (sh: Shift): Modality => (sh.slot_id && slotById.get(sh.slot_id)?.modality) || "online";
  // o que aparece no plantão: o local, e no Plantão o nome dele quando houver
  const shiftLabel = (sh: Shift) => (modalityOf(sh) === "salao" ? sh.notes || "Plantão" : "Central");
  const shiftTitle = (sh: Shift) => `${modalityOf(sh) === "salao" ? labels.plantao : labels.central}${sh.notes ? ` · ${sh.notes}` : ""}`;
  const removePending = async (p: PendingRow) => {
    if (
      !(await confirmDialog({
        title: `Remover ${p.full_name}?`,
        description: "Ele(a) ainda não tem cadastro. Os turnos em que foi escalado(a) serão liberados.",
        confirmLabel: "Remover",
        danger: true,
      }))
    )
      return;
    try {
      await deletePendingBroker(p.id);
      qc.invalidateQueries({ queryKey: ["pending-shifts"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover");
    }
  };
  const chipColor = (b: any) => (teams ? teamById.get(b.manager_id)?.color ?? "#A8A8A8" : b.color);
  const [editing, setEditing] = useState<{ broker: any; date: string; shift?: Shift; initialPeriod?: PeriodVal } | null>(null);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  // Vagas restantes do turno: o total vale para os dois PDVs somados (o gerente
  // escolhe o PDV de cada corretor), então conta Central + Plantão.
  const remainingFor = (ds: string, periodVal: PeriodVal) => {
    const matching = allSlots.filter((s) => s.date === ds && derivePeriod(s.start_time) === periodVal);
    const capacity = matching.reduce((sum, s) => sum + s.capacity, 0);
    if (capacity === 0) return null;
    const ids = new Set(matching.map((m) => m.id));
    const occupied = allShifts.filter((s) => s.slot_id && ids.has(s.slot_id)).length;
    const occupiedPending = allPending.reduce((sum, pb) => sum + pb.shifts.filter((ps) => ids.has(ps.slot_id)).length, 0);
    return Math.max(0, capacity - occupied - occupiedPending);
  };
  const remainingText = (rem: number | null) => (rem === null ? "sem vagas" : `${rem} livre${rem === 1 ? "" : "s"}`);
  const remainingCls = (rem: number | null) => (rem === null ? "text-muted-foreground/60" : rem === 0 ? "text-red-600" : "text-green-700");
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const noBrokers = brokers.length === 0 && pending.length === 0;
  // total de plantões de cada corretor na semana (para equilibrar a escala)
  const weekTotal = useMemo(() => {
    const m = new Map<string, number>();
    shifts.forEach((s) => m.set(s.broker_id, (m.get(s.broker_id) ?? 0) + 1));
    return m;
  }, [shifts]);
  const shiftOf = (brokerId: string, ds: string, per: PeriodVal) =>
    shifts.find((x) => x.broker_id === brokerId && x.date === ds && derivePeriod(x.start_time) === per);
  const pendingHas = (p: PendingRow, ds: string, per: PeriodVal) =>
    p.shifts.some((ps) => {
      const sl = slotById.get(ps.slot_id);
      return sl && sl.date === ds && derivePeriod(sl.start_time) === per;
    });
  const shortName = (name: string) => name.split(" ").slice(0, 2).join(" ");

  // computador: semana inteira ou um dia; celular: sempre um dia
  const [view, setView] = useState<"week" | "day">("week");
  // visão por dia: abre em hoje, quando hoje está na semana
  const dayStrs = days.map((d) => format(d, "yyyy-MM-dd"));
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const mobileDay = pickedDay && dayStrs.includes(pickedDay) ? pickedDay : dayStrs.includes(todayStr) ? todayStr : dayStrs[0];

  return (
    <>
      {noBrokers && (
        <p className="text-center text-sm text-muted-foreground py-6">Adicione corretores na aba Time.</p>
      )}

      {/* no computador dá para alternar; no celular é sempre por dia */}
      {!noBrokers && (
        <div className="hidden sm:inline-flex rounded-lg border border-border bg-white p-0.5 mb-3" role="group" aria-label="Visualização">
          {([["week", "Semana", CalendarRange], ["day", "Dia", CalendarDays]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              aria-pressed={view === key}
              className={`h-9 px-3 rounded-md text-sm font-medium inline-flex items-center gap-1.5 ${view === key ? "bg-[var(--navy)] text-white" : "text-muted-foreground"}`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Por dia: escolhe o dia e vê cada turno com quem está escalado ── */}
      {!noBrokers && (
        <div className={`space-y-3 ${view === "day" ? "" : "sm:hidden"}`}>
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {days.map((d) => {
              const ds = format(d, "yyyy-MM-dd");
              const active = ds === mobileDay;
              return (
                <button
                  key={ds}
                  onClick={() => setPickedDay(ds)}
                  aria-pressed={active}
                  className={`h-14 rounded-xl text-center border ${active ? "bg-[var(--navy)] text-white border-[var(--navy)]" : ds === todayStr ? "bg-white border-[var(--gold)] text-[var(--navy)]" : "bg-white border-border text-[var(--navy)]"}`}
                >
                  <span className="block text-[11px] capitalize opacity-70">{format(d, "EEEEEE", { locale: ptBR })}</span>
                  <span className="block text-base font-bold leading-tight">{format(d, "d")}</span>
                </button>
              );
            })}
          </div>
          <div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-3 lg:items-start">
          {PERIODS.map((per) => {
            const rem = remainingFor(mobileDay, per.val);
            const scheduled = groups.flatMap((g) =>
              g.brokers
                .map((b) => ({ broker: b, shift: shiftOf(b.id, mobileDay, per.val), team: g.team }))
                .filter((x): x is { broker: any; shift: Shift; team: null | Team } => !!x.shift),
            );
            const pend = groups.flatMap((g) => g.pending.filter((p) => pendingHas(p, mobileDay, per.val)));
            const free = groups
              .map((g) => ({ team: g.team, brokers: g.brokers.filter((b) => !shiftOf(b.id, mobileDay, per.val)) }))
              .filter((g) => g.brokers.length > 0);
            return (
              <section key={per.val} className="bg-white rounded-2xl border border-border overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-[var(--navy)] text-white">
                  <span className="font-bold">
                    {per.label} <span className="font-normal text-white/70 text-sm">{per.start}–{per.end}</span>
                  </span>
                  <span className="text-xs text-white/85">{remainingText(rem)}</span>
                </div>
                <ul className="divide-y divide-border">
                  {scheduled.length === 0 && pend.length === 0 && (
                    <li className="px-4 py-3 text-sm text-muted-foreground">Ninguém escalado.</li>
                  )}
                  {scheduled.map(({ broker: b, shift: sh }) => (
                    <li key={sh.id}>
                      <button
                        onClick={() => setEditing({ broker: b, date: mobileDay, shift: sh })}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-left"
                      >
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: chipColor(b) }} />
                        <span className="flex-1 min-w-0 font-medium text-[var(--navy)] truncate">{b.full_name}</span>
                        <span className="text-xs text-muted-foreground truncate max-w-[45%]">{shiftTitle(sh)}</span>
                      </button>
                    </li>
                  ))}
                  {pend.map((p) => (
                    <li key={p.id} className="px-4 py-2.5 flex items-center gap-3">
                      <span className="w-3 h-3 rounded-full border border-dashed border-muted-foreground flex-shrink-0" />
                      <span className="flex-1 min-w-0 font-medium text-[var(--navy)] truncate">{p.full_name}</span>
                      <span className="text-xs text-muted-foreground">sem cadastro</span>
                      <button onClick={() => removePending(p)} aria-label={`Remover ${p.full_name}`} className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-red-600">
                        <X size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
                {free.length > 0 && (
                  <div className="p-3 border-t border-border">
                    <select
                      value=""
                      onChange={(e) => {
                        const b = brokers.find((x) => x.id === e.target.value);
                        if (b) setEditing({ broker: b, date: mobileDay, initialPeriod: per.val });
                      }}
                      aria-label={`Escalar corretor em ${per.label}`}
                      className="w-full h-11 px-3 rounded-xl bg-[var(--surface)] border border-border text-sm text-[var(--navy)] font-medium"
                    >
                      <option value="">+ Escalar corretor…</option>
                      {free.map((g) =>
                        teams ? (
                          <optgroup key={g.team?.id ?? "sem"} label={`Equipe ${g.team?.label ?? "sem gerente"}`}>
                            {g.brokers.map((b) => (
                              <option key={b.id} value={b.id}>{b.full_name}</option>
                            ))}
                          </optgroup>
                        ) : (
                          g.brokers.map((b) => (
                            <option key={b.id} value={b.id}>{b.full_name}</option>
                          ))
                        ),
                      )}
                    </select>
                  </div>
                )}
              </section>
            );
          })}
          </div>
        </div>
      )}

      {/* ── Semana (computador): uma seção por turno; dentro, as equipes e seus corretores ── */}
      {!noBrokers && (
        <div className={`space-y-4 ${view === "week" ? "hidden sm:block" : "hidden"}`}>
          {PERIODS.map((per) => {
            const isClosed = closed[per.val] ?? false;
            const periodTotal = days.reduce((sum, d) => sum + (remainingFor(format(d, "yyyy-MM-dd"), per.val) ?? 0), 0);
            return (
              <section key={per.val} className="bg-white rounded-2xl border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setClosed((c) => ({ ...c, [per.val]: !isClosed }))}
                  className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-[var(--navy)] text-white"
                  aria-expanded={!isClosed}
                >
                  <span className="flex items-center gap-2 font-bold">
                    {isClosed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    {per.label}
                    <span className="font-normal text-white/70 text-sm">{per.start}–{per.end}</span>
                  </span>
                  <span className="text-xs text-white/80">{periodTotal} vaga{periodTotal === 1 ? "" : "s"} livre{periodTotal === 1 ? "" : "s"} na semana</span>
                </button>
                {!isClosed && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-[var(--surface)]">
                          <th className="sticky left-0 z-10 bg-[var(--surface)] text-left px-3 py-2 font-semibold text-muted-foreground border-b border-border min-w-[150px]">
                            Corretor <span className="font-normal">· plantões na semana</span>
                          </th>
                          {days.map((d) => {
                            const ds = format(d, "yyyy-MM-dd");
                            const rem = remainingFor(ds, per.val);
                            return (
                              <th
                                key={ds}
                                className={`px-1 py-2 text-center font-semibold border-b border-l border-border min-w-[84px] ${ds === todayStr ? "bg-[var(--gold)]/15 text-[var(--gold-dark)]" : ds < todayStr ? "text-muted-foreground" : "text-[var(--navy)]"}`}
                              >
                                <div className="capitalize">{format(d, "EEE d", { locale: ptBR })}{ds === todayStr && " · hoje"}</div>
                                <div className={`text-[11px] font-normal ${remainingCls(rem)}`}>{remainingText(rem)}</div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((g) => (
                          <Fragment key={g.team?.id ?? "sem-equipe"}>
                            {teams && (
                              <tr>
                                <td colSpan={days.length + 1} className="p-0">
                                  <div
                                    className="sticky left-0 inline-flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold text-white w-full"
                                    style={{ backgroundColor: g.team?.color ?? "#A8A8A8" }}
                                  >
                                    Equipe {g.team?.label ?? "sem gerente"} · {g.brokers.length + g.pending.length}
                                  </div>
                                </td>
                              </tr>
                            )}
                            {g.brokers.map((b) => (
                              <tr key={b.id} className="hover:bg-[var(--surface)]/60">
                                <td className="sticky left-0 z-10 bg-white px-3 py-1.5 border-b border-border">
                                  <div className="flex items-center gap-1.5">
                                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: b.color }} />
                                    <span className="font-medium text-[var(--navy)] whitespace-nowrap">{shortName(b.full_name)}</span>
                                    <span
                                      className="ml-auto text-[11px] font-bold tabular-nums rounded-full bg-[var(--surface)] text-[var(--navy)] px-1.5 py-0.5"
                                      title={`${weekTotal.get(b.id) ?? 0} plantão(ões) na semana`}
                                    >
                                      {weekTotal.get(b.id) ?? 0}
                                    </span>
                                  </div>
                                </td>
                                {days.map((d) => {
                                  const ds = format(d, "yyyy-MM-dd");
                                  const sh = shiftOf(b.id, ds, per.val);
                                  return (
                                    <td key={ds} className={`p-1 border-b border-l border-border text-center align-middle ${ds === todayStr ? "bg-[var(--gold)]/5" : ""}`}>
                                      {sh ? (
                                        <button
                                          onClick={() => setEditing({ broker: b, date: ds, shift: sh })}
                                          className="w-full h-9 rounded-lg px-1 text-[11px] font-semibold text-white truncate hover:opacity-90"
                                          style={{ background: chipColor(b) }}
                                          title={shiftTitle(sh)}
                                        >
                                          {shiftLabel(sh)}
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => setEditing({ broker: b, date: ds, initialPeriod: per.val })}
                                          className="w-full h-9 rounded-lg flex items-center justify-center text-transparent hover:text-[var(--navy)] hover:bg-[var(--surface)] focus-visible:text-[var(--navy)]"
                                          aria-label={`Escalar ${b.full_name} em ${per.label}`}
                                        >
                                          <Plus size={14} />
                                        </button>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                            {g.pending.map((p) => (
                              <tr key={p.id}>
                                <td className="sticky left-0 z-10 bg-white px-3 py-1.5 border-b border-border">
                                  <div className="flex items-center gap-1.5" title={`${p.full_name} — preenchido pelo link do gerente, ainda sem cadastro`}>
                                    <span className="w-2.5 h-2.5 rounded-full border border-dashed border-muted-foreground flex-shrink-0" />
                                    <span className="font-medium text-[var(--navy)] whitespace-nowrap">{shortName(p.full_name)}</span>
                                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">sem cadastro</span>
                                    <button onClick={() => removePending(p)} aria-label={`Remover ${p.full_name}`} className="ml-auto h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-red-600 hover:bg-red-50">
                                      <X size={13} />
                                    </button>
                                  </div>
                                </td>
                                {days.map((d) => {
                                  const ds = format(d, "yyyy-MM-dd");
                                  return (
                                    <td key={ds} className={`p-1 border-b border-l border-border text-center align-middle ${ds === todayStr ? "bg-[var(--gold)]/5" : ""}`}>
                                      {pendingHas(p, ds, per.val) && (
                                        <div
                                          className="w-full h-9 rounded-lg flex items-center justify-center text-[11px] font-semibold border border-dashed"
                                          style={{ borderColor: g.team?.color ?? "#A8A8A8", color: g.team?.color ?? "#6B6B6B" }}
                                          title="Escalado pelo link, ainda sem cadastro"
                                        >
                                          escalado
                                        </div>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      {editing && (
        <ShiftEditor
          {...editing}
          initialModality={editing.shift ? modalityOf(editing.shift) : defaultModality}
          managerId={managerId === "all" ? editing.broker.manager_id : managerId}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

// Turnos: os horários vêm das regras de check-in (SchedulePage atualiza a cada render).
let PERIODS: { val: "manha" | "tarde" | "noite"; label: string; start: string; end: string }[] = [
  { val: "manha", label: "Manhã", start: "09:00", end: "14:00" },
  { val: "tarde", label: "Tarde", start: "14:00", end: "19:00" },
  { val: "noite", label: "Noite", start: "19:00", end: "23:00" },
];

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function derivePeriod(startTime?: string): "manha" | "tarde" | "noite" | null {
  if (!startTime) return null;
  // turno cujo início fica mais perto do horário do plantão (vale também para
  // plantões antigos, lançados antes de uma mudança de horário)
  const t = toMinutes(startTime);
  let best = PERIODS[0];
  for (const p of PERIODS) {
    if (Math.abs(toMinutes(p.start) - t) < Math.abs(toMinutes(best.start) - t)) best = p;
  }
  return best.val;
}

function ShiftEditor({ broker, date, shift, initialPeriod, initialModality, managerId, onClose }: { broker: any; date: string; shift?: Shift; initialPeriod?: "manha" | "tarde" | "noite"; /** local do plantão ao abrir (Central ou Plantão); dá para trocar aqui */ initialModality: Modality; managerId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const pdvLabels = usePdvLabels();
  const [modality, setModality] = useState<Modality>(initialModality);
  const isPast = date < format(new Date(), "yyyy-MM-dd");
  const [period, setPeriod] = useState<"manha" | "tarde" | "noite" | null>(derivePeriod(shift?.start_time) ?? initialPeriod ?? null);
  const [plantao, setPlantao] = useState(shift?.notes ?? "");

  const projectsQ = useQuery({
    queryKey: ["projects-active"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id,name").eq("is_active", true).order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!period) throw new Error("Selecione um período (Manhã ou Tarde)");
      const p = PERIODS.find((x) => x.val === period)!;

      // Só é possível preencher a escala manualmente dentro das vagas já
      // configuradas (via "Configurar Escala"/link) para essa semana e
      // modalidade — evita escalar acima da capacidade definida.
      const weekStartStr = format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), "yyyy-MM-dd");
      const { data: config } = await supabase
        .from("shift_configs")
        .select("id")
        .eq("manager_id", managerId)
        .eq("week_start_date", weekStartStr)
        .eq("modality", modality)
        .maybeSingle();
      if (!config) {
        throw new Error("O administrador ainda não definiu as vagas dessa semana.");
      }

      const { data: slotRow } = await supabase
        .from("shift_slots")
        .select("id")
        .eq("config_id", config.id)
        .eq("date", date)
        .eq("period", p.label)
        .maybeSingle();
      if (!slotRow) {
        throw new Error("Não há vaga configurada para esse turno nessa semana.");
      }

      // O limite (total do turno, Central + Plantão) é conferido no banco.
      const slotId = slotRow.id;

      if (shift) {
        const { error } = await supabase.from("shifts").update({ start_time: p.start, end_time: p.end, notes: plantao || null, slot_id: slotId }).eq("id", shift.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("shifts").insert({ broker_id: broker.id, manager_id: managerId, date, start_time: p.start, end_time: p.end, notes: plantao || null, slot_id: slotId });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shifts"] }); toast.success("Salvo"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async () => { if (shift) { const { error } = await supabase.from("shifts").delete().eq("id", shift.id); if (error) throw error; } },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shifts"] }); toast.success("Removido"); onClose(); },
  });

  const plantaoOptions = ["Online", ...(projectsQ.data ?? []).map((p) => p.name)];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="bg-white w-full rounded-t-2xl p-5 safe-bottom" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{format(new Date(date + "T00:00:00"), "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
        <h3 className="text-lg font-semibold text-[var(--navy)] mb-4 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: broker.color }} />{broker.full_name}
        </h3>
        <div className="space-y-4">
          {isPast && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Este dia já passou: a mudança altera o histórico da escala.
            </p>
          )}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Local</p>
            <div className="grid grid-cols-2 gap-2">
              {([["online", pdvLabels.central], ["salao", pdvLabels.plantao]] as const).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setModality(m)}
                  aria-pressed={modality === m}
                  className={`h-12 px-2 rounded-xl font-semibold text-sm transition-colors truncate ${modality === m ? "bg-[var(--navy)] text-white" : "bg-[var(--surface)] text-[var(--navy)] border border-border"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Período</p>
            <div className="grid grid-cols-3 gap-2">
              {PERIODS.map((p) => (
                <button
                  key={p.val}
                  onClick={() => setPeriod(p.val)}
                  className={`h-12 rounded-xl font-semibold text-sm transition-colors ${period === p.val ? "bg-[var(--navy)] text-white" : "bg-[var(--surface)] text-[var(--navy)] border border-border"}`}
                >
                  {p.label}
                  <span className="block text-xs font-normal opacity-70">{p.start} – {p.end}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Nome do Plantão</p>
            <select
              className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm text-[var(--navy)]"
              value={plantao}
              onChange={(e) => setPlantao(e.target.value)}
            >
              <option value="">Selecionar plantão...</option>
              {plantaoOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            {shift && <button onClick={() => del.mutate()} className="h-12 px-4 rounded-xl bg-red-50 text-red-600 font-medium flex items-center gap-2"><Trash2 size={16} />Remover</button>}
            <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">Cancelar</button>
            <button onClick={() => save.mutate()} disabled={save.isPending || !period} className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
