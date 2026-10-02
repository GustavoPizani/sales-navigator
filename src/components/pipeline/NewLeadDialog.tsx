import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  TEMPERATURAS,
  useActiveProjects,
  useCreateLead,
  type Funnel,
  type HierarchyMember,
} from "@/hooks/useLeads";

const inputCls = "w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm";

export function NewLeadDialog({
  funnel,
  members,
  onClose,
}: {
  funnel: Funnel;
  members: HierarchyMember[];
  onClose: () => void;
}) {
  const { profile } = useAuth();
  // Gestor atribui o lead a alguém abaixo dele no organograma; corretor cria para si.
  const isManager = profile?.role !== "broker";
  // Lead é sempre de um corretor (gerentes não atendem). O admin sem corretores
  // ainda pode ficar com o lead.
  const subordinates = members.filter((m) => m.id !== profile?.id && m.role === "broker");
  const isTeamManager = profile?.role === "master";
  const mustPickBroker = isManager && subordinates.length > 0;
  const blocked = isTeamManager && subordinates.length === 0;
  const navigate = useNavigate();
  const projectsQ = useActiveProjects();
  const createLead = useCreateLead();

  const [form, setForm] = useState({
    full_name: "",
    client_code: "",
    phone: "",
    email: "",
    temperatura: "",
    project_id: "",
    broker_id: mustPickBroker ? "" : (profile?.id ?? ""),
    stage_id: funnel.stages[0]?.id ?? "",
  });
  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) return toast.error("Informe o nome do lead.");
    if (!form.client_code.trim()) return toast.error("Informe o ID do cliente.");
    const phoneDigits = form.phone.replace(/D/g, "");
    if (form.phone.trim() && phoneDigits.length < 10)
      return toast.error("Telefone inválido: informe DDD + número.");
    if (blocked) return toast.error("Cadastre um corretor na sua equipe antes de criar leads.");
    if (mustPickBroker && !form.broker_id) return toast.error("Selecione o corretor responsável.");
    if (!form.stage_id) return toast.error("Este funil não tem etapas.");
    const created = await createLead.mutateAsync({
      full_name: form.full_name.trim(),
      client_code: form.client_code.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim().toLowerCase() || null,
      temperatura: form.temperatura || null,
      project_id: form.project_id || null,
      broker_id: form.broker_id || profile!.id,
      funnel_id: funnel.id,
      stage_id: form.stage_id,
      source: "manual",
    });
    onClose();
    navigate({ to: "/leads/$leadId", params: { leadId: created.id } });
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <h2 className="font-bold text-[var(--navy)] text-base">Novo lead</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-[var(--navy)] p-1"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-3">
          <input
            className={inputCls}
            placeholder="Nome completo *"
            value={form.full_name}
            onChange={set("full_name")}
            autoFocus
          />
          <input
            className={inputCls}
            placeholder="ID do cliente *"
            value={form.client_code}
            onChange={set("client_code")}
          />
          <input
            className={inputCls}
            placeholder="Telefone"
            type="tel"
            value={form.phone}
            onChange={set("phone")}
          />
          <input
            className={inputCls}
            placeholder="E-mail"
            type="email"
            value={form.email}
            onChange={set("email")}
          />
          <div className="grid grid-cols-2 gap-2">
            <select className={inputCls} value={form.stage_id} onChange={set("stage_id")}>
              {funnel.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select className={inputCls} value={form.temperatura} onChange={set("temperatura")}>
              <option value="">Temperatura</option>
              {TEMPERATURAS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <select className={inputCls} value={form.project_id} onChange={set("project_id")}>
            <option value="">Imóvel de interesse (opcional)</option>
            {(projectsQ.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {mustPickBroker && (
            <select className={inputCls} value={form.broker_id} onChange={set("broker_id")}>
              <option value="">Corretor responsável *</option>
              {subordinates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          )}
          {isManager && !mustPickBroker && (
            <p className="text-xs text-muted-foreground">
              {blocked
                ? "Sua equipe ainda não tem corretores. Cadastre um corretor na tela Time para criar leads."
                : "Nenhum corretor cadastrado ainda — o lead ficará com você."}
            </p>
          )}
        </div>
        <div className="p-5 pt-0 flex-shrink-0">
          <button
            type="submit"
            disabled={createLead.isPending || blocked}
            className="w-full h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold disabled:opacity-50"
          >
            {createLead.isPending ? "Salvando..." : "Criar lead"}
          </button>
        </div>
      </form>
    </div>
  );
}
