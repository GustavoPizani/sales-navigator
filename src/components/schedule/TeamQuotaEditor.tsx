import { useEffect, useMemo, useState } from "react";
import { ManagerPublicLink } from "./ManagerPublicLink";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Copy, Loader2, SlidersHorizontal, X } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { usePdvLabels, useShiftPeriods } from "@/hooks/useRoulette";

/** Turnos da escala (mesmos horários das vagas e do check-in). */
export const QUOTA_PERIODS = [
  { val: "Manhã", start: "09:00", end: "14:00" },
  { val: "Tarde", start: "14:00", end: "19:00" },
  { val: "Noite", start: "19:00", end: "23:00" },
] as const;

// O admin define só o total do turno; o gerente escolhe o PDV de cada corretor.
const PDVS = [{ modality: "total", key: "total" }] as const;

type Grid = Record<string, number>; // `${modality}_${dayIndex}_${period}`
const cellKey = (modality: string, d: number, period: string) => `${modality}_${d}_${period}`;

type Team = { id: string; label: string; color: string };

/**
 * Admin: define quantas vagas cada gerente tem por dia e turno na semana.
 * O gerente distribui os corretores e decide quantos ficam na Central e
 * quantos no Plantão.
 */
export function TeamQuotaButton({
  teams,
  defaultManagerId,
}: {
  teams: Team[];
  defaultManagerId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-2 h-9 px-4 rounded-xl bg-[var(--navy)] text-white font-bold text-sm"
      >
        <SlidersHorizontal size={16} />
        <span className="hidden sm:inline">Vagas das equipes</span>
      </button>
      {open && (
        <TeamQuotaEditor
          teams={teams}
          defaultManagerId={defaultManagerId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function TeamQuotaEditor({
  teams,
  defaultManagerId,
  onClose,
}: {
  teams: Team[];
  defaultManagerId?: string;
  onClose: () => void;
}) {
  // horários dos turnos definidos nas regras de check-in
  const shiftPeriods = useShiftPeriods();
  const QUOTA_PERIODS = shiftPeriods.map((p) => ({ val: p.label, start: p.start, end: p.end }));
  const qc = useQueryClient();
  const labels = usePdvLabels();
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(addDays(new Date(), 7), { weekStartsOn: 1 }),
  );
  const [managerId, setManagerId] = useState(
    defaultManagerId && teams.some((t) => t.id === defaultManagerId)
      ? defaultManagerId
      : (teams[0]?.id ?? ""),
  );
  const [grid, setGrid] = useState<Grid>({});
  const weekStr = format(weekStart, "yyyy-MM-dd");
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  // Cota atual (e quantos já estão escalados em cada vaga)
  const currentQ = useQuery({
    queryKey: ["team-quota", managerId, weekStr],
    enabled: !!managerId,
    queryFn: async () => {
      const weekEnd = format(addDays(weekStart, 6), "yyyy-MM-dd");
      const dayIndex = (date: string) =>
        Math.round((new Date(`${date}T00:00:00`).getTime() - weekStart.getTime()) / 86_400_000);
      // (team_period_quotas e pending_shifts ainda não estão nos tipos gerados)
      const { data: quotas, error } = await (supabase as any)
        .from("team_period_quotas")
        .select("date, period, total")
        .eq("manager_id", managerId)
        .gte("date", weekStr)
        .lte("date", weekEnd);
      if (error) throw error;
      const g: Grid = {};
      const used: Grid = {};
      for (const q of (quotas ?? []) as { date: string; period: string; total: number }[]) {
        g[cellKey("total", dayIndex(q.date), q.period)] = q.total;
      }

      // já escalados no turno: Central + Plantão, cadastrados e pré-cadastrados
      const { data: configs } = await supabase
        .from("shift_configs")
        .select("id")
        .eq("manager_id", managerId)
        .eq("week_start_date", weekStr);
      if (configs?.length) {
        const { data: slots } = await supabase
          .from("shift_slots")
          .select("id, date, period")
          .in(
            "config_id",
            configs.map((c) => c.id),
          );
        const ids = (slots ?? []).map((s) => s.id);
        if (ids.length) {
          const [{ data: shifts }, { data: pend }] = await Promise.all([
            supabase.from("shifts").select("slot_id").in("slot_id", ids),
            (supabase as any).from("pending_shifts").select("slot_id").in("slot_id", ids),
          ]);
          const slotKey = new Map(
            (slots ?? []).map((s) => [s.id, cellKey("total", dayIndex(s.date), s.period ?? "")]),
          );
          for (const r of [...(shifts ?? []), ...((pend ?? []) as { slot_id: string }[])]) {
            const k = r.slot_id ? slotKey.get(r.slot_id) : undefined;
            if (k) used[k] = (used[k] ?? 0) + 1;
          }
        }
      }
      return { grid: g, used };
    },
  });
  useEffect(() => {
    if (currentQ.data) setGrid(currentQ.data.grid);
  }, [currentQ.data]);

  const used = currentQ.data?.used ?? {};

  const save = useMutation({
    mutationFn: async () => {
      const quota = PDVS.flatMap((p) =>
        days.flatMap((day, d) =>
          QUOTA_PERIODS.map((per) => ({
            modality: p.modality,
            date: format(day, "yyyy-MM-dd"),
            period: per.val,
            start: per.start,
            end: per.end,
            capacity: grid[cellKey(p.modality, d, per.val)] ?? 0,
          })),
        ),
      );
      const { error } = await supabase.rpc("crm_set_team_quota", {
        p_manager_id: managerId,
        p_week_start: weekStr,
        p_quota: quota,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-quota"] });
      qc.invalidateQueries({ queryKey: ["shift-slots-capacity"] });
      qc.invalidateQueries({ queryKey: ["shift-links"] });
      toast.success("Vagas da equipe salvas!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const copyFromPreviousWeek = async () => {
    const prevStart = addDays(weekStart, -7);
    const { data } = await (supabase as any)
      .from("team_period_quotas")
      .select("date, period, total")
      .eq("manager_id", managerId)
      .gte("date", format(prevStart, "yyyy-MM-dd"))
      .lt("date", weekStr);
    const quotas = (data ?? []) as { date: string; period: string; total: number }[];
    if (!quotas.length) return toast("A semana anterior não tem vagas definidas.", { icon: "ℹ️" });
    const g: Grid = {};
    for (const q of quotas) {
      const d = Math.round(
        (new Date(`${q.date}T00:00:00`).getTime() - prevStart.getTime()) / 86_400_000,
      );
      g[cellKey("total", d, q.period)] = q.total;
    }
    setGrid(g);
    toast.success("Vagas copiadas da semana anterior. Revise e salve.");
  };

  const total = (modality: string) =>
    days.reduce(
      (sum, _d, d) =>
        sum + QUOTA_PERIODS.reduce((s2, p) => s2 + (grid[cellKey(modality, d, p.val)] ?? 0), 0),
      0,
    );

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-3"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-[var(--surface)]">
          <h3 className="font-bold text-[var(--navy)] text-lg">Vagas das equipes</h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-[var(--navy)]"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Cadastre os gerentes na tela Time para definir as vagas.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase block mb-1">
                    Equipe
                  </span>
                  <select
                    value={managerId}
                    onChange={(e) => setManagerId(e.target.value)}
                    className="h-10 px-3 rounded-lg border border-border bg-white text-sm"
                  >
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        Equipe {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase block mb-1">
                    Semana (segunda)
                  </span>
                  <input
                    type="date"
                    value={weekStr}
                    onChange={(e) =>
                      e.target.value &&
                      setWeekStart(
                        startOfWeek(new Date(`${e.target.value}T00:00:00`), { weekStartsOn: 1 }),
                      )
                    }
                    className="h-10 px-3 rounded-lg border border-border bg-white text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={copyFromPreviousWeek}
                  className="h-10 px-3 rounded-lg border border-border bg-white text-sm inline-flex items-center gap-1.5"
                >
                  <Copy size={14} /> Copiar semana anterior
                </button>
              </div>

              {managerId && <ManagerPublicLink managerId={managerId} />}

              <div className="text-xs text-muted-foreground">
                Total da semana: <b className="text-[var(--navy)]">{total("total")}</b> vagas. O
                gerente decide, ao escalar, quantas ficam na {labels.central} e quantas no{" "}
                {labels.plantao}.
              </div>

              <div className="overflow-x-auto border border-border rounded-xl">
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-[var(--surface)] text-[var(--navy)] text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left border-b border-border">Dia</th>
                      {QUOTA_PERIODS.map((p) => (
                        <th
                          key={p.val}
                          className="px-2 py-1.5 text-center border-b border-l border-border"
                        >
                          {p.val}{" "}
                          <span className="font-normal text-muted-foreground">
                            {p.start}–{p.end}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {days.map((day, d) => (
                      <tr key={d}>
                        <td className="px-3 py-1.5 whitespace-nowrap capitalize font-medium text-[var(--navy)]">
                          {format(day, "EEE dd/MM", { locale: ptBR })}
                        </td>
                        {QUOTA_PERIODS.map((p) =>
                          PDVS.map((pdv) => {
                            const k = cellKey(pdv.modality, d, p.val);
                            const u = used[k] ?? 0;
                            return (
                              <td
                                key={k}
                                className="px-1.5 py-1 text-center border-l border-border"
                              >
                                <input
                                  type="number"
                                  min={u}
                                  max={999}
                                  inputMode="numeric"
                                  placeholder="0"
                                  value={grid[k] || ""}
                                  onChange={(e) => {
                                    const v = Math.max(0, parseInt(e.target.value) || 0);
                                    setGrid((g) => ({ ...g, [k]: v }));
                                  }}
                                  className="w-14 h-9 text-center rounded-lg border border-border bg-[var(--surface)] text-[var(--navy)] font-semibold focus:outline-none focus:border-[var(--gold)]"
                                  aria-label={`${format(day, "EEEE", { locale: ptBR })} ${p.val} ${pdv.key}`}
                                />
                                {u > 0 && (
                                  <div className="text-[9px] text-muted-foreground mt-0.5">
                                    {u} escalado{u > 1 ? "s" : ""}
                                  </div>
                                )}
                              </td>
                            );
                          }),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                As vagas valem para a escala e para o check-in da roleta, somando {labels.central} e{" "}
                {labels.plantao}. Não é possível reduzir abaixo do número de corretores já escalados
                no turno.
              </p>
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border bg-[var(--surface)] flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-11 rounded-xl bg-white border border-border text-[var(--navy)] font-medium"
          >
            Fechar
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !managerId}
            className="flex-1 h-11 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {save.isPending && <Loader2 size={16} className="animate-spin" />} Salvar vagas
          </button>
        </div>
      </div>
    </div>
  );
}
