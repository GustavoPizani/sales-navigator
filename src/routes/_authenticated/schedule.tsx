import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { addDays, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBrokers } from "@/hooks/useBrokers";
import { AppHeader } from "@/components/AppHeader";

export const Route = createFileRoute("/_authenticated/schedule")({
  component: SchedulePage,
});

type Shift = {
  id: string; broker_id: string; manager_id: string; date: string;
  start_time: string; end_time: string; notes: string | null;
};

function SchedulePage() {
  const { isAdmin, user } = useAuth();
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const startStr = format(weekStart, "yyyy-MM-dd");
  const endStr = format(addDays(weekStart, 6), "yyyy-MM-dd");

  const brokersQ = useBrokers({ select: "id,full_name,color,role,is_active", enabled: isAdmin });

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

  return (
    <div className="pb-nav">
      <AppHeader title={isAdmin ? "Escala" : "Minha Escala"} />
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="p-2 rounded-lg bg-white border border-border"><ChevronLeft size={18} /></button>
          <p className="font-semibold text-[var(--navy)]">{format(weekStart, "d 'de' MMM", { locale: ptBR })} – {format(addDays(weekStart, 6), "d 'de' MMM, yyyy", { locale: ptBR })}</p>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="p-2 rounded-lg bg-white border border-border"><ChevronRight size={18} /></button>
        </div>

        {isAdmin ? (
          <AdminGrid days={days} brokers={brokersQ.data ?? []} shifts={shiftsQ.data ?? []} />
        ) : (
          <BrokerWeek days={days} shifts={shiftsQ.data ?? []} />
        )}
      </div>
    </div>
  );
}

function BrokerWeek({ days, shifts }: { days: Date[]; shifts: Shift[] }) {
  return (
    <div className="space-y-2">
      {days.map((d) => {
        const ds = format(d, "yyyy-MM-dd");
        const my = shifts.filter((s) => s.date === ds);
        return (
          <div key={ds} className="bg-white rounded-xl p-3 border border-border">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{format(d, "EEE, d 'de' MMM", { locale: ptBR })}</p>
            {my.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-1">Sem turno</p>
            ) : (
              my.map((s) => (
                <p key={s.id} className="font-semibold text-[var(--navy)] mt-1">
                  {derivePeriod(s.start_time) === "manha" ? "Manhã" : "Tarde"}
                  {s.notes && <span className="block text-xs text-muted-foreground font-normal">{s.notes}</span>}
                </p>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

function AdminGrid({ days, brokers, shifts }: { days: Date[]; brokers: any[]; shifts: Shift[] }) {
  const [editing, setEditing] = useState<{ broker: any; date: string; shift?: Shift } | null>(null);
  return (
    <>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="min-w-full text-xs border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="text-left pb-1"></th>
              {days.map((d) => (
                <th key={d.toISOString()} className="text-center font-semibold text-[var(--navy)] pb-1 min-w-[60px]">
                  <div>{format(d, "EEE", { locale: ptBR })}</div><div className="text-muted-foreground font-normal">{format(d, "d")}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {brokers.map((b) => (
              <tr key={b.id}>
                <td className="pr-2 py-1 align-middle">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: b.color }} />
                    <span className="font-medium text-[var(--navy)] whitespace-nowrap">{b.full_name.split(" ")[0]}</span>
                  </div>
                </td>
                {days.map((d) => {
                  const ds = format(d, "yyyy-MM-dd");
                  const s = shifts.find((x) => x.broker_id === b.id && x.date === ds);
                  return (
                    <td key={ds} className="align-middle">
                      <button
                        onClick={() => setEditing({ broker: b, date: ds, shift: s })}
                        className="w-full h-12 rounded-lg flex items-center justify-center text-[10px] font-semibold leading-tight px-1"
                        style={{
                          background: s ? b.color : "#FFFFFF",
                          color: s ? "#FFFFFF" : "var(--muted-foreground)",
                          border: s ? "none" : "1px dashed var(--border)",
                        }}>
                        {s ? (
                          <span className="text-center leading-tight">
                            <span className="block font-bold">{derivePeriod(s.start_time) === "manha" ? "M" : "T"}</span>
                            {s.notes && <span className="block truncate max-w-[48px] text-[9px] opacity-90">{s.notes}</span>}
                          </span>
                        ) : <Plus size={14} />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            {brokers.length === 0 && (
              <tr><td colSpan={8} className="text-center text-muted-foreground py-6">Adicione corretores na aba Time.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && <ShiftEditor {...editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const PERIODS = [
  { val: "manha" as const, label: "Manhã", start: "09:00", end: "14:00" },
  { val: "tarde" as const, label: "Tarde", start: "14:00", end: "19:00" },
];

function derivePeriod(startTime?: string): "manha" | "tarde" | null {
  if (!startTime) return null;
  if (startTime.startsWith("08") || startTime.startsWith("07") || startTime.startsWith("06")) return "manha";
  if (startTime.startsWith("13") || startTime.startsWith("12") || startTime.startsWith("14")) return "tarde";
  return null;
}

function ShiftEditor({ broker, date, shift, onClose }: { broker: any; date: string; shift?: Shift; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<"manha" | "tarde" | null>(derivePeriod(shift?.start_time));
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
      if (shift) {
        const { error } = await supabase.from("shifts").update({ start_time: p.start, end_time: p.end, notes: plantao || null }).eq("id", shift.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("shifts").insert({ broker_id: broker.id, manager_id: user!.id, date, start_time: p.start, end_time: p.end, notes: plantao || null });
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

  const plantaoOptions = ["Central", ...(projectsQ.data ?? []).map((p) => p.name)];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="bg-white w-full rounded-t-2xl p-5 safe-bottom" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{format(new Date(date + "T00:00:00"), "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
        <h3 className="text-lg font-semibold text-[var(--navy)] mb-4 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: broker.color }} />{broker.full_name}
        </h3>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Período</p>
            <div className="grid grid-cols-2 gap-2">
              {PERIODS.map((p) => (
                <button
                  key={p.val}
                  onClick={() => setPeriod(p.val)}
                  className={`h-12 rounded-xl font-semibold text-sm transition-colors ${period === p.val ? "bg-[var(--navy)] text-white" : "bg-[var(--surface)] text-[var(--navy)] border border-border"}`}
                >
                  {p.label}
                  <span className="block text-[10px] font-normal opacity-70">{p.start} – {p.end}</span>
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
