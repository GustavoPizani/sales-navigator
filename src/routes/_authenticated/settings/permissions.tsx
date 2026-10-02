import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Lock, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { AppHeader } from "@/components/AppHeader";
import { RequireModule } from "@/components/RequireModule";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  BASE_ROLE_LABEL,
  LEVEL_LABEL,
  MODULES,
  type ModuleKey,
  type PermissionLevel,
} from "@/lib/modules";

export const Route = createFileRoute("/_authenticated/settings/permissions")({
  component: PermissionsGuarded,
});

// Somente o ADM acessa (fixo, fora da matriz).
function PermissionsGuarded() {
  return (
    <RequireModule adminOnly>
      <PermissionsPage />
    </RequireModule>
  );
}

type Cargo = {
  id: string;
  name: string;
  base_role: string;
  is_system: boolean;
  is_active: boolean;
};
const isAdminCargo = (c: Cargo) => c.base_role === "admin" || c.base_role === "director";
const moduleLabel = (key: string) => MODULES.find((m) => m.key === key)?.label ?? key;
const levelLabel = (l: string | null) => (l ? (LEVEL_LABEL[l as PermissionLevel] ?? l) : "—");

const LEVEL_STYLE: Record<PermissionLevel, string> = {
  hidden: "bg-gray-100 text-gray-600 border-gray-200",
  view: "bg-amber-50 text-amber-800 border-amber-200",
  edit: "bg-green-50 text-green-800 border-green-200",
};

