import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, Plus, SlidersHorizontal, X } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { usePdvLabels, useShiftPeriods } from "@/hooks/useRoulette";

/** Turnos da escala (mesmos horários das vagas e do check-in). */
export const QUOTA_PERIODS = [
  { val: "Manhã", start: "09:00", end: "14:00" },
  { val: "Tarde", start: "14:00", end: "19:00" },
  { val: "Noite", start: "19:00", end: "23:00" },
] as const;

type Team = { id: string; label: string; color: string };
type Regra = { period: string; total: number };

// (crm_vagas_padrao ainda não está nos tipos gerados)
const db = supabase as unknown as {
  from: (t: string) => {
    select: (
      c: string,
    ) => Promise<{ data: Regra[] | null; error: { message: string; code?: string } | null }>;
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

const faltaMigration = (e: { message?: string; code?: string } | null) =>
  !!e &&
  (e.code === "42P01" ||
    e.code === "PGRST202" ||
    e.code === "PGRST205" ||
    /does not exist|could not find/i.test(e.message ?? ""));

/**
 * Admin: vagas por turno. Um número por turno (Manhã, Tarde, Noite) vale para
 * todas as equipes, todos os dias e todas as semanas, até ser mudado. Todas as
 * vagas são do Plantão (312 JAM).
 */
export function TeamQuotaButton({ teams }: { teams: Team[]; defaultManagerId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-[var(--navy)] text-white font-bold text-sm"
      >
        <SlidersHorizontal size={16} />
        <span>Vagas por turno</span>
      </button>
      {open && <VagasPorTurno equipes={teams.length} onClose={() => setOpen(false)} />}
    </>
  );
}

function VagasPorTurno({ equipes, onClose }: { equipes: number; onClose: () => void }) {
  // horários dos turnos definidos nas regras de check-in
  const turnos = useShiftPeriods().map((p) => ({ val: p.label, start: p.start, end: p.end }));
  const qc = useQueryClient();
  const labels = usePdvLabels();
  const [valores, setValores] = useState<Record<string, number>>({});

  const regraQ = useQuery({
    queryKey: ["vagas-padrao"],
    queryFn: async () => {
      const { data, error } = await db.from("crm_vagas_padrao").select("period, total");
      if (faltaMigration(error)) return { semTabela: true, regra: [] as Regra[] };
      if (error) throw new Error(error.message);
      return { semTabela: false, regra: data ?? [] };
    },
  });
  useEffect(() => {
    if (regraQ.data)
      setValores(Object.fromEntries(regraQ.data.regra.map((r) => [r.period, r.total])));
  }, [regraQ.data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = useMutation({
    mutationFn: async () => {
      const regra = turnos.map((t) => ({
        period: t.val,
        start: t.start,
        end: t.end,
        total: valores[t.val] ?? 0,
      }));
      const { error } = await db.rpc("crm_set_vagas_padrao", { p_regra: regra });
      if (faltaMigration(error))
        throw new Error(
          "O banco ainda não tem a nova regra de vagas. Rode a migration 20261019000001_vagas_padrao.sql no Supabase.",
        );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vagas-padrao"] });
      qc.invalidateQueries({ queryKey: ["shift-slots-capacity"] });
      qc.invalidateQueries({ queryKey: ["shift-links"] });
      toast.success("Vagas salvas para todas as equipes");
      onClose();
    },
  });

  const mudar = (t: string, v: number) =>
    setValores((x) => ({ ...x, [t]: Math.max(0, Math.min(50, Math.round(v) || 0)) }));
  const porDia = turnos.reduce((s, t) => s + (valores[t.val] ?? 0), 0);

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="vagas-titulo"
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] overflow-y-auto safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h3 id="vagas-titulo" className="font-bold text-[var(--navy)] text-lg">
              Vagas por turno
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Vale para todas as equipes{equipes ? ` (${equipes})` : ""}, todos os dias e toda
              semana, até você mudar.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="h-10 w-10 -mr-2 -mt-1 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-[var(--surface)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {regraQ.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" /> Carregando…
            </p>
          ) : regraQ.data?.semTabela ? (
            <p
              role="alert"
              className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-3"
            >
              Falta rodar a migration <b>20261019000001_vagas_padrao.sql</b> no Supabase para usar
              as vagas por turno.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {turnos.map((t) => {
                  const v = valores[t.val] ?? 0;
                  return (
                    <li key={t.val} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[var(--navy)]">{t.val}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.start}–{t.end}
                        </p>
                      </div>
                      <div
                        className="flex items-center gap-1"
                        role="group"
                        aria-label={`Vagas de ${t.val} por equipe`}
                      >
                        <button
                          type="button"
                          onClick={() => mudar(t.val, v - 1)}
                          disabled={v <= 0}
                          aria-label={`Menos uma vaga de ${t.val}`}
                          className="h-11 w-11 rounded-xl border border-border bg-[var(--surface)] text-[var(--navy)] inline-flex items-center justify-center disabled:opacity-40"
                        >
                          <Minus size={16} />
                        </button>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={50}
                          value={v}
                          onChange={(e) => mudar(t.val, Number(e.target.value))}
                          aria-label={`Vagas de ${t.val} por equipe`}
                          className="h-11 w-14 rounded-xl border border-border text-center text-lg font-bold tabular-nums text-[var(--navy)]"
                        />
                        <button
                          type="button"
                          onClick={() => mudar(t.val, v + 1)}
                          aria-label={`Mais uma vaga de ${t.val}`}
                          className="h-11 w-11 rounded-xl border border-border bg-[var(--surface)] text-[var(--navy)] inline-flex items-center justify-center"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Cada equipe terá <b className="text-[var(--navy)]">{porDia}</b> vaga
                {porDia === 1 ? "" : "s"} por dia. Todas as vagas são do {labels.plantao}. Turno com 0 vagas fica fechado. Quem já
                está escalado nunca é tirado: se um turno já tiver mais gente, ele fica com esse
                número.
              </p>
              {save.error && (
                <p
                  role="alert"
                  className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2"
                >
                  {save.error.message}
                </p>
              )}
            </>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium"
            >
              Cancelar
            </button>
            {!regraQ.data?.semTabela && (
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending || regraQ.isLoading}
                className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {save.isPending && <Loader2 size={16} className="animate-spin" />}
                {save.isPending ? "Salvando…" : "Salvar para todas"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
