import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBrokers } from "@/hooks/useBrokers";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { AppointmentForm, useOpenAppointmentFromUrl } from "./appointments";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: CalendarPage,
});

// Sunday-first week day headers in pt-BR
const DAY_INITIALS = ["D", "S", "T", "Q", "Q", "S", "S"];

function CalendarPage() {
  const { isAdmin, isDirector } = useAuth();
  if (!isAdmin && !isDirector) return <Navigate to="/dashboard" replace />;
  return <CalendarView mode="team" title="Calendário" />;
}

export function CalendarView({ mode, title }: { mode: "team" | "own"; title: string }) {
  const { profile } = useAuth();
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(format(new Date(), "yyyy-MM-dd"));
  const [filterBrokers, setFilterBrokers] = useState<string[]>([]);
  const [editing, setEditing] = useState<any | "new" | null>(null);
  const [dayModalOpen, setDayModalOpen] = useState(false);
  useOpenAppointmentFromUrl(setEditing);

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const brokersQ = useBrokers({ enabled: mode === "team" });
  const allBrokerIds = useMemo(() => (brokersQ.data ?? []).map((p) => p.id), [brokersQ.data]);

  const apptsQ = useQuery({
    queryKey: ["team-appts", mode, profile?.id, format(monthStart, "yyyy-MM"), filterBrokers.join(",")],
    enabled: mode === "team" || !!profile?.id,
    queryFn: async () => {
      let q = supabase.from("appointments").select("*")
        .gte("date", format(gridStart, "yyyy-MM-dd")).lte("date", format(gridEnd, "yyyy-MM-dd"));
      if (mode === "own") {
        q = q.eq("owner_id", profile!.id);
      } else if (filterBrokers.length > 0) {
        q = q.in("owner_id", filterBrokers);
      }
      const { data } = await q;
      return data ?? [];
    },
  });

  const clientIds = useMemo(() => {
    if (mode !== "team") return [];
    return (apptsQ.data ?? []).map((a) => a.client_id).filter(Boolean) as string[];
  }, [apptsQ.data, mode]);

  const brokerByClientQ = useQuery({
    queryKey: ["appt-client-brokers", clientIds.join(",")],
    enabled: clientIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("atendimentos")
        .select("id_cliente, broker_id, profiles!atendimentos_broker_id_fkey(id,full_name,color)")
        .in("id_cliente", clientIds);
      const map: Record<string, any> = {};
      (data ?? []).forEach((r: any) => {
        if (r.id_cliente && r.profiles) map[r.id_cliente] = r.profiles;
      });
      return map;
    },
  });

  const brokerForAppt = (a: any) => {
    if (mode === "own") return profile;
    if (a.client_id && brokerByClientQ.data?.[a.client_id]) {
      return brokerByClientQ.data[a.client_id];
    }
    return (brokersQ.data ?? []).find((p) => p.id === a.owner_id);
  };

  const teamIds = useMemo(() => {
    const s = new Set(allBrokerIds);
    if (profile?.id) s.add(profile.id);
    return s;
  }, [allBrokerIds, profile?.id]);

  const filteredAppts = useMemo(() => {
    if (mode === "own") return apptsQ.data ?? [];
    return (apptsQ.data ?? []).filter((a) => {
      if (filterBrokers.length > 0) {
        const broker = brokerForAppt(a);
        return broker ? filterBrokers.includes(broker.id) : false;
      }
      const broker = brokerForAppt(a);
      if (broker && teamIds.has(broker.id)) return true;
      return teamIds.has(a.owner_id);
    });
  }, [apptsQ.data, brokerByClientQ.data, filterBrokers, teamIds, mode]);

  const byDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    filteredAppts.forEach((a) => { (map[a.date] ||= []).push(a); });
    return map;
  }, [filteredAppts]);

  const dayAppts = (byDay[selectedDay] ?? []).sort((a, b) => a.start_time.localeCompare(b.start_time));

  const numWeeks = days.length / 7;

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      <AppHeader title={title} />

      <div className="flex-1 min-h-0 flex flex-col px-4 pt-3 pb-nav gap-2">
        {/* Month navigation */}
        <div className="flex items-center justify-between flex-shrink-0">
          <button onClick={() => setMonth(addDays(monthStart, -1))} className="p-2 rounded-lg bg-white border border-border"><ChevronLeft size={18} /></button>
          <p className="font-semibold text-[var(--navy)] capitalize">{format(month, "MMMM yyyy", { locale: ptBR })}</p>
          <button onClick={() => setMonth(addDays(monthEnd, 1))} className="p-2 rounded-lg bg-white border border-border"><ChevronRight size={18} /></button>
        </div>

        {/* Filter chips (team mode only) */}
        {mode === "team" && (
          <div className="flex gap-2 overflow-x-auto flex-shrink-0 -mx-1 px-1">
            <button onClick={() => setFilterBrokers([])} className={`h-7 px-3 rounded-full text-xs font-medium whitespace-nowrap ${filterBrokers.length === 0 ? "bg-[var(--navy)] text-white" : "bg-white text-muted-foreground border border-border"}`}>Todos</button>
            {(brokersQ.data ?? []).map((p) => {
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
        )}

        {/* Calendar grid — fills all remaining space */}
        <div
          className="flex-1 min-h-0 grid grid-cols-7 gap-1"
          style={{ gridTemplateRows: `auto repeat(${numWeeks}, 1fr)` }}
        >
          {DAY_INITIALS.map((d, i) => (
            <div key={i} className="text-center text-[10px] font-semibold text-muted-foreground py-1">{d}</div>
          ))}
          {days.map((d) => {
            const ds = format(d, "yyyy-MM-dd");
            const inMonth = d.getMonth() === month.getMonth();
            const dots = (byDay[ds] ?? []).map((a) => brokerForAppt(a)?.color).filter(Boolean) as string[];
            const uniq = Array.from(new Set(dots)).slice(0, 4);
            const isSel = ds === selectedDay;
            return (
              <button key={ds} onClick={() => { setSelectedDay(ds); setDayModalOpen(true); }}
                className={`rounded-lg flex flex-col items-center justify-center text-xs min-h-0 ${isSel ? "bg-[var(--navy)] text-white" : "bg-white"} ${!inMonth ? "opacity-40" : ""}`}>
                <span>{format(d, "d")}</span>
                <div className="flex gap-0.5 mt-0.5">
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
          brokerForAppt={brokerForAppt}
          onClose={() => setDayModalOpen(false)}
          onEdit={(a) => { setEditing(a); setDayModalOpen(false); }}
          onAddNew={() => { setEditing("new"); setDayModalOpen(false); }}
        />
      )}

      {editing && <AppointmentForm appt={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DayModal({ date, appts, brokerForAppt, onClose, onEdit, onAddNew }: {
  date: string;
  appts: any[];
  brokerForAppt: (a: any) => any;
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
            const broker = brokerForAppt(a);
            return (
              <button key={a.id} onClick={() => onEdit(a)} className="w-full text-left bg-[var(--surface)] rounded-xl p-3 border border-border flex items-start gap-3">
                {broker && <Avatar name={broker.full_name} color={broker.color} size={36} />}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[var(--navy)] truncate">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{a.start_time.slice(0,5)}–{a.end_time.slice(0,5)} · {broker?.full_name}</p>
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
