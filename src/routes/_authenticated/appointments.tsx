import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, ExternalLink, AlertTriangle, Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { AtendimentoForm } from "./dashboard";

export const Route = createFileRoute("/_authenticated/appointments")({
  component: AppointmentsPage,
});

export type Appt = {
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
  const { user, isAdmin, isDirector } = useAuth();
  const isManager = isAdmin || isDirector;
  const [editing, setEditing] = useState<Appt | "new" | null>(null);
  const [brokerFilter, setBrokerFilter] = useState<string>("all");

  const brokersQ = useQuery({
    queryKey: ["team-broker-profiles", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name")
        .eq("manager_id", user!.id).order("full_name");
      return (data ?? []) as { id: string; full_name: string }[];
    },
    enabled: !!user && isManager,
  });

  const apptsQ = useQuery({
    queryKey: ["my-appts", user?.id, isManager, brokerFilter],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      let q = supabase.from("appointments")
        .select("*, profiles!owner_id(full_name)")
        .gte("date", today).order("date").order("start_time");

      if (isManager) {
        const teamIds = (brokersQ.data ?? []).map((b) => b.id);
        const ids = brokerFilter !== "all" ? [brokerFilter] : [user!.id, ...teamIds];
        if (ids.length === 0) return [];
        q = q.in("owner_id", ids);
      } else {
        q = q.eq("owner_id", user!.id);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as (Appt & { profiles?: { full_name: string } | null })[];
    },
    enabled: !!user && (!isManager || brokersQ.isFetched),
  });

  return (
    <div className="pb-nav">
      <AppHeader title={isManager ? "Agendamentos da Equipe" : "Meus Agendamentos"} />

      {isManager && (brokersQ.data ?? []).length > 0 && (
        <div className="px-4 pt-3 pb-1">
          <select
            className="w-full h-10 px-3 rounded-xl bg-white border border-border text-sm text-[var(--navy)]"
            value={brokerFilter}
            onChange={(e) => setBrokerFilter(e.target.value)}
          >
            <option value="all">Todos da equipe</option>
            <option value={user!.id}>Meus agendamentos</option>
            {(brokersQ.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>{b.full_name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="px-4 pt-3 space-y-2">
        {apptsQ.isPending && [1,2,3,4].map(i => (
          <div key={i} className="bg-white rounded-xl p-3 border border-border space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </div>
        ))}
        {!apptsQ.isPending && (apptsQ.data ?? []).length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">Nenhum agendamento futuro.</p>
        )}
        {!apptsQ.isPending && (apptsQ.data ?? []).map((a) => (
          <button key={a.id} onClick={() => setEditing(a)} className="w-full text-left bg-white rounded-xl p-3 border border-border">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[var(--navy)] truncate">{a.title}</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(a.date + "T00:00:00"), "EEE, d 'de' MMM", { locale: ptBR })} · {a.start_time.slice(0,5)}–{a.end_time.slice(0,5)}
                </p>
                {a.client_name && <p className="text-xs text-muted-foreground mt-0.5">Cliente: {a.client_name}</p>}
                {isManager && a.profiles && (
                  <p className="text-xs text-[var(--gold)] font-medium mt-0.5">{(a.profiles as any).full_name}</p>
                )}
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

export function AppointmentForm({ appt, onClose, preFill }: { appt: Appt | null; onClose: () => void; preFill?: Partial<Appt> }) {
  const { user, isAdmin, isDirector, profile } = useAuth();
  const qc = useQueryClient();
  const isManager = isAdmin || isDirector;
  const isOwner = appt?.owner_id === user?.id;
  const readOnly = !!appt && !isOwner && !isManager;

  const [markingVisit, setMarkingVisit] = useState(false);

  const [type, setType] = useState<Appt["type"]>(appt?.type ?? "visit");
  const [date, setDate] = useState(appt?.date ?? format(new Date(), "yyyy-MM-dd"));
  const [startT, setStartT] = useState(appt?.start_time.slice(0, 5) ?? "10:00");
  const [endT, setEndT] = useState(appt?.end_time.slice(0, 5) ?? "11:00");
  const [projectId, setProjectId] = useState<string | "">(appt?.project_id ?? "");
  const [customLoc, setCustomLoc] = useState(appt?.custom_location ?? "");
  const [title, setTitle] = useState(appt?.title ?? "");
  const [clientName, setClientName] = useState(appt?.client_name ?? preFill?.client_name ?? "");
  const [clientId, setClientId] = useState(appt?.client_id ?? preFill?.client_id ?? "");
  const [clientEmail, setClientEmail] = useState(appt?.client_email ?? preFill?.client_email ?? "");
  const [description, setDescription] = useState(appt?.description ?? "");
  const [savedLink, setSavedLink] = useState<string | null>(appt?.google_calendar_link ?? null);

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
      const { data } = await supabase.from("profiles").select("id,full_name,email").eq("id", profile!.manager_id!).limit(1).maybeSingle();
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
    enabled: !isManager && !!adminQ.data?.id,
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
        emails: [clientEmail, !isManager ? adminQ.data?.email : undefined].filter((x): x is string => !!x),
      });
      const payload = {
        owner_id: appt?.owner_id ?? user!.id,
        title: finalTitle, date, start_time: startT, end_time: endT,
        project_id: selectedProject?.id ?? null,
        custom_location: showProjectLocation ? null : (customLoc || null),
        description: description || null, client_name: clientName || null,
        client_email: clientEmail || null, client_id: clientId || null,
        type,
        include_manager: appt ? appt.include_manager : !isManager,
        google_calendar_link: link,
      };
      if (appt) {
        const { data: updated, error } = await supabase.from("appointments").update(payload).eq("id", appt.id).select("id");
        console.log("[APPT UPDATE] id:", appt.id, "| rows returned:", updated, "| error:", error);
        if (error) throw error;
        if (!updated?.length) throw new Error(`Sem permissão para editar (RLS bloqueou). id=${appt.id}`);
      } else {
        const { error } = await supabase.from("appointments").insert(payload);
        if (error) throw error;
      }
      return link;
    },
    onSuccess: (link) => {
      qc.invalidateQueries({ queryKey: ["my-appts"] });
      qc.invalidateQueries({ queryKey: ["team-appts"] });
      if (!appt) {
        window.open(link, "_blank");
        toast.success("Agendamento criado!");
        onClose();
      } else {
        setSavedLink(link);
        toast.success("Agendamento salvo");
      }
    },
    onError: (e: any) => {
      console.error("[APPT SAVE ERROR]", e);
      toast.error(e.message);
    },
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!appt) return;
      const { data: deleted, error } = await supabase.from("appointments").delete().eq("id", appt.id).select("id");
      console.log("[APPT DELETE] id:", appt.id, "| rows returned:", deleted, "| error:", error);
      if (error) throw error;
      if (!deleted?.length) throw new Error(`Sem permissão para excluir (RLS bloqueou). id=${appt.id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-appts"] });
      qc.invalidateQueries({ queryKey: ["team-appts"] });
      toast.success("Excluído");
      onClose();
    },
    onError: (e: any) => {
      console.error("[APPT DELETE ERROR]", e);
      toast.error(e.message);
    },
  });

  if (markingVisit && appt) {
    return (
      <AtendimentoForm 
        userId={user!.id} 
        onClose={onClose} 
        preFill={{
            appointment_id: appt.id,
            nome_cliente: appt.client_name || "",
            email: appt.client_email || "",
            id_cliente: appt.client_id || "",
            broker_id: appt.owner_id,
            produto: selectedProject?.name || "",
        }} 
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 overflow-y-auto" onClick={onClose}>
      <div className="bg-white w-full min-h-screen sm:min-h-0 sm:max-w-md sm:mx-auto sm:mt-8 sm:rounded-2xl p-5 safe-top safe-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--navy)]">{!appt ? "Novo agendamento" : readOnly ? "Visualizar Agendamento" : "Editar agendamento"}</h3>
          <button onClick={onClose} className="text-muted-foreground">Fechar</button>
        </div>
        <div className="space-y-3">
          <input disabled={readOnly} className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border disabled:opacity-60 disabled:cursor-not-allowed" placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input disabled={readOnly} type="date" className="w-full h-12 px-3 rounded-xl bg-[var(--surface)] border border-border disabled:opacity-60 disabled:cursor-not-allowed" value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <input disabled={readOnly} type="time" className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border disabled:opacity-60 disabled:cursor-not-allowed" value={startT} onChange={(e) => setStartT(e.target.value)} />
            <input disabled={readOnly} type="time" className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border disabled:opacity-60 disabled:cursor-not-allowed" value={endT} onChange={(e) => setEndT(e.target.value)} />
          </div>

          <select disabled={readOnly} className="w-full h-12 px-3 rounded-xl bg-[var(--surface)] border border-border disabled:opacity-60 disabled:cursor-not-allowed" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Selecione o imóvel… (opcional)</option>
            {(projectsQ.data ?? []).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>

          {showProjectLocation ? (
            <div className={`px-4 py-3 rounded-xl bg-[var(--surface)] border border-border text-sm ${readOnly ? "opacity-60" : ""}`}>
              <p className="text-xs text-muted-foreground">Local (do imóvel)</p>
              <p className="text-[var(--navy)]">{location}</p>
            </div>
          ) : (
            <input disabled={readOnly} className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border disabled:opacity-60 disabled:cursor-not-allowed" placeholder="Local" value={customLoc} onChange={(e) => setCustomLoc(e.target.value)} />
          )}

          <input disabled={readOnly} className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border disabled:opacity-60 disabled:cursor-not-allowed" placeholder="Nome do cliente" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <input disabled={readOnly} className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border disabled:opacity-60 disabled:cursor-not-allowed" placeholder="ID do cliente" value={clientId} onChange={(e) => setClientId(e.target.value)} />
            <input disabled={readOnly} type="email" className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border disabled:opacity-60 disabled:cursor-not-allowed" placeholder="E-mail do cliente" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} />
          </div>

          <textarea disabled={readOnly} className="w-full px-4 py-3 rounded-xl bg-[var(--surface)] border border-border min-h-[80px] disabled:opacity-60 disabled:cursor-not-allowed" placeholder="Descrição (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} />

          {!isManager && adminQ.data && (
            conflictQ.data ? (
              <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 px-3 py-2 text-sm flex gap-2">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                <span>O gestor possui um conflito: <b>{conflictQ.data.title}</b> ({conflictQ.data.start_time.slice(0,5)}–{conflictQ.data.end_time.slice(0,5)}). O convite será enviado mesmo assim.</span>
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

          {appt && !readOnly && (
            <button 
              type="button"
              onClick={() => setMarkingVisit(true)}
              className="w-full h-12 rounded-xl bg-green-50 border border-green-200 text-green-700 font-bold mb-2 flex items-center justify-center gap-2"
            >
              <Check size={18} /> Marcar como visita realizada
            </button>
          )}

          <div className="flex gap-2 pt-2 border-t border-border">
            {appt && !readOnly && <button onClick={() => del.mutate()} className="h-12 px-4 rounded-xl bg-red-50 text-red-600 font-medium">Excluir</button>}
            <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">
              {readOnly ? "Fechar" : "Cancelar"}
            </button>
            {!readOnly && (
              <button onClick={() => save.mutate()} disabled={save.isPending} className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-60">Salvar</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
