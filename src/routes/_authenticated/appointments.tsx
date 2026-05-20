import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, ExternalLink, AlertTriangle, Check } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";

export const Route = createFileRoute("/_authenticated/appointments")({
  component: AppointmentsPage,
});

type Appt = {
  id: string; owner_id: string; title: string; date: string;
  start_time: string; end_time: string; project_id: string | null;
  custom_location: string | null; description: string | null;
  client_name: string | null; client_email: string | null;
  client_id: string | null;
  type: "visit" | "meeting" | "call" | "follow-up";
  include_manager: boolean; google_calendar_link: string | null;
};

export function outlookCalendarLink(p: {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description?: string;
  location?: string;
  emails?: string[];
}) {
  const params = new URLSearchParams({
    subject: p.title,
    startdt: `${p.date}T${p.startTime}:00`,
    enddt: `${p.date}T${p.endTime}:00`,
  });
  if (p.description) params.set("body", p.description);
  if (p.location) params.set("location", p.location);
  const emails = (p.emails || []).filter(Boolean);
  if (emails.length) params.set("to", emails.join(","));
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

const typeLabels: Record<Appt["type"], string> = {
  visit: "visita",
  meeting: "reunião",
  call: "ligação",
  "follow-up": "follow-up",
};

function AppointmentsPage() {
  const { user } = useAuth();
  const [editing, setEditing] = useState<Appt | "new" | null>(null);
  const apptsQ = useQuery({
    queryKey: ["my-appts", user?.id],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { data, error } = await supabase.from("appointments").select("*")
        .eq("owner_id", user!.id).gte("date", today).order("date").order("start_time");
      if (error) throw error;
      return (data ?? []) as Appt[];
    },
    enabled: !!user,
  });
  return (
    <div className="pb-nav">
      <AppHeader title="Meus Agendamentos" />
      <div className="px-4 pt-4 space-y-2">
        {(apptsQ.data ?? []).length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">Nenhum agendamento futuro.</p>
        )}
        {(apptsQ.data ?? []).map((a) => (
          <button key={a.id} onClick={() => setEditing(a)} className="w-full text-left bg-white rounded-xl p-3 border border-border">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[var(--navy)] truncate">{a.title}</p>
                <p className="text-xs text-muted-foreground">{format(new Date(a.date + "T00:00:00"), "EEE, d 'de' MMM", { locale: ptBR })} · {a.start_time.slice(0,5)}–{a.end_time.slice(0,5)}</p>
                {a.client_name && <p className="text-xs text-muted-foreground mt-0.5">Cliente: {a.client_name}</p>}
              </div>
              <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded-full bg-[var(--gold)]/20 text-[var(--navy)] font-semibold">{typeLabels[a.type]}</span>
            </div>
          </button>
        ))}
      </div>
      <button onClick={() => setEditing("new")}
        className="fixed right-4 bottom-24 z-30 w-14 h-14 rounded-full bg-[var(--gold)] text-[var(--navy)] shadow-lg flex items-center justify-center" aria-label="Novo agendamento">
        <Plus size={28} strokeWidth={2.5} />
      </button>
      {editing && <AppointmentForm appt={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function AppointmentForm({ appt, onClose }: { appt: Appt | null; onClose: () => void }) {
  const { user, isAdmin, isDirector, profile } = useAuth();
  const qc = useQueryClient();
  const [type, setType] = useState<Appt["type"]>(appt?.type ?? "visit");
  const [date, setDate] = useState(appt?.date ?? format(new Date(), "yyyy-MM-dd"));
  const [startT, setStartT] = useState(appt?.start_time.slice(0, 5) ?? "10:00");
  const [endT, setEndT] = useState(appt?.end_time.slice(0, 5) ?? "11:00");
  const [projectId, setProjectId] = useState<string | "">(appt?.project_id ?? "");
  const [customLoc, setCustomLoc] = useState(appt?.custom_location ?? "");
  const [title, setTitle] = useState(appt?.title ?? "");
  const [clientName, setClientName] = useState(appt?.client_name ?? "");
  const [clientId, setClientId] = useState(appt?.client_id ?? "");
  const [clientEmail, setClientEmail] = useState(appt?.client_email ?? "");
  const [description, setDescription] = useState(appt?.description ?? "");
  const [includeManager, setIncludeManager] = useState(appt?.include_manager ?? false);
  const [savedLink, setSavedLink] = useState<string | null>(appt?.google_calendar_link ?? null);

  const isManager = isAdmin || isDirector;

  const projectsQ = useQuery({
    queryKey: ["projects-active"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id,name,address,city,is_active").eq("is_active", true).order("name");
      return data ?? [];
    },
  });
  const adminQ = useQuery({
    queryKey: ["admin-profile", profile?.manager_id],
    enabled: !!profile?.manager_id && !isManager,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id,full_name,email").eq("id", profile!.manager_id).limit(1).maybeSingle();
      return data;
    },
  });

  const selectedProject = useMemo(() => projectsQ.data?.find((p) => p.id === projectId), [projectsQ.data, projectId]);
  const showProjectLocation = !!selectedProject;
  const location = showProjectLocation ? `${selectedProject!.address}, ${selectedProject!.city}` : customLoc;

  useEffect(() => {
    if (selectedProject && (!appt || !title)) {
      setTitle(`Visita – ${selectedProject.name}`);
    }
  }, [selectedProject?.id]); // eslint-disable-line

  const conflictQ = useQuery({
    queryKey: ["mgr-conflict", adminQ.data?.id, date, startT, endT],
    enabled: includeManager && !!adminQ.data?.id,
    queryFn: async () => {
      const { data } = await supabase.from("appointments").select("id,title,start_time,end_time")
        .eq("owner_id", adminQ.data!.id).eq("date", date);
      const s = startT, e = endT;
      const conflict = (data ?? []).find((a) => {
        if (appt && a.id === appt.id) return false;
        return a.start_time < e && a.end_time > s;
      });
      return conflict || null;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const finalTitle = title || (selectedProject ? `Visita – ${selectedProject.name}` : "Agendamento");
      const link = outlookCalendarLink({
        title: finalTitle, date, startTime: startT, endTime: endT,
        description: description || undefined, location: location || undefined,
        emails: [clientEmail, includeManager ? adminQ.data?.email : undefined].filter((x): x is string => !!x),
      });
      const payload = {
        owner_id: user!.id, title: finalTitle, date, start_time: startT, end_time: endT,
        project_id: selectedProject?.id ?? null,
        custom_location: showProjectLocation ? null : (customLoc || null),
        description: description || null, client_name: clientName || null,
        client_email: clientEmail || null, client_id: clientId || null,
        type, include_manager: isManager ? false : includeManager,
        google_calendar_link: link,
      };
      if (appt) {
        const { error } = await supabase.from("appointments").update(payload).eq("id", appt.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("appointments").insert(payload);
        if (error) throw error;
      }
      return link;
    },
    onSuccess: (link) => {
      qc.invalidateQueries({ queryKey: ["my-appts"] });
      qc.invalidateQueries({ queryKey: ["team-appts"] });
      setSavedLink(link);
      toast.success("Agendamento salvo");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!appt) return;
      const { error } = await supabase.from("appointments").delete().eq("id", appt.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-appts"] });
      qc.invalidateQueries({ queryKey: ["team-appts"] });
      toast.success("Excluído");
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 overflow-y-auto" onClick={onClose}>
      <div className="bg-white w-full min-h-screen sm:min-h-0 sm:max-w-md sm:mx-auto sm:mt-8 sm:rounded-2xl p-5 safe-top safe-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--navy)]">{appt ? "Editar" : "Novo"} agendamento</h3>
          <button onClick={onClose} className="text-muted-foreground">Fechar</button>
        </div>
        <div className="space-y-3">
          <input className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border" placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input type="date" className="w-full h-12 px-3 rounded-xl bg-[var(--surface)] border border-border" value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <input type="time" className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border" value={startT} onChange={(e) => setStartT(e.target.value)} />
            <input type="time" className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border" value={endT} onChange={(e) => setEndT(e.target.value)} />
          </div>

          <select className="w-full h-12 px-3 rounded-xl bg-[var(--surface)] border border-border" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Selecione o imóvel… (opcional)</option>
            {(projectsQ.data ?? []).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>

          {showProjectLocation ? (
            <div className="px-4 py-3 rounded-xl bg-[var(--surface)] border border-border text-sm">
              <p className="text-xs text-muted-foreground">Local (do imóvel)</p>
              <p className="text-[var(--navy)]">{location}</p>
            </div>
          ) : (
            <input className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border" placeholder="Local" value={customLoc} onChange={(e) => setCustomLoc(e.target.value)} />
          )}

          <input className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border" placeholder="Nome do cliente" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <input className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border" placeholder="ID do cliente" value={clientId} onChange={(e) => setClientId(e.target.value)} />
            <input type="email" className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border" placeholder="E-mail do cliente" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} />
          </div>

          <textarea className="w-full px-4 py-3 rounded-xl bg-[var(--surface)] border border-border min-h-[80px]" placeholder="Descrição (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} />

          {!isManager && (
            <label className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--surface)] border border-border">
              <span className="text-sm font-medium text-[var(--navy)]">Incluir gestor{adminQ.data ? ` (${adminQ.data.full_name})` : ""}</span>
              <input type="checkbox" checked={includeManager} onChange={(e) => setIncludeManager(e.target.checked)} className="w-5 h-5 accent-[var(--gold)]" />
            </label>
          )}

          {!isManager && includeManager && (
            conflictQ.data ? (
              <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 px-3 py-2 text-sm flex gap-2">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                <span>O gestor tem um conflito: <b>{conflictQ.data.title}</b> ({conflictQ.data.start_time.slice(0,5)}–{conflictQ.data.end_time.slice(0,5)}). Incluir mesmo assim?</span>
              </div>
            ) : (
              <div className="rounded-xl bg-green-50 border border-green-200 text-green-800 px-3 py-2 text-sm flex gap-2">
                <Check size={16} className="flex-shrink-0 mt-0.5" /> O gestor está disponível neste horário
              </div>
            )
          )}

          {savedLink && (
            <div className="pt-2 border-t border-border">
              <a href={savedLink} target="_blank" rel="noreferrer" className="w-full h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-semibold flex items-center justify-center gap-2"><ExternalLink size={16} />Abrir no Outlook Calendar</a>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {appt && <button onClick={() => del.mutate()} className="h-12 px-4 rounded-xl bg-red-50 text-red-600 font-medium">Excluir</button>}
            <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">Cancelar</button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-60">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