function PermissionsPage() {
  const qc = useQueryClient();
  const { refreshProfile } = useAuth();
  const [creating, setCreating] = useState(false);

  const cargosQ = useQuery({
    queryKey: ["cargos"],
    queryFn: async (): Promise<Cargo[]> => {
      const { data, error } = await supabase
        .from("cargos")
        .select("*")
        .order("is_system", { ascending: false })
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const permsQ = useQuery({
    queryKey: ["cargo-permissions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cargo_permissions").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });
  const auditQ = useQuery({
    queryKey: ["permission-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("permission_audit")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  const usersQ = useQuery({
    queryKey: ["cargo-user-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("cargo_id")
        .eq("is_active", true);
      if (error) throw error;
      const counts = new Map<string, number>();
      (data ?? []).forEach(
        (p) => p.cargo_id && counts.set(p.cargo_id, (counts.get(p.cargo_id) ?? 0) + 1),
      );
      return counts;
    },
  });

  const levelOf = (cargoId: string, module: ModuleKey): PermissionLevel =>
    ((permsQ.data ?? []).find((p) => p.cargo_id === cargoId && p.module === module)
      ?.level as PermissionLevel) ?? "hidden";

  const setLevel = useMutation({
    mutationFn: async ({
      cargoId,
      module,
      level,
    }: {
      cargoId: string;
      module: ModuleKey;
      level: PermissionLevel;
    }) => {
      const { error } = await supabase
        .from("cargo_permissions")
        .upsert({ cargo_id: cargoId, module, level }, { onConflict: "cargo_id,module" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cargo-permissions"] });
      qc.invalidateQueries({ queryKey: ["permission-audit"] });
      refreshProfile();
      toast.success("Permissão atualizada.");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeCargo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cargos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cargos"] });
      toast.success("Cargo excluído.");
    },
    onError: (e: any) =>
      toast.error(
        e.message?.includes("foreign key")
          ? "Há usuários com este cargo. Troque o cargo deles antes de excluir."
          : e.message,
      ),
  });

  const cargos = cargosQ.data ?? [];

  return (
    <div className="pb-nav">
      <AppHeader
        title="Permissões"
        left={
          <button
            onClick={() => window.history.back()}
            className="text-white/70 hover:text-white p-1.5 -ml-1.5"
            aria-label="Voltar"
          >
            <ArrowLeft size={20} />
          </button>
        }
      />
      <div className="px-4 pt-4 max-w-5xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground max-w-2xl">
            Defina, para cada cargo, o que fica <b>oculto</b>, <b>somente visualização</b> ou com{" "}
            <b>edição</b>. O cargo decide os módulos; a equipe decide quais dados aparecem dentro
            deles.
          </p>
          <button
            onClick={() => setCreating(true)}
            className="h-10 px-4 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold text-sm inline-flex items-center gap-1.5"
          >
            <Plus size={15} strokeWidth={2.5} /> Novo cargo
          </button>
        </div>

        {(cargosQ.error || permsQ.error) && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs">
            Erro ao carregar as permissões: {((cargosQ.error || permsQ.error) as Error).message}
          </div>
        )}

        {/* Matriz Cargo x Módulo */}
        <div className="bg-white rounded-2xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface)] text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-semibold sticky left-0 bg-[var(--surface)] z-10">
                  Cargo
                </th>
                {MODULES.map((m) => (
                  <th
                    key={m.key}
                    className="px-2 py-3 font-semibold text-center whitespace-nowrap"
                    title={m.description}
                  >
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cargos.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 sticky left-0 bg-white z-10 min-w-[190px]">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-[var(--navy)] truncate">{c.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {BASE_ROLE_LABEL[c.base_role] ?? c.base_role} ·{" "}
                          {usersQ.data?.get(c.id) ?? 0} usuário(s)
                        </div>
                      </div>
                      {!c.is_system && (
                        <button
                          onClick={() =>
                            confirm(`Excluir o cargo "${c.name}"?`) && removeCargo.mutate(c.id)
                          }
                          className="ml-auto p-1.5 text-muted-foreground hover:text-red-600"
                          aria-label={`Excluir cargo ${c.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                  {isAdminCargo(c) ? (
                    <td
                      colSpan={MODULES.length}
                      className="px-3 py-3 text-xs text-muted-foreground"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Lock size={13} /> Acesso total — não pode ser alterado (o sistema nunca
                        fica sem administrador).
                      </span>
                    </td>
                  ) : (
                    MODULES.map((m) => {
                      const level = levelOf(c.id, m.key);
                      return (
                        <td key={m.key} className="px-1.5 py-2 text-center">
                          <select
                            value={level}
                            disabled={setLevel.isPending}
                            onChange={(e) =>
                              setLevel.mutate({
                                cargoId: c.id,
                                module: m.key,
                                level: e.target.value as PermissionLevel,
                              })
                            }
                            className={`h-9 px-2 rounded-lg border text-xs font-semibold ${LEVEL_STYLE[level]}`}
                            aria-label={`${c.name} — ${m.label}`}
                          >
                            <option value="hidden">Oculto</option>
                            <option value="view">Visualizar</option>
                            <option value="edit">Editar</option>
                          </select>
                        </td>
                      );
                    })
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Regras fixas */}
        <div className="bg-white rounded-2xl border border-border p-4 text-sm">
          <h3 className="font-semibold text-[var(--navy)] mb-2">Acessos fixos (fora da matriz)</h3>
          <ul className="space-y-1.5 text-muted-foreground">
            <li>
              <b className="text-[var(--navy)]">Permissões e cargos:</b> somente o ADM.
            </li>
            <li>
              <b className="text-[var(--navy)]">Log de check-ins:</b> somente ADM e RH.
            </li>
            <li>
              <b className="text-[var(--navy)]">Dados do lead</b> (nome, telefone, e-mail, ID): só o
              ADM edita.
            </li>
            <li>
              <b className="text-[var(--navy)]">Gestores</b> não recebem leads; corretores veem só
              os próprios e gestores, os da equipe.
            </li>
          </ul>
        </div>

        {/* Histórico */}
        <div className="bg-white rounded-2xl border border-border p-4">
          <h3 className="font-semibold text-[var(--navy)] mb-3 text-sm">Histórico de alterações</h3>
          {(auditQ.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma alteração registrada ainda.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {(auditQ.data ?? []).map((a) => (
                <li key={a.id} className="py-2">
                  <span className="font-medium text-[var(--navy)]">{a.changed_by_name ?? "—"}</span>{" "}
                  alterou <b>{moduleLabel(a.module)}</b> do cargo <b>{a.cargo_name ?? "—"}</b>:{" "}
                  {levelLabel(a.old_level)} → <b>{levelLabel(a.new_level)}</b>
                  <div className="text-[11px] text-muted-foreground">
                    {format(new Date(a.changed_at), "dd/MM/yyyy HH:mm")}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {creating && (
        <NewCargoSheet
          cargos={cargos}
          permissions={permsQ.data ?? []}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function NewCargoSheet({
  cargos,
  permissions,
  onClose,
}: {
  cargos: Cargo[];
  permissions: { cargo_id: string; module: string; level: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [base, setBase] = useState<"master" | "broker" | "hr">("broker");

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("cargos")
        .insert({ name: name.trim(), base_role: base })
        .select("id")
        .single();
      if (error) throw error;
      // começa com as mesmas permissões do cargo padrão do mesmo tipo
      const template = cargos.find((c) => c.is_system && c.base_role === base);
      const rows = permissions
        .filter((p) => p.cargo_id === template?.id)
        .map((p) => ({ cargo_id: data.id, module: p.module, level: p.level }));
      if (rows.length) {
        const { error: pErr } = await supabase.from("cargo_permissions").insert(rows);
        if (pErr) throw pErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cargos"] });
      qc.invalidateQueries({ queryKey: ["cargo-permissions"] });
      qc.invalidateQueries({ queryKey: ["permission-audit"] });
      toast.success("Cargo criado. Ajuste as permissões na matriz.");
      onClose();
    },
    onError: (e: any) =>
      toast.error(
        e.message?.includes("duplicate") ? "Já existe um cargo com esse nome." : e.message,
      ),
  });

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-[var(--navy)]">Novo cargo</h3>
        <input
          className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
          placeholder="Nome do cargo (ex.: Coordenador)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <label className="block">
          <span className="text-xs text-muted-foreground font-medium mb-1 block">
            Quais dados este cargo enxerga
          </span>
          <select
            className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
            value={base}
            onChange={(e) => setBase(e.target.value as "master" | "broker" | "hr")}
          >
            <option value="broker">{BASE_ROLE_LABEL.broker}</option>
            <option value="master">{BASE_ROLE_LABEL.master}</option>
            <option value="hr">{BASE_ROLE_LABEL.hr}</option>
          </select>
        </label>
        <p className="text-[11px] text-muted-foreground">
          O cargo começa com as permissões padrão desse tipo; depois ajuste os módulos na matriz.
        </p>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!name.trim() || create.isPending}
            className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50"
          >
            {create.isPending ? "Criando…" : "Criar cargo"}
          </button>
        </div>
      </form>
    </div>
  );
}
