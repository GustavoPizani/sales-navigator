import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Copy, Loader2, SlidersHorizontal, X } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { usePdvLabels } from "@/hooks/useRoulette";

/** Turnos da escala (mesmos horários das vagas e do check-in). */
export const QUOTA_PERIODS = [
  { val: "Manhã", start: "09:00", end: "14:00" },
  { val: "Tarde", start: "14:00", end: "19:00" },
  { val: "Noite", start: "19:00", end: "23:00" },
] as const;

const PDVS = [
  { modality: "online", key: "central" },
  { modality: "salao", key: "plantao" },
] as const;

type Grid = Record<string, number>; // `${modality}_${dayIndex}_${period}`
const cellKey = (modality: string, d: number, period: string) => `${modality}_${d}_${period}`;

type Team = { id: string; label: string; color: string };

/**
 * Admin: define quantas vagas cada gerente tem por PDV (Central / Plantão do
 * produto), dia e turno na semana. O gerente distribui os corretores nelas.
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
      const { data: configs, error } = await supabase
        .from("shift_configs")
        .select("id, modality")
        .eq("manager_id", managerId)
        .eq("week_start_date", weekStr);
      if (error) throw error;
      if (!configs?.length) return { grid: {} as Grid, used: {} as Grid };
      const { data: slots, error: sErr } = await supabase
        .from("shift_slots")
        .select("id, config_id, date, period, capacity")
        .in(
          "config_id",
          configs.map((c) => c.id),
        );
      if (sErr) throw sErr;
      const { data: shifts } = await supabase
        .from("shifts")
        .select("slot_id")
        .in(
          "slot_id",
          (slots ?? []).map((s) => s.id),
        );
      const usedBySlot = new Map<string, number>();
      (shifts ?? []).forEach(
        (s) => s.slot_id && usedBySlot.set(s.slot_id, (usedBySlot.get(s.slot_id) ?? 0) + 1),
      );
      const g: Grid = {};
      const used: Grid = {};
      for (const s of slots ?? []) {
        const modality = configs.find((c) => c.id === s.config_id)?.modality ?? "online";
        const d = Math.round(
          (new Date(`${s.date}T00:00:00`).getTime() - weekStart.getTime()) / 86_400_000,
        );
        g[cellKey(modality, d, s.period ?? "")] = s.capacity;
        used[cellKey(modality, d, s.period ?? "")] = usedBySlot.get(s.id) ?? 0;
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
    const prev = format(addDays(weekStart, -7), "yyyy-MM-dd");
    const { data: configs } = await supabase
      .from("shift_configs")
      .select("id, modality")
      .eq("manager_id", managerId)
      .eq("week_start_date", prev);
    if (!configs?.length)
      return toast("A semana anterior não tem vagas definidas.", { icon: "ℹ️" });
    const { data: slots } = await supabase
      .from("shift_slots")
      .select("config_id, date, period, capacity")
      .in(
        "config_id",
        configs.map((c) => c.id),
      );
    const prevStart = addDays(weekStart, -7).getTime();
    const g: Grid = {};
    for (const s of slots ?? []) {
      const modality = configs.find((c) => c.id === s.config_id)?.modality ?? "online";
      const d = Math.round((new Date(`${s.date}T00:00:00`).getTime() - prevStart) / 86_400_000);
      g[cellKey(modality, d, s.period ?? "")] = s.capacity;
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

              <div className="text-xs text-muted-foreground">
                Total da semana: <b className="text-[var(--navy)]">{total("online")}</b> vagas na{" "}
                {labels.central} · <b className="text-[var(--navy)]">{total("salao")}</b> no{" "}
                {labels.plantao}
              </div>

              <div className="overflow-x-auto border border-border rounded-xl">
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-[var(--surface)] text-[var(--navy)] text-xs">
                    <tr>
                      <th rowSpan={2} className="px-3 py-2 text-left border-b border-border">
                        Dia
                      </th>
                      {QUOTA_PERIODS.map((p) => (
                        <th
                          key={p.val}
                          colSpan={2}
                          className="px-2 py-1.5 text-center border-b border-l border-border"
                        >
                          {p.val}{" "}
                          <span className="font-normal text-muted-foreground">
                            {p.start}–{p.end}
                          </span>
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {QUOTA_PERIODS.map((p) =>
                        PDVS.map((pdv) => (
                          <th
                            key={p.val + pdv.key}
                            className="px-2 py-1.5 text-center font-semibold border-b border-l border-border whitespace-nowrap"
                          >
                            {pdv.key === "central" ? labels.central : labels.plantao}
                          </th>
                        )),
                      )}
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
                As vagas valem para a escala e para o check-in da roleta. Não é possível reduzir
                abaixo do número de corretores já escalados.
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
