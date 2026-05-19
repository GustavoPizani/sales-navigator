import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { AppointmentForm } from "./appointments";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: CalendarPage,
});

function CalendarPage() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/my-day" replace />;
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(format(new Date(), "yyyy-MM-dd"));
  const [filterBrokers, setFilterBrokers] = useState<string[]>([]);
  const [editing, setEditing] = useState<any | "new" | null>(null);

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const profilesQ = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id,full_name,color,role,is_active,phone,email");
      return data ?? [];
    },
  });

  const apptsQ = useQuery({
    queryKey: ["team-appts", format(monthStart, "yyyy-MM"), filterBrokers.join(",")],
    queryFn: async () => {
      let q = supabase.from("appointments").select("*")
        .gte("date", format(gridStart, "yyyy-MM-dd")).lte("date", format(gridEnd, "yyyy-MM-dd"));
      if (filterBrokers.length) q = q.in("owner_id", filterBrokers);
      const { data } = await q;
      return data ?? [];
    },
  });

  const byDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    (apptsQ.data ?? []).forEach((a) => { (map[a.date] ||= []).push(a); });
    return map;
  }, [apptsQ.data]);

  const profileById = (id: string) => (profilesQ.data ?? []).find((p) => p.id === id);
  const dayAppts = (byDay[selectedDay] ?? []).sort((a, b) => a.start_time.localeCompare(b.start_time));

  return (
    <div className="pb-nav">
      <AppHeader title="Calendar" />
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setMonth(addDays(monthStart, -1))} className="p-2 rounded-lg bg-white border border-border"><ChevronLeft size={18} /></button>
          <p className="font-semibold text-[var(--navy)]">{format(month, "MMMM yyyy")}</p>
          <button onClick={() => setMonth(addDays(monthEnd, 1))} className="p-2 rounded-lg bg-white border border-border"><ChevronRight size={18} /></button>
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          <button onClick={() => setFilterBrokers([])} className={`h-7 px-3 rounded-full text-xs font-medium whitespace-nowrap ${filterBrokers.length === 0 ? "bg-[var(--navy)] text-white" : "bg-white text-muted-foreground border border-border"}`}>All</button>
          {(profilesQ.data ?? []).filter((p) => p.is_active).map((p) => {
            const on = filterBrokers.includes(p.id);
            return (
              <button key={p.id} onClick={() => setFilterBrokers(on ? filterBrokers.filter((x) => x !== p.id) : [...filterBrokers, p.id])}
                className="h-7 px-3 rounded-full text-xs font-medium whitespace-nowrap flex items-center gap-1.5"
                style={{ background: on ? p.color : "#FFFFFF", color: on ? "#FFFFFF" : "var(--muted-foreground)", border: on ? "none" : "1px solid var(--border)" }}>
                <span className="w-2 h-2 rounded-full" style={{ background: on ? "#FFFFFF" : p.color }} />
                {p.full_name.split(" ")[0]}
              </button>
            );
          })}
        </div>

        {/* Month grid */}
        <div className="grid grid-cols-7 gap-1 mt-3">
          {["S","M","T","W","T","F","S"].map((d, i) => (<div key={i} className="text-center text-[10px] font-semibold text-muted-foreground py-1">{d}</div>))}
          {days.map((d) => {
            const ds = format(d, "yyyy-MM-dd");
            const inMonth = d.getMonth() === month.getMonth();
            const dots = (byDay[ds] ?? []).map((a) => profileById(a.owner_id)?.color).filter(Boolean) as string[];
            const uniq = Array.from(new Set(dots)).slice(0, 4);
            const isSel = ds === selectedDay;
            return (
              <button key={ds} onClick={() => setSelectedDay(ds)}
                className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs ${isSel ? "bg-[var(--navy)] text-white" : "bg-white"} ${!inMonth ? "opacity-40" : ""}`}>
                <span>{format(d, "d")}</span>
                <div className="flex gap-0.5 mt-0.5 h-1.5">
                  {uniq.map((c, i) => (<span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />))}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          <p className="text-sm font-semibold text-[var(--navy)] mb-2">{format(new Date(selectedDay + "T00:00:00"), "EEEE, MMM d")}</p>
          {dayAppts.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No appointments.</p>}
          <div className="space-y-2">
            {dayAppts.map((a) => {
              const owner = profileById(a.owner_id);
              return (
                <button key={a.id} onClick={() => setEditing(a)} className="w-full text-left bg-white rounded-xl p-3 border border-border flex items-start gap-3">
                  {owner && <Avatar name={owner.full_name} color={owner.color} size={36} />}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[var(--navy)] truncate">{a.title}</p>
                    <p className="text-xs text-muted-foreground">{a.start_time.slice(0,5)}–{a.end_time.slice(0,5)} · {owner?.full_name}</p>
                    {a.client_name && <p className="text-xs text-muted-foreground">Client: {a.client_name}</p>}
                  </div>
                  <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded-full bg-[var(--gold)]/20 text-[var(--navy)] font-semibold">{a.type}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <button onClick={() => setEditing("new")}
        className="fixed right-4 bottom-24 z-30 w-14 h-14 rounded-full bg-[var(--gold)] text-[var(--navy)] shadow-lg flex items-center justify-center" aria-label="New appointment">
        <Plus size={28} strokeWidth={2.5} />
      </button>

      {editing && <AppointmentForm appt={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
