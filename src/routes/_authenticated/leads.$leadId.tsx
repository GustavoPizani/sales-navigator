import { createFileRoute, Link } from "@tanstack/react-router";
import { RequireModule } from "@/components/RequireModule";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Building2,
  Hash,
  CalendarPlus,
  Check,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  RotateCcw,
  Thermometer,
  Trash2,
  Trophy,
  User,
  X,
  XCircle,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { LeadBadges } from "@/components/pipeline/LeadCard";
import { AppointmentForm, type Appt } from "./appointments";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  LEAD_SELECT,
  TEMPERATURAS,
  initials,
  useFunnels,
  useActiveProjects,
  useIsCrmGlobal,
  useUpdateLead,
  whatsappUrl,
  type Lead,
} from "@/hooks/useLeads";

export const Route = createFileRoute("/_authenticated/leads/$leadId")({
  component: LeadPageGuarded,
});

// Rota bloqueada pela matriz de permissões do cargo.
function LeadPageGuarded() {
  return (
    <RequireModule modules={["leads"]}>
      <LeadPage />
    </RequireModule>
  );
}

const brl = (v: number | null | undefined) =>
  v == null ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const inputCls = "w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm";
const cardCls = "bg-white rounded-2xl border border-border p-4";

function LeadPage() {
  const { leadId } = Route.useParams();
  const { profile, can } = useAuth();
  // "Somente visualização" em Atendimentos: sem trocar etapa, situação nem anotar
  const canEdit = can("leads", "edit");
  const canSchedule = can("appointments", "edit");
  // Somente o admin altera nome, telefone, e-mail e ID do cliente (trava também no banco).
  const canEditPersonalData = profile?.role === "admin";
  const updateLead = useUpdateLead();
  const funnelsQ = useFunnels();
  const projectsQ = useActiveProjects();

  const [editing, setEditing] = useState(false);
  const [markingWon, setMarkingWon] = useState(false);
  const [markingLost, setMarkingLost] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [openAppt, setOpenAppt] = useState<Appt | null>(null);

  const leadQ = useQuery({
    queryKey: ["lead", leadId],
    queryFn: async (): Promise<Lead | null> => {
      const { data, error } = await supabase
        .from("leads")
        .select(LEAD_SELECT)
        .eq("id", leadId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Lead | null;
    },
  });

  const apptsQ = useQuery({
    queryKey: ["lead-appts", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("*")
        .eq("lead_id", leadId)
        .order("date", { ascending: false })
        .order("start_time", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Appt[];
    },
  });

  const lead = leadQ.data;
  const funnel = funnelsQ.data?.find((f) => f.id === lead?.funnel_id);
  const stage = funnel?.stages.find((s) => s.id === lead?.stage_id);
  const update = (patch: Parameters<typeof updateLead.mutate>[0]["patch"]) =>
    updateLead.mutate({ id: leadId, patch });

  if (leadQ.isLoading) {
    return (
      <div className="pb-nav">
        <AppHeader title="Lead" left={<BackLink />} />
        <div className="p-8 text-center text-muted-foreground">Carregando…</div>
      </div>
    );
  }
  if (!lead) {
    return (
      <div className="pb-nav">
        <AppHeader title="Lead" left={<BackLink />} />
        <div className="p-8 text-center text-muted-foreground">
          {leadQ.error
            ? `Erro: ${(leadQ.error as any).message}`
            : "Lead não encontrado ou sem permissão de acesso."}
        </div>
      </div>
    );
  }

  return (
    <div className="pb-nav">
      <AppHeader title="Lead" left={<BackLink />} />

      <div className="px-4 pt-4 max-w-5xl mx-auto grid gap-3 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-3 min-w-0">
          {/* Cabeçalho */}
          <div className={cardCls}>
            <div className="flex items-start gap-3">
              <div
                className="h-12 w-12 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold text-white"
                style={{ background: "linear-gradient(135deg, var(--gold), var(--gold-dark))" }}
              >
                {initials(lead.full_name)}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-[var(--navy)] leading-tight break-words">
                  {lead.full_name}
                </h2>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {stage && (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
                      style={{ backgroundColor: stage.color }}
                    >
                      {stage.name}
                    </span>
                  )}
                  <LeadBadges lead={lead} />
                </div>
              </div>
              {canEditPersonalData && (
                <button
                  onClick={() => setEditing(true)}
                  className="p-2 rounded-lg text-muted-foreground hover:text-[var(--navy)] hover:bg-[var(--surface)]"
                  aria-label="Editar dados"
                >
                  <Pencil size={18} />
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
              {lead.phone ? (
                <a
                  href={whatsappUrl(lead.phone)}
                  target="_blank"
                  rel="noreferrer"
                  className="h-11 rounded-xl bg-green-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
                >
                  <MessageCircle size={16} /> WhatsApp
                </a>
              ) : (
                <button
                  disabled
                  className="h-11 rounded-xl bg-[var(--surface)] text-muted-foreground text-sm font-semibold inline-flex items-center justify-center gap-2"
                >
                  <MessageCircle size={16} /> Sem telefone
                </button>
              )}
              <button
                onClick={() => setScheduling(true)}
                disabled={!canSchedule}
                className="h-11 rounded-xl bg-[var(--navy)] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <CalendarPlus size={16} /> Agendar visita
              </button>
            </div>
          </div>

          {/* Etapa do funil */}
          {funnel && (
            <div className={cardCls}>
              <h3 className="text-sm font-semibold text-[var(--navy)] mb-3">Etapa do funil</h3>
              <div className="flex gap-1 mb-3" aria-hidden>
                {funnel.stages.map((s) => {
                  const reached = s.sort_order <= (stage?.sort_order ?? -1);
                  return (
                    <div
                      key={s.id}
                      className="h-1.5 flex-1 rounded-full"
                      style={{ backgroundColor: reached ? s.color : "#E5E7EB" }}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {funnel.stages.map((s) => {
                  const active = s.id === lead.stage_id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => !active && update({ stage_id: s.id })}
                      className={`h-8 px-3 rounded-full text-xs font-semibold border transition-colors ${active ? "text-white border-transparent" : "bg-white text-muted-foreground border-border hover:text-[var(--navy)]"}`}
                      style={active ? { backgroundColor: s.color } : undefined}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>

              <div
                className={`grid grid-cols-2 gap-2 mt-4 ${canEdit ? "" : "pointer-events-none opacity-60"}`}
              >
                {lead.status === "active" ? (
                  <>
                    <button
                      onClick={() => setMarkingWon(true)}
                      className="h-10 rounded-xl bg-green-50 text-green-700 border border-green-200 text-sm font-semibold inline-flex items-center justify-center gap-1.5"
                    >
                      <Trophy size={15} /> Ganho
                    </button>
                    <button
                      onClick={() => setMarkingLost(true)}
                      className="h-10 rounded-xl bg-red-50 text-red-700 border border-red-200 text-sm font-semibold inline-flex items-center justify-center gap-1.5"
                    >
                      <XCircle size={15} /> Perdido
                    </button>
                  </>
                ) : (
                  <>
                    <div className="text-xs text-muted-foreground self-center">
                      {lead.status === "won"
                        ? `Ganho${lead.won_at ? ` em ${format(new Date(lead.won_at), "dd/MM/yyyy")}` : ""}${lead.won_value ? ` · ${brl(lead.won_value)}` : ""}`
                        : `Perdido${lead.lost_at ? ` em ${format(new Date(lead.lost_at), "dd/MM/yyyy")}` : ""}${lead.lost_reason ? ` · ${lead.lost_reason}` : ""}`}
                    </div>
                    <button
                      onClick={() =>
                        update({
                          status: "active",
                          won_at: null,
                          won_value: null,
                          lost_at: null,
                          lost_reason: null,
                        })
                      }
                      className="h-10 rounded-xl bg-[var(--surface)] text-[var(--navy)] border border-border text-sm font-semibold inline-flex items-center justify-center gap-1.5"
                    >
                      <RotateCcw size={15} /> Reabrir
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <NotesSection leadId={lead.id} readOnly={!canEdit} />
        </div>

        <div className="space-y-3 min-w-0">
          {/* Informações */}
          <div className={cardCls}>
            <h3 className="text-sm font-semibold text-[var(--navy)] mb-3">Informações</h3>
            <dl className="space-y-3 text-sm">
              <InfoRow icon={Hash} label="ID do cliente">
                {lead.client_code || "—"}
              </InfoRow>
              <InfoRow icon={Phone} label="Telefone">
                {lead.phone || "—"}
              </InfoRow>
              <InfoRow icon={Mail} label="E-mail">
                <span className="break-all">{lead.email || "—"}</span>
              </InfoRow>
              <InfoRow icon={Thermometer} label="Temperatura">
                <select
                  className="h-9 px-2 rounded-lg border border-border bg-white text-sm w-full"
                  value={lead.temperatura ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => update({ temperatura: e.target.value || null })}
                >
                  <option value="">Não definida</option>
                  {TEMPERATURAS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </InfoRow>
              <InfoRow icon={Building2} label="Imóvel de interesse">
                <select
                  className="h-9 px-2 rounded-lg border border-border bg-white text-sm w-full"
                  value={lead.project_id ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => update({ project_id: e.target.value || null })}
                >
                  <option value="">Nenhum</option>
                  {/* mantém o imóvel atual visível mesmo se ele foi desativado */}
                  {lead.project &&
                    !(projectsQ.data ?? []).some((p) => p.id === lead.project!.id) && (
                      <option value={lead.project.id}>{lead.project.name}</option>
                    )}
                  {(projectsQ.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </InfoRow>
              <InfoRow icon={User} label="Corretor">
                {lead.broker?.full_name ?? "—"}
              </InfoRow>
            </dl>
            <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>
                Origem<div className="text-[var(--navy)] font-medium capitalize">{lead.source}</div>
              </div>
              <div>
                Criado em
                <div className="text-[var(--navy)] font-medium">
                  {format(new Date(lead.created_at), "dd/MM/yyyy HH:mm")}
                </div>
              </div>
              {lead.campaign && (
                <div className="col-span-2">
                  Campanha
                  <div className="text-[var(--navy)] font-medium break-words">{lead.campaign}</div>
                </div>
              )}
            </div>
            <FormResponses data={lead.form_responses} />
          </div>

          {/* Agendamentos */}
          <div className={cardCls}>
            <h3 className="text-sm font-semibold text-[var(--navy)] mb-2">Agendamentos</h3>
            {(apptsQ.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum agendamento para este lead.</p>
            ) : (
              <ul className="divide-y divide-border">
                {(apptsQ.data ?? []).map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setOpenAppt(a)}
                      className="w-full text-left py-2 text-sm hover:bg-[var(--surface)] rounded-lg px-1 -mx-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-[var(--navy)]">{a.title}</span>
                        {a.visit_status === "done" && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 whitespace-nowrap">
                            Realizada
                          </span>
                        )}
                        {a.visit_status === "not_done" && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">
                            Não realizada
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(`${a.date}T00:00:00`), "EEE, dd/MM/yyyy", {
                          locale: ptBR,
                        })}{" "}
                        · {a.start_time.slice(0, 5)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {editing && <EditLeadDialog lead={lead} onClose={() => setEditing(false)} />}
      {markingWon && (
        <PromptDialog
          title="Marcar como ganho"
          label="Valor da venda (opcional)"
          inputType="number"
          confirmLabel="Confirmar ganho"
          onClose={() => setMarkingWon(false)}
          onConfirm={(v) =>
            update({
              status: "won",
              won_value: v ? Number(v) : null,
              lost_at: null,
              lost_reason: null,
            })
          }
        />
      )}
      {markingLost && (
        <PromptDialog
          title="Marcar como perdido"
          label="Motivo da perda"
          confirmLabel="Confirmar perda"
          onClose={() => setMarkingLost(false)}
          onConfirm={(v) =>
            update({ status: "lost", lost_reason: v || null, won_at: null, won_value: null })
          }
        />
      )}
      {openAppt && (
        <AppointmentForm
          appt={openAppt}
          onClose={() => {
            setOpenAppt(null);
            apptsQ.refetch();
          }}
        />
      )}
      {scheduling && (
        <AppointmentForm
          appt={null}
          preFill={{
            client_name: lead.full_name,
            client_email: lead.email,
            client_id: lead.client_code,
            lead_id: lead.id,
            project_id: lead.project_id,
          }}
          onClose={() => {
            setScheduling(false);
            apptsQ.refetch();
          }}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/dashboard"
      className="p-1 -ml-1 text-white/80 hover:text-white"
      aria-label="Voltar aos atendimentos"
    >
      <ArrowLeft size={20} />
    </Link>
  );
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon size={16} className="text-[var(--gold)] mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-[var(--navy)] mt-0.5">{children}</dd>
      </div>
    </div>
  );
}

function FormResponses({ data }: { data: unknown }) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const entries = Object.entries(data as Record<string, unknown>).filter(
    ([, v]) => v != null && v !== "",
  );
  if (!entries.length) return null;
  return (
    <div className="mt-4 pt-3 border-t border-border">
      <div className="text-xs font-semibold text-muted-foreground mb-2">
        Respostas do formulário
      </div>
      <dl className="space-y-1.5 text-xs">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted-foreground">{k.replace(/_/g, " ")}</dt>
            <dd className="text-[var(--navy)] font-medium break-words">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── Anotações ────────────────────────────────────────────────────────────────
type Note = {
  id: string;
  content: string;
  kind: string;
  created_at: string;
  author_id: string | null;
  author: { full_name: string } | null;
};

function NotesSection({ leadId, readOnly = false }: { leadId: string; readOnly?: boolean }) {
  const { profile } = useAuth();
  const isGlobal = useIsCrmGlobal();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const notesQ = useQuery({
    queryKey: ["lead-notes", leadId],
    queryFn: async (): Promise<Note[]> => {
      const { data, error } = await supabase
        .from("lead_notes")
        .select(
          "id,content,kind,created_at,author_id,author:profiles!lead_notes_author_id_fkey(full_name)",
        )
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Note[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["lead-notes", leadId] });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("lead_notes")
        .insert({ lead_id: leadId, author_id: profile!.id, content: text.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setText("");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const { error } = await supabase.from("lead_notes").update({ content }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("lead_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className={cardCls}>
      <h3 className="text-sm font-semibold text-[var(--navy)] mb-3">Anotações</h3>
      {!readOnly && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) add.mutate();
          }}
          className="space-y-2"
        >
          <textarea
            className="w-full min-h-[80px] p-3 rounded-xl bg-[var(--surface)] border border-border text-sm resize-y"
            placeholder="Escreva uma anotação…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!text.trim() || add.isPending}
              className="h-9 px-4 rounded-lg bg-[var(--gold)] text-[var(--navy)] font-bold text-sm disabled:opacity-50"
            >
              {add.isPending ? "Salvando…" : "Adicionar"}
            </button>
          </div>
        </form>
      )}

      <ul className="mt-4 space-y-3">
        {(notesQ.data ?? []).length === 0 && !notesQ.isLoading && (
          <li className="text-xs text-muted-foreground text-center py-4">
            Nenhuma anotação ainda.
          </li>
        )}
        {(notesQ.data ?? []).map((n) => {
          const isSystem = n.kind === "system";
          const canEdit = !readOnly && !isSystem && n.author_id === profile?.id;
          const canDelete = !readOnly && (canEdit || isGlobal);
          const when = format(new Date(n.created_at), "dd/MM/yyyy HH:mm");
          if (isSystem) {
            return (
              <li key={n.id} className="text-xs text-muted-foreground flex items-start gap-2 px-1">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[var(--gold)] flex-shrink-0" />
                <span className="flex-1">
                  {n.content}{" "}
                  <span className="whitespace-nowrap">
                    · {n.author?.full_name ?? "Sistema"} · {when}
                  </span>
                </span>
              </li>
            );
          }
          return (
            <li key={n.id} className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-semibold text-[var(--navy)]">
                  {n.author?.full_name ?? "—"}
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-muted-foreground">{when}</span>
                  {canEdit && editingId !== n.id && (
                    <button
                      onClick={() => {
                        setEditingId(n.id);
                        setEditText(n.content);
                      }}
                      className="p-1 text-muted-foreground hover:text-[var(--navy)]"
                      aria-label="Editar anotação"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {canDelete && editingId !== n.id && (
                    <button
                      onClick={() => {
                        if (confirm("Excluir esta anotação?")) remove.mutate(n.id);
                      }}
                      className="p-1 text-muted-foreground hover:text-red-600"
                      aria-label="Excluir anotação"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
              {editingId === n.id ? (
                <div className="space-y-2">
                  <textarea
                    className="w-full min-h-[70px] p-2 rounded-lg bg-[var(--surface)] border border-border text-sm"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:bg-[var(--surface)]"
                      aria-label="Cancelar"
                    >
                      <X size={16} />
                    </button>
                    <button
                      onClick={() =>
                        editText.trim() && save.mutate({ id: n.id, content: editText.trim() })
                      }
                      className="p-1.5 rounded-lg text-green-700 hover:bg-green-50"
                      aria-label="Salvar"
                    >
                      <Check size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[var(--navy)] whitespace-pre-wrap break-words">
                  {n.content}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Diálogos ─────────────────────────────────────────────────────────────────
function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <h2 className="font-bold text-[var(--navy)] text-base">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-[var(--navy)] p-1"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-5">{children}</div>
      </div>
    </div>
  );
}

function EditLeadDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const updateLead = useUpdateLead();
  const [form, setForm] = useState({
    full_name: lead.full_name,
    client_code: lead.client_code ?? "",
    phone: lead.phone ?? "",
    email: lead.email ?? "",
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) return toast.error("Informe o nome.");
    updateLead.mutate(
      {
        id: lead.id,
        patch: {
          full_name: form.full_name.trim(),
          client_code: form.client_code.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim().toLowerCase() || null,
        },
      },
      { onSuccess: onClose },
    );
  };
  return (
    <Sheet title="Editar dados" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <input
          className={inputCls}
          placeholder="Nome completo"
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
        />
        <input
          className={inputCls}
          placeholder="ID do cliente"
          value={form.client_code}
          onChange={(e) => setForm({ ...form, client_code: e.target.value })}
        />
        <input
          className={inputCls}
          placeholder="Telefone"
          type="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        <input
          className={inputCls}
          placeholder="E-mail"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <button
          type="submit"
          disabled={updateLead.isPending}
          className="w-full h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold disabled:opacity-50"
        >
          Salvar
        </button>
      </form>
    </Sheet>
  );
}

function PromptDialog({
  title,
  label,
  confirmLabel,
  inputType = "text",
  onConfirm,
  onClose,
}: {
  title: string;
  label: string;
  confirmLabel: string;
  inputType?: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(value.trim());
          onClose();
        }}
        className="space-y-3"
      >
        <label className="text-xs font-medium text-muted-foreground block">{label}</label>
        {inputType === "number" ? (
          <input
            className={inputCls}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        ) : (
          <textarea
            className="w-full min-h-[90px] p-3 rounded-xl bg-[var(--surface)] border border-border text-sm"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        )}
        <button
          type="submit"
          className="w-full h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold"
        >
          {confirmLabel}
        </button>
      </form>
    </Sheet>
  );
}
