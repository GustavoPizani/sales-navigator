import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { addDays, format, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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

  const brokersQ = useQuery({
    queryKey: ["brokers-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id,full_name,color,role,is_active")
        .eq("role", "broker").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: isAdmin,
  });

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
      <AppHeader title={isAdmin ? "Schedule" : "My Schedule"} />
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="p-2 rounded-lg bg-white border border-border"><ChevronLeft size={18} /></button>
          <p className="font-semibold text-[var(--navy)]">{format(weekStart, "MMM d")} – {format(addDays(weekStart, 6), "MMM d, yyyy")}</p>
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
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{format(d, "EEE, MMM d")}</p>
            {my.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-1">No shift</p>
            ) : (
              my.map((s) => (
                <p key={s.id} className="font-semibold text-[var(--navy)] mt-1">
                  {s.start_time.slice(0,5)} – {s.end_time.slice(0,5)}
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
                  <div>{format(d, "EEE")}</div><div className="text-muted-foreground font-normal">{format(d, "d")}</div>
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
                        {s ? <span>{s.start_time.slice(0,5)}<br/>{s.end_time.slice(0,5)}</span> : <Plus size={14} />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            {brokers.length === 0 && (
              <tr><td colSpan={8} className="text-center text-muted-foreground py-6">Add brokers in the Team tab.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && <ShiftEditor {...editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ShiftEditor({ broker, date, shift, onClose }: { broker: any; date: string; shift?: Shift; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [start, setStart] = useState(shift?.start_time.slice(0, 5) ?? "09:00");
  const [end, setEnd] = useState(shift?.end_time.slice(0, 5) ?? "18:00");
  const [notes, setNotes] = useState(shift?.notes ?? "");

  const save = useMutation({
    mutationFn: async () => {
      if (shift) {
        const { error } = await supabase.from("shifts").update({ start_time: start, end_time: end, notes: notes || null }).eq("id", shift.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("shifts").insert({ broker_id: broker.id, manager_id: user!.id, date, start_time: start, end_time: end, notes: notes || null });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shifts"] }); toast.success("Saved"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async () => { if (shift) { const { error } = await supabase.from("shifts").delete().eq("id", shift.id); if (error) throw error; } },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shifts"] }); toast.success("Removed"); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="bg-white w-full rounded-t-2xl p-5 safe-bottom" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{format(new Date(date + "T00:00:00"), "EEEE, MMM d")}</p>
        <h3 className="text-lg font-semibold text-[var(--navy)] mb-3 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: broker.color }} />{broker.full_name}
        </h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">Start<input type="time" className="w-full h-12 px-3 rounded-xl bg-[var(--surface)] border border-border" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="text-xs text-muted-foreground">End<input type="time" className="w-full h-12 px-3 rounded-xl bg-[var(--surface)] border border-border" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
          <input className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex gap-2 pt-2">
            {shift && <button onClick={() => del.mutate()} className="h-12 px-4 rounded-xl bg-red-50 text-red-600 font-medium flex items-center gap-2"><Trash2 size={16} />Remove</button>}
            <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">Cancel</button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
