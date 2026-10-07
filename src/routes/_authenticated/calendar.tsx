import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { RequireModule } from "@/components/RequireModule";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Copy, List, MessageCircle, Plus, Send, X } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBrokers } from "@/hooks/useBrokers";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { AppointmentForm, useOpenAppointmentFromUrl } from "./appointments";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: CalendarPageGuarded,
});

// Rota bloqueada pela matriz de permissões do cargo.
function CalendarPageGuarded() {
  return (
    <RequireModule modules={["appointments"]}>
      <CalendarPage />
    </RequireModule>
  );
}

// Sunday-first week day headers in pt-BR
const DAY_INITIALS = ["D", "S", "T", "Q", "Q", "S", "S"];

function CalendarPage() {
  const { isAdmin, isDirector } = useAuth();
  if (!isAdmin && !isDirector) return <Navigate to="/dashboard" replace />;
  return <CalendarView mode="team" title="Calendário" />;
}

export function CalendarView({ mode, title }: { mode: "team" | "own"; title: string }) {
  const { profile, isSuperAdmin } = useAuth();
  // link do relatório de visitas, para o admin enviar aos corretores
  const [reportLinkOpen, setReportLinkOpen] = useState(false);
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(format(new Date(), "yyyy-MM-dd"));
  const [filterBrokers, setFilterBrokers] = useState<string[]>([]);
  const [editing, setEditing] = useState<any | "new" | null>(null);
  const [dayModalOpen, setDayModalOpen] = useState(false);
  useOpenAppointmentFromUrl(setEditing);
  // Visualização: calendário do mês ou lista filtrada por período
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [listFrom, setListFrom] = useState(format(new Date(), "yyyy-MM-dd"));
  const [listTo, setListTo] = useState(format(addDays(new Date(), 30), "yyyy-MM-dd"));
  const [order, setOrder] = useState<"asc" | "desc">("asc");

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const brokersQ = useBrokers({ enabled: mode === "team" });
  const allBrokerIds = useMemo(() => (brokersQ.data ?? []).map((p) => p.id), [brokersQ.data]);

  // período consultado: o mês visível (calendário) ou o filtro de datas (lista)
  const rangeFrom = view === "list" ? listFrom : format(gridStart, "yyyy-MM-dd");
  const rangeTo = view === "list" ? listTo : format(gridEnd, "yyyy-MM-dd");
  const apptsQ = useQuery({
    queryKey: ["team-appts", mode, profile?.id, rangeFrom, rangeTo, filterBrokers.join(",")],
    enabled: (mode === "team" || !!profile?.id) && !!rangeFrom && !!rangeTo,
    queryFn: async () => {
      let q = supabase.from("appointments").select("*")
        .gte("date", rangeFrom).lte("date", rangeTo);
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

  const listAppts = useMemo(() => {
    const sorted = [...filteredAppts].sort((a, b) =>
      `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`),
    );
    return order === "asc" ? sorted : sorted.reverse();
  }, [filteredAppts, order]);
  const listByDay = useMemo(() => {
    const groups: { date: string; items: any[] }[] = [];
    listAppts.forEach((a) => {
      const last = groups[groups.length - 1];
      if (last && last.date === a.date) last.items.push(a);
      else groups.push({ date: a.date, items: [a] });
    });
    return groups;
  }, [listAppts]);

  const numWeeks = days.length / 7;

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      <AppHeader title={title} />

      <div className="flex-1 min-h-0 flex flex-col px-4 pt-3 pb-nav gap-2">
        {/* Calendário ou lista */}
        <div className="flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        <div className="inline-flex self-start rounded-lg border border-border bg-white p-0.5 flex-shrink-0" role="tablist">
          {([
            ["calendar", "Calendário", CalendarDays],
            ["list", "Lista", List],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`h-9 px-3 rounded-md text-sm font-medium inline-flex items-center gap-1.5 ${
                view === key ? "bg-[var(--navy)] text-white" : "text-muted-foreground"
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* relatório de visitas: quem preencheu e, para o admin, o link para enviar aos corretores */}
            <>
                <Link
                  to="/relatorio-visitas"
                  className="h-10 px-3 rounded-lg bg-white border border-border text-[var(--navy)] text-sm font-semibold inline-flex items-center gap-1.5"
                >
                  <ClipboardList size={15} /> Relatório de visitas
                </Link>
                {mode === "team" && isSuperAdmin && (
                  <button
                    type="button"
                    onClick={() => setReportLinkOpen(true)}
                    className="h-10 px-3 rounded-lg bg-white border border-border text-[var(--navy)] text-sm font-semibold inline-flex items-center gap-1.5"
                  >
                    <Send size={15} /> Enviar link
                  </button>
                )}
            </>
            <button
              type="button"
              onClick={() => { setEditing("new"); setDayModalOpen(false); }}
              className="h-10 px-3 rounded-lg bg-[var(--gold)] text-[var(--navy)] text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <Plus size={15} strokeWidth={2.5} /> Novo agendamento
            </button>
          </div>
        </div>

        {view === "list" && (
          <div className="flex flex-wrap items-end gap-2 flex-shrink-0">
            <label className="block">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase block mb-0.5">De</span>
              <input type="date" value={listFrom} max={listTo} onChange={(e) => e.target.value && setListFrom(e.target.value)}
                className="h-10 px-2 rounded-lg bg-white border border-border text-sm" />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase block mb-0.5">Até</span>
              <input type="date" value={listTo} min={listFrom} onChange={(e) => e.target.value && setListTo(e.target.value)}
                className="h-10 px-2 rounded-lg bg-white border border-border text-sm" />
            </label>
            <button
              type="button"
              onClick={() => setOrder((o) => (o === "asc" ? "desc" : "asc"))}
              className="h-10 px-3 rounded-lg bg-white border border-border text-sm text-[var(--navy)] inline-flex items-center gap-1.5"
              title="Inverter a ordem"
            >
              {order === "asc" ? <ArrowUpNarrowWide size={15} /> : <ArrowDownWideNarrow size={15} />}
              {order === "asc" ? "Mais antigos primeiro" : "Mais novos primeiro"}
            </button>
          </div>
        )}

        {/* Month navigation */}
        {view === "calendar" && (
        <div className="flex items-center justify-between flex-shrink-0">
          <button onClick={() => setMonth(addDays(monthStart, -1))} className="p-2 rounded-lg bg-white border border-border"><ChevronLeft size={18} /></button>
          <p className="font-semibold text-[var(--navy)] capitalize">{format(month, "MMMM yyyy", { locale: ptBR })}</p>
          <button onClick={() => setMonth(addDays(monthEnd, 1))} className="p-2 rounded-lg bg-white border border-border"><ChevronRight size={18} /></button>
        </div>
        )}

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

        {view === "list" && (
          <div className="flex-1 min-h-0 overflow-y-auto -mx-4 px-4 pb-24 space-y-4">
            {apptsQ.isPending && <p className="text-sm text-muted-foreground text-center py-8">Carregando…</p>}
            {!apptsQ.isPending && listByDay.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-12">Nenhum agendamento nesse período.</p>
            )}
            {listByDay.map((g) => (
              <section key={g.date}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 capitalize">
                  {format(new Date(g.date + "T00:00:00"), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                </h3>
                <div className="space-y-2">
                  {[...g.items].sort((a, b) => order === "asc" ? a.start_time.localeCompare(b.start_time) : b.start_time.localeCompare(a.start_time)).map((a) => {
                    const broker = brokerForAppt(a);
                    return (
                      <button key={a.id} onClick={() => setEditing(a)} className="w-full text-left bg-white rounded-xl p-3 border border-border flex items-start gap-3">
                        {broker && <Avatar name={broker.full_name} color={broker.color} size={36} />}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[var(--navy)] truncate">{a.title}</p>
                          <p className="text-xs text-muted-foreground">{a.start_time.slice(0, 5)}–{a.end_time.slice(0, 5)}{broker ? ` · ${broker.full_name}` : ""}</p>
                          {a.client_name && <p className="text-xs text-muted-foreground">Cliente: {a.client_name}</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Calendar grid — fills all remaining space */}
        {view === "calendar" && (
        <div
          className="flex-1 min-h-0 grid grid-cols-7 gap-1"
          style={{ gridTemplateRows: `auto repeat(${numWeeks}, 1fr)` }}
        >
          {DAY_INITIALS.map((d, i) => (
            <div key={i} className="text-center text-xs font-semibold text-muted-foreground py-1">{d}</div>
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
        )}
      </div>

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
      {reportLinkOpen && <VisitReportLink onClose={() => setReportLinkOpen(false)} />}
    </div>
  );
}

/** Link geral do relatório de visitas, para o admin enviar aos corretores. */
function VisitReportLink({ onClose }: { onClose: () => void }) {
  const link = `${window.location.origin}/relatorio-visitas`;
  const message = `Pessoal, registrem aqui as visitas realizadas (ID do cliente, produto e observação). Elas entram direto no calendário de cada um:\n\n${link}`;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[var(--navy)]">Relatório de visitas</h3>
          <button onClick={onClose} className="text-muted-foreground" aria-label="Fechar"><X size={18} /></button>
        </div>
        <p className="text-sm text-muted-foreground">
          Um link só para todos. Cada corretor entra com o próprio login e informa o ID do cliente, o
          produto e a observação; a visita entra no calendário dele como realizada.
        </p>
        <p className="text-xs break-all rounded-lg bg-[var(--surface)] border border-border px-3 py-2 text-[var(--navy)]">{link}</p>
        <textarea readOnly value={message} rows={5} onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-xl border border-border bg-[var(--surface)] p-3 text-sm text-[var(--navy)] resize-none" />
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => { navigator.clipboard.writeText(link); toast.success("Link copiado!"); }}
            className="h-11 rounded-xl bg-white border border-border text-[var(--navy)] text-sm font-semibold inline-flex items-center justify-center gap-2"
          >
            <Copy size={15} /> Copiar link
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
            className="h-11 rounded-xl bg-green-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
          >
            <MessageCircle size={15} /> Enviar no WhatsApp
          </a>
        </div>
      </div>
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
