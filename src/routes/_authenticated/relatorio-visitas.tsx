import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import { CalendarCheck, Check, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { RequireModule } from "@/components/RequireModule";

// Relatório de visitas realizadas: link geral que o admin envia aos corretores.
// Cada visita informada entra no calendário de quem preencheu, já como realizada.
export const Route = createFileRoute("/_authenticated/relatorio-visitas")({
  component: VisitReportByRole,
});

// Corretor preenche as próprias visitas; ADM e gerente só acompanham quem
// preencheu e quando (não registram visita).
function VisitReportByRole() {
  const { profile } = useAuth();
  if (profile?.role === "broker")
    return (
      <RequireModule modules={["appointments"]} min="edit">
        <VisitReportPage />
      </RequireModule>
    );
  return (
    <RequireModule modules={["appointments"]}>
      <VisitReportList />
    </RequireModule>
  );
}

type ReportRow = {
  id: string;
  owner_id: string;
  date: string;
  start_time: string;
  client_id: string | null;
  client_name: string | null;
  title: string;
  description: string | null;
  reported_at: string;
  lead_id: string | null;
  profiles: { full_name: string } | null;
};

function VisitReportList() {
  const [from, setFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [broker, setBroker] = useState("all");

  const q = useQuery({
    queryKey: ["visit-reports", from, to],
    enabled: !!from && !!to,
    queryFn: async () => {
      // (reported_at ainda não está nos tipos gerados do Supabase)
      const { data, error } = await (supabase as any)
        .from("appointments")
        .select(
          "id,owner_id,date,start_time,client_id,client_name,title,description,reported_at,lead_id, profiles!owner_id(full_name)",
        )
        .not("reported_at", "is", null)
        .gte("date", from)
        .lte("date", to)
        .order("reported_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReportRow[];
    },
  });

  const rows = q.data ?? [];
  const brokers = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => m.set(r.owner_id, r.profiles?.full_name ?? "—"));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const shown = broker === "all" ? rows : rows.filter((r) => r.owner_id === broker);
  const inputCls = "h-10 px-3 rounded-lg bg-white border border-border text-sm";

  return (
    <div className="pb-nav">
      <AppHeader title="Relatório de visitas" />
      <div className="px-4 pt-4 max-w-5xl mx-auto space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase block mb-0.5">Visitas de</span>
            <input type="date" className={inputCls} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase block mb-0.5">Até</span>
            <input type="date" className={inputCls} value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase block mb-0.5">Corretor</span>
            <select className={inputCls} value={broker} onChange={(e) => setBroker(e.target.value)}>
              <option value="all">Todos</option>
              {brokers.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <span className="text-sm text-muted-foreground pb-2">
            {shown.length} visita{shown.length === 1 ? "" : "s"} relatada{shown.length === 1 ? "" : "s"}
          </span>
        </div>

        {q.isPending && <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>}
        {q.isError && (
          <p className="text-sm text-red-600 py-6 text-center">{(q.error as Error).message}</p>
        )}
        {!q.isPending && !q.isError && shown.length === 0 && (
          <p className="text-sm text-muted-foreground py-10 text-center">
            Nenhuma visita relatada nesse período.
          </p>
        )}

        {shown.length > 0 && (
          <div className="bg-white rounded-2xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface)] text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Quem preencheu</th>
                  <th className="text-left px-3 py-2 font-semibold">Preenchido em</th>
                  <th className="text-left px-3 py-2 font-semibold">Visita</th>
                  <th className="text-left px-3 py-2 font-semibold">Cliente</th>
                  <th className="text-left px-3 py-2 font-semibold">Produto</th>
                  <th className="text-left px-3 py-2 font-semibold">Observação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2 font-medium text-[var(--navy)] whitespace-nowrap">
                      {r.profiles?.full_name ?? "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {format(new Date(r.reported_at), "dd/MM/yyyy HH:mm")}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {format(new Date(r.date + "T00:00:00"), "dd/MM/yyyy")} · {r.start_time.slice(0, 5)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-[var(--navy)]">ID {r.client_id}</span>
                      {r.client_name && <span className="block text-xs text-muted-foreground">{r.client_name}</span>}
                      {!r.lead_id && (
                        <span className="block text-[11px] text-amber-700">sem cliente cadastrado</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{r.title.replace("Visita realizada — ", "")}</td>
                    <td className="px-3 py-2 text-muted-foreground min-w-[14rem]">{r.description || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

type Reported = {
  id: string;
  date: string;
  start_time: string;
  client_id: string | null;
  client_name: string | null;
  title: string;
};

function VisitReportPage() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const [code, setCode] = useState("");
  const [projectId, setProjectId] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState(format(new Date(), "HH:mm"));
  const [last, setLast] = useState<{ linked: boolean; lead_name: string | null; produto: string } | null>(null);

  const projectsQ = useQuery({
    queryKey: ["projects-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  // últimas visitas que eu relatei
  const mineQ = useQuery({
    queryKey: ["my-reported-visits", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // (reported_at ainda não está nos tipos gerados do Supabase)
      const { data, error } = await (supabase as any)
        .from("appointments")
        .select("id,date,start_time,client_id,client_name,title")
        .eq("owner_id", user!.id)
        .not("reported_at", "is", null)
        .order("date", { ascending: false })
        .order("start_time", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as Reported[];
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      // (RPC ainda não está nos tipos gerados do Supabase)
      const { data, error } = await (supabase as any).rpc("crm_report_visit", {
        p_client_code: code.trim(),
        p_project_id: projectId,
        p_note: note.trim() || null,
        p_date: date,
        p_time: time,
      });
      if (error) throw error;
      return data as { linked: boolean; lead_name: string | null; produto: string };
    },
    onSuccess: (r) => {
      setLast(r);
      setCode("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["my-reported-visits"] });
      qc.invalidateQueries({ queryKey: ["team-appts"] });
      qc.invalidateQueries({ queryKey: ["my-appts"] });
      toast.success("Visita registrada no seu calendário.");
    },
    onError: (e: any) => toast.error(e.message || "Não foi possível registrar a visita."),
  });

  const INPUT = "w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm";
  const LABEL = "text-xs font-semibold text-[var(--navy)] mb-1 block";

  return (
    <div className="pb-nav">
      <AppHeader title="Relatório de visitas" />
      <div className="px-4 pt-4 max-w-xl mx-auto space-y-4">
        <div className="bg-white rounded-2xl border border-border p-4">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-[var(--gold)]/15 text-[var(--gold-dark)] flex items-center justify-center flex-shrink-0">
              <CalendarCheck size={20} />
            </div>
            <div>
              <h2 className="font-bold text-[var(--navy)]">Visitas realizadas</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {profile?.full_name?.split(" ")[0]}, informe cada visita que você fez. Ela entra no seu
                calendário automaticamente.
              </p>
            </div>
          </div>

          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            <div>
              <label className={LABEL}>ID do cliente</label>
              <input
                className={INPUT}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Ex: 123456"
                autoCapitalize="characters"
                required
              />
            </div>
            <div>
              <label className={LABEL}>Produto da visita</label>
              <select className={INPUT} value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
                <option value="">Selecione o produto…</option>
                {(projectsQ.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>Observação do cliente</label>
              <textarea
                className="w-full rounded-xl bg-[var(--surface)] border border-border text-sm p-3 min-h-24"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Como foi a visita, o que o cliente achou, próximos passos…"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Data da visita</label>
                <input type="date" className={INPUT} value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
              </div>
              <div>
                <label className={LABEL}>Horário</label>
                <input type="time" className={INPUT} value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />
              </div>
            </div>
            <button
              type="submit"
              disabled={submit.isPending || !code.trim() || !projectId}
              className="w-full h-12 rounded-xl bg-[var(--navy)] text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submit.isPending ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
              {submit.isPending ? "Registrando…" : "Registrar visita"}
            </button>
          </form>

          {last && (
            <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <p className="font-semibold">Visita ao {last.produto} registrada.</p>
              <p className="text-xs mt-0.5">
                {last.linked
                  ? `Vinculada ao seu cliente ${last.lead_name}, que foi para "Visita realizada".`
                  : "Esse ID não está entre os seus clientes cadastrados: a visita ficou só no calendário."}
              </p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-[var(--navy)]">Últimas visitas relatadas</h3>
            <Link to="/appointments" className="text-xs font-semibold text-[var(--gold-dark)]">
              Ver calendário
            </Link>
          </div>
          {(mineQ.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">Nenhuma visita relatada ainda.</p>
          ) : (
            <ul className="divide-y divide-border">
              {(mineQ.data ?? []).map((v) => (
                <li key={v.id} className="py-2 text-sm">
                  <p className="font-medium text-[var(--navy)] truncate">{v.title.replace("Visita realizada — ", "")}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(v.date + "T00:00:00"), "dd/MM/yyyy")} · {v.start_time.slice(0, 5)} · ID {v.client_id}
                    {v.client_name ? ` · ${v.client_name}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
