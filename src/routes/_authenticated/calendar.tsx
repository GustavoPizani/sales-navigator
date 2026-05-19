import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { AppointmentForm } from "./appointments";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: CalendarPage,
});

// Sunday-first week day headers in pt-BR
const DAY_INITIALS = ["D", "S", "T", "Q", "Q", "S", "S"];

function CalendarPage() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(format(new Date(), "yyyy-MM-dd"));
  const [filterBrokers, setFilterBrokers] = useState<string[]>([]);
  const [editing, setEditing] = useState<any | "new" | null>(null);
  const [dayModalOpen, setDayModalOpen] = useState(false);

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
      <AppHeader title="Calendário" />
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setMonth(addDays(monthStart, -1))} className="p-2 rounded-lg bg-white border border-border"><ChevronLeft size={18} /></button>
          <p className="font-semibold text-[var(--navy)] capitalize">{format(month, "MMMM yyyy", { locale: ptBR })}</p>
          <button onClick={() => setMonth(addDays(monthEnd, 1))} className="p-2 rounded-lg bg-white border border-border"><ChevronRight size={18} /></button>
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          <button onClick={() => setFilterBrokers([])} className={`h-7 px-3 rounded-full text-xs font-medium whitespace-nowrap ${filterBrokers.length === 0 ? "bg-[var(--navy)] text-white" : "bg-white text-muted-foreground border border-border"}`}>Todos</button>
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
          {DAY_INITIALS.map((d, i) => (<div key={i} className="text-center text-[10px] font-semibold text-muted-foreground py-1">{d}</div>))}
          {days.map((d) => {
            const ds = format(d, "yyyy-MM-dd");
            const inMonth = d.getMonth() === month.getMonth();
            const dots = (byDay[ds] ?? []).map((a) => profileById(a.owner_id)?.color).filter(Boolean) as string[];
            const uniq = Array.from(new Set(dots)).slice(0, 4);
            const isSel = ds === selectedDay;
            return (
              <button key={ds} onClick={() => { setSelectedDay(ds); setDayModalOpen(true); }}
                className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs ${isSel ? "bg-[var(--navy)] text-white" : "bg-white"} ${!inMonth ? "opacity-40" : ""}`}>
                <span>{format(d, "d")}</span>
                <div className="flex gap-0.5 mt-0.5 h-1.5">
                  {uniq.map((c, i) => (<span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />))}
                </div>
              </button>
            );
          })}
        </div>

      </div>

      <button onClick={() => { setEditing("new"); setDayModalOpen(false); }}
        className="fixed right-4 bottom-24 z-30 w-14 h-14 rounded-full bg-[var(--gold)] text-[var(--navy)] shadow-lg flex items-center justify-center" aria-label="Novo agendamento">
        <Plus size={28} strokeWidth={2.5} />
      </button>

      {dayModalOpen && (
        <DayModal
          date={selectedDay}
          appts={dayAppts}
          profileById={profileById}
          onClose={() => setDayModalOpen(false)}
          onEdit={(a) => { setEditing(a); setDayModalOpen(false); }}
          onAddNew={() => { setEditing("new"); setDayModalOpen(false); }}
        />
      )}

      {editing && <AppointmentForm appt={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DayModal({ date, appts, profileById, onClose, onEdit, onAddNew }: {
  date: string;
  appts: any[];
  profileById: (id: string) => any;
  onClose: () => void;
  onEdit: (a: any) => void;
  onAddNew: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="bg-white w-full rounded-t-2xl safe-bottom max-h-[75vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border flex-shrink-0">
          <p className="font-semibold text-[var(--navy)] capitalize">
            {format(new Date(date + "T00:00:00"), "EEEE, d 'de' MMMM", { locale: ptBR })}
          </p>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-[var(--navy)]"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-2">
          {appts.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum agendamento neste dia.</p>
          )}
          {appts.map((a) => {
            const owner = profileById(a.owner_id);
            return (
              <button key={a.id} onClick={() => onEdit(a)} className="w-full text-left bg-[var(--surface)] rounded-xl p-3 border border-border flex items-start gap-3">
                {owner && <Avatar name={owner.full_name} color={owner.color} size={36} />}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[var(--navy)] truncate">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{a.start_time.slice(0,5)}–{a.end_time.slice(0,5)} · {owner?.full_name}</p>
                  {a.client_name && <p className="text-xs text-muted-foreground">Cliente: {a.client_name}</p>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="px-5 pb-5 pt-3 border-t border-border flex-shrink-0">
          <button onClick={onAddNew} className="w-full h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold text-sm flex items-center justify-center gap-2">
            <Plus size={16} /> Novo agendamento
          </button>
        </div>
      </div>
    </div>
  );
}
