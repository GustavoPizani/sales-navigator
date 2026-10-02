import { createFileRoute, Navigate } from "@tanstack/react-router";
import { RequireModule } from "@/components/RequireModule";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Phone, MessageCircle, Mail, MoreVertical, ChevronDown, ChevronRight, Check, Trash2, Copy, Link, KeyRound } from "lucide-react";
import toast from "react-hot-toast";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Collapsible from "@radix-ui/react-collapsible";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { deleteUser } from "@/lib/admin.functions";
import { useBrokers } from "@/hooks/useBrokers";

export const Route = createFileRoute("/_authenticated/team")({
  component: TeamPageGuarded,
});

// Rota bloqueada pela matriz de permissões do cargo.
function TeamPageGuarded() {
  return (
    <RequireModule modules={["team"]}>
      <TeamPage />
    </RequireModule>
  );
}

type Profile = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  color: string;
  role: string;
  is_active: boolean;
  manager_id: string | null;
  team_name: string | null;
  avatar_url: string | null;
  cargo_id?: string | null;
};

/** Equipe = um gerente (role "master"). */
type TeamOption = { id: string; label: string };

const teamLabel = (m: Pick<Profile, "team_name" | "full_name">) => m.team_name || m.full_name;

function randomTempPassword() {
  return "PeG@" + Math.floor(100000 + Math.random() * 900000);
}

function TeamPage() {
  const { isAdmin, isDirector, isSuperAdmin } = useAuth();
  if (!isAdmin && !isDirector) return <Navigate to="/dashboard" replace />;
  // admin: todas as equipes; gerente: a própria equipe
  return isSuperAdmin ? <TeamsAdminView /> : <AdminTeamView />;
}

function AdminTeamView() {
  const [addNew, setAddNew] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [inactiveOpen, setInactiveOpen] = useState(false);
  const { profile } = useAuth();

  const qc = useQueryClient();

  const brokersQ = useBrokers({ select: "*", includeInactive: true });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("profiles").update({ is_active: !is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["brokers-active"] });
      toast.success(vars.is_active ? "Corretor desativado" : "Corretor reativado");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteProfile = useMutation({
    mutationFn: (id: string) => deleteUser({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brokers-active"] });
      toast.success("Corretor excluído");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null);
  const [resetPasswordProfile, setResetPasswordProfile] = useState<Profile | null>(null);

  const active = (brokersQ.data ?? []).filter((b) => b.is_active);
  const inactive = (brokersQ.data ?? []).filter((b) => !b.is_active);

  return (
    <div className="pb-nav">
      <AppHeader title={`Equipe ${profile?.team_name || profile?.full_name || ""}`} />

      <div className="px-4 pt-4 space-y-3">
        <button
          onClick={() => setAddNew(true)}
          className="w-full h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold text-sm flex items-center justify-center gap-2"
        >
          <Plus size={16} strokeWidth={2.5} />
          Adicionar corretor
        </button>

        {active.length === 0 && inactive.length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">
            Nenhum corretor ainda. Toque em Adicionar para começar.
          </p>
        )}

        {active.map((broker) => (
          <BrokerCard
            key={broker.id}
            broker={broker}
            onEdit={() => setEditing(broker)}
            onToggleActive={() => toggleActive.mutate({ id: broker.id, is_active: broker.is_active })}
            onDelete={() => setConfirmDelete(broker)}
            onResetPassword={() => setResetPasswordProfile(broker)}
          />
        ))}

        {inactive.length > 0 && (
          <Collapsible.Root open={inactiveOpen} onOpenChange={setInactiveOpen}>
            <Collapsible.Trigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground py-2 w-full">
              {inactiveOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              Inativos ({inactive.length})
            </Collapsible.Trigger>
            <Collapsible.Content className="space-y-3">
              {inactive.map((broker) => (
                <BrokerCard
                  key={broker.id}
                  broker={broker}
                  onEdit={() => setEditing(broker)}
                  onToggleActive={() => toggleActive.mutate({ id: broker.id, is_active: broker.is_active })}
                  onDelete={() => setConfirmDelete(broker)}
                  onResetPassword={() => setResetPasswordProfile(broker)}
                />
              ))}
            </Collapsible.Content>
          </Collapsible.Root>
        )}
      </div>

      {addNew && <AddBrokerSheet onClose={() => setAddNew(false)} />}
      {editing && <EditBrokerSheet profile={editing} onClose={() => setEditing(null)} />}
      <DeleteConfirmModal
        name={confirmDelete?.full_name ?? ""}
        open={!!confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { deleteProfile.mutate(confirmDelete!.id); setConfirmDelete(null); }}
      />
      <ResetPasswordModal
        profile={resetPasswordProfile}
        open={!!resetPasswordProfile}
        onCancel={() => setResetPasswordProfile(null)}
      />
    </div>
  );
}

/** Visão do admin: todas as equipes (um gerente cada) e seus corretores. */
function TeamsAdminView() {
  const qc = useQueryClient();
  const [addManager, setAddManager] = useState(false);
  const [addHr, setAddHr] = useState(false);
  // undefined = fechado; null = sem equipe pré-selecionada; id = equipe
  const [addBroker, setAddBroker] = useState<string | null | undefined>(undefined);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null);
  const [resetPasswordProfile, setResetPasswordProfile] = useState<Profile | null>(null);
  const [openTeams, setOpenTeams] = useState<Record<string, boolean>>({});
  const { profile } = useAuth();

  const managersQ = useQuery({
    queryKey: ["team-managers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,email,phone,color,role,is_active,manager_id,team_name,avatar_url,cargo_id")
        .eq("role", "master")
        .order("team_name")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });
  const brokersQ = useBrokers({ select: "*", includeInactive: true });
  // RH: acessa o log de check-ins e os módulos liberados na matriz de permissões
  const hrQ = useQuery({
    queryKey: ["team-hr"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,email,phone,color,role,is_active,manager_id,team_name,avatar_url,cargo_id")
        .eq("role", "hr")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["team-hr"] });
    qc.invalidateQueries({ queryKey: ["team-managers"] });
    qc.invalidateQueries({ queryKey: ["brokers-active"] });
  };
  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("profiles").update({ is_active: !is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidate();
      toast.success(vars.is_active ? "Usuário desativado" : "Usuário reativado");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteProfile = useMutation({
    mutationFn: (id: string) => deleteUser({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Usuário removido");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const managers = managersQ.data ?? [];
  const brokers = (brokersQ.data ?? []) as Profile[];
  const managerIds = new Set(managers.map((m) => m.id));
  const teams: TeamOption[] = managers.filter((m) => m.is_active).map((m) => ({ id: m.id, label: teamLabel(m) }));
  const noTeam = brokers.filter((b) => !b.manager_id || !managerIds.has(b.manager_id));

  const brokerCard = (b: Profile) => (
    <BrokerCard
      key={b.id}
      broker={b}
      onEdit={() => setEditing(b)}
      onToggleActive={() => toggleActive.mutate({ id: b.id, is_active: b.is_active })}
      onDelete={() => setConfirmDelete(b)}
      onResetPassword={() => setResetPasswordProfile(b)}
    />
  );

  return (
    <div className="pb-nav">
      <AppHeader title={`Equipes ${profile?.team_name || "P&G"}`} />
      <div className="px-4 pt-4 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <button
            onClick={() => setAddManager(true)}
            className="h-12 rounded-xl bg-[var(--navy)] text-white font-bold text-sm flex items-center justify-center gap-2"
          >
            <Plus size={16} strokeWidth={2.5} /> Adicionar gerente
          </button>
          <button
            onClick={() => setAddBroker(null)}
            className="h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold text-sm flex items-center justify-center gap-2"
          >
            <Plus size={16} strokeWidth={2.5} /> Adicionar corretor
          </button>
          <button
            onClick={() => setAddHr(true)}
            className="h-12 rounded-xl bg-white border border-border text-[var(--navy)] font-bold text-sm flex items-center justify-center gap-2 col-span-2 sm:col-span-1"
          >
            <Plus size={16} strokeWidth={2.5} /> Adicionar RH
          </button>
        </div>

        {managersQ.isPending && <p className="text-center text-muted-foreground text-sm py-4">Carregando...</p>}
        {!managersQ.isPending && managers.length === 0 && (
          <p className="text-center text-muted-foreground py-8 text-sm">
            Nenhuma equipe ainda. Comece adicionando os gerentes.
          </p>
        )}

        {managers.map((m) => {
          const team = brokers.filter((b) => b.manager_id === m.id);
          const activeCount = team.filter((b) => b.is_active).length;
          const open = openTeams[m.id] ?? true;
          return (
            <section
              key={m.id}
              className={`bg-white rounded-2xl border border-border overflow-hidden ${!m.is_active ? "opacity-60" : ""}`}
            >
              <div className="flex items-center gap-2 p-4 border-b border-border bg-[var(--surface)]/60">
                <button
                  type="button"
                  onClick={() => setOpenTeams((o) => ({ ...o, [m.id]: !open }))}
                  className="flex flex-1 min-w-0 items-center gap-3 text-left"
                  aria-expanded={open}
                >
                  {open ? (
                    <ChevronDown size={16} className="flex-shrink-0" />
                  ) : (
                    <ChevronRight size={16} className="flex-shrink-0" />
                  )}
                  <Avatar name={m.full_name} color={m.color} src={m.avatar_url} size={40} />
                  <div className="min-w-0">
                    <p className="font-bold text-[var(--navy)] truncate">Equipe {teamLabel(m)}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      Gerente: {m.full_name} · {activeCount} corretor{activeCount === 1 ? "" : "es"}
                      {!m.is_active && " · inativo"}
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => setAddBroker(m.id)}
                  className="h-9 w-9 flex-shrink-0 rounded-xl bg-[var(--gold)]/15 text-[var(--gold-dark)] flex items-center justify-center"
                  aria-label={`Adicionar corretor na equipe ${teamLabel(m)}`}
                  title="Adicionar corretor nesta equipe"
                >
                  <Plus size={16} />
                </button>
                <MemberMenu
                  isActive={m.is_active}
                  onEdit={() => setEditing(m)}
                  onToggleActive={() => toggleActive.mutate({ id: m.id, is_active: m.is_active })}
                  onDelete={() => setConfirmDelete(m)}
                  onResetPassword={() => setResetPasswordProfile(m)}
                />
              </div>
              {open && (
                <div className="p-3 space-y-2">
                  {team.length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground py-3">Nenhum corretor nesta equipe.</p>
                  ) : (
                    team.map(brokerCard)
                  )}
                </div>
              )}
            </section>
          );
        })}

        {noTeam.length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Sem equipe ({noTeam.length})
            </p>
            {noTeam.map(brokerCard)}
          </section>
        )}

        {(hrQ.data ?? []).length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              RH ({(hrQ.data ?? []).length})
            </p>
            {(hrQ.data ?? []).map((u) => (
              <BrokerCard
                key={u.id}
                broker={u}
                roleLabel="RH"
                onEdit={() => setEditing(u)}
                onToggleActive={() => toggleActive.mutate({ id: u.id, is_active: u.is_active })}
                onDelete={() => setConfirmDelete(u)}
                onResetPassword={() => setResetPasswordProfile(u)}
              />
            ))}
          </section>
        )}
      </div>

      {addManager && <AddManagerSheet onClose={() => setAddManager(false)} />}
      {addHr && (
        <AddManagerSheet
          kind="hr"
          onClose={() => {
            setAddHr(false);
            qc.invalidateQueries({ queryKey: ["team-hr"] });
          }}
        />
      )}
      {addBroker !== undefined && (
        <AddBrokerSheet teams={teams} defaultTeamId={addBroker} onClose={() => setAddBroker(undefined)} />
      )}
      {editing && <EditBrokerSheet profile={editing} teams={teams} onClose={() => setEditing(null)} />}
      <DeleteConfirmModal
        name={confirmDelete?.full_name ?? ""}
        open={!!confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          deleteProfile.mutate(confirmDelete!.id);
          setConfirmDelete(null);
        }}
      />
      <ResetPasswordModal
        profile={resetPasswordProfile}
        open={!!resetPasswordProfile}
        onCancel={() => setResetPasswordProfile(null)}
      />
    </div>
  );
}

function BrokerCard({
  broker,
  roleLabel = "Corretor",
  onEdit,
  onToggleActive,
  onDelete,
  onResetPassword,
}: {
  broker: Profile;
  roleLabel?: string;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onResetPassword: () => void;
}) {
  const phoneDigits = broker.phone?.replace(/\D/g, "");

  return (
    <div
      className={`bg-white rounded-2xl border border-border p-4 flex items-center gap-3 ${
        !broker.is_active ? "opacity-60" : ""
      }`}
    >
      <Avatar name={broker.full_name} color={broker.color} src={broker.avatar_url} size={48} />

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[var(--navy)] truncate">{broker.full_name}</p>
        <p className="text-xs text-muted-foreground">{roleLabel} · {broker.phone ?? broker.email}</p>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          {broker.is_active ? (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
              Ativo
            </span>
          ) : (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
              Inativo
            </span>
          )}
        </div>
      </div>

      {/* Quick contact */}
      <div className="flex gap-1">
        {broker.phone && (
          <a
            href={`tel:${broker.phone}`}
            className="w-9 h-9 rounded-xl bg-[var(--surface)] flex items-center justify-center text-muted-foreground"
          >
            <Phone size={15} />
          </a>
        )}
        {phoneDigits && (
          <a
            href={`https://wa.me/${phoneDigits}`}
            target="_blank"
            rel="noreferrer"
            className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center text-green-600"
          >
            <MessageCircle size={15} />
          </a>
        )}
        <a
          href={`mailto:${broker.email}`}
          className="w-9 h-9 rounded-xl bg-[var(--surface)] flex items-center justify-center text-muted-foreground"
        >
          <Mail size={15} />
        </a>
      </div>

      <MemberMenu
        isActive={broker.is_active}
        onEdit={onEdit}
        onToggleActive={onToggleActive}
        onDelete={onDelete}
        onResetPassword={onResetPassword}
      />
    </div>
  );
}

/** Menu de ações de um membro (editar, senha, ativar/desativar, excluir). */
function MemberMenu({
  isActive,
  onEdit,
  onToggleActive,
  onDelete,
  onResetPassword,
}: {
  isActive: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onResetPassword: () => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="w-9 h-9 rounded-xl bg-[var(--surface)] flex items-center justify-center text-muted-foreground"
          aria-label="Opções"
        >
          <MoreVertical size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          style={{ zIndex: 999 }}
          className="bg-white rounded-2xl shadow-2xl border border-border py-1.5 min-w-[150px]"
        >
          <DropdownMenu.Item
            className="px-4 py-2.5 text-sm font-medium text-[var(--navy)] cursor-pointer hover:bg-[var(--surface)] outline-none select-none rounded-lg mx-1"
            onSelect={onEdit}
          >
            Editar
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="px-4 py-2.5 text-sm font-medium text-[var(--navy)] cursor-pointer hover:bg-[var(--surface)] outline-none select-none rounded-lg mx-1 flex items-center gap-2"
            onSelect={onResetPassword}
          >
            <KeyRound size={14} /> Redefinir Senha
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={`px-4 py-2.5 text-sm font-medium cursor-pointer outline-none select-none rounded-lg mx-1 ${
              isActive ? "text-orange-600 hover:bg-orange-50" : "text-green-700 hover:bg-green-50"
            }`}
            onSelect={onToggleActive}
          >
            {isActive ? "Desativar" : "Reativar"}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border mx-2" />
          <DropdownMenu.Item
            className="px-4 py-2.5 text-sm font-medium text-red-600 cursor-pointer hover:bg-red-50 outline-none select-none rounded-lg mx-1 flex items-center gap-2"
            onSelect={onDelete}
          >
            <Trash2 size={14} /> Excluir
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ResetPasswordModal({
  profile,
  open,
  onCancel,
}: {
  profile: Profile | null;
  open: boolean;
  onCancel: () => void;
}) {
  const [tempPassword, setTempPassword] = useState("");
  const [success, setSuccess] = useState(false);
  
  useEffect(() => {
    if (open) {
      setTempPassword(randomTempPassword());
      setSuccess(false);
    }
  }, [open]);

  const m = useMutation({
    mutationFn: async () => {
      if (!profile) return;
      
      const { error } = await supabase.rpc('admin_reset_password', { 
        p_user_id: profile.id, 
        p_new_password: tempPassword 
      });
      
      if (error) throw error;
    },
    onSuccess: () => {
      setSuccess(true);
      toast.success("Senha redefinida com sucesso!");
    },
    onError: (e: any) => toast.error(e.message || "Erro ao redefinir senha"),
  });

  if (!open || !profile) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onCancel}>
      <div className="bg-white w-full rounded-t-2xl p-5 safe-bottom" onClick={(e) => e.stopPropagation()}>
        {success ? (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <Check size={32} className="text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--navy)]">Senha redefinida!</h3>
            <p className="text-sm text-muted-foreground">A nova senha temporária de {profile.full_name} é:</p>
            <input type="text" readOnly value={tempPassword} className="w-full h-12 px-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 font-mono font-bold text-lg text-center tracking-wider select-all cursor-copy mt-2" title="Clique para selecionar e copiar" />
            <p className="text-[11px] text-muted-foreground mt-2">Ele(a) deverá cadastrar uma nova senha ao fazer login.</p>
            <div className="w-full mt-4 space-y-2">
               <button onClick={() => {
                 const msg = `Olá ${profile.full_name}! Sua senha foi redefinida.\n\nAcesso: ${window.location.origin}\nNova senha temporária: ${tempPassword}\n\nVocê precisará criar uma nova senha ao fazer login.`;
                 navigator.clipboard.writeText(msg);
                 toast.success("Mensagem copiada!");
               }} className="w-full h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold flex items-center justify-center gap-2">
                 <Copy size={18} /> Copiar Mensagem
               </button>
               <button onClick={onCancel} className="w-full h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">Fechar</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center gap-2 py-2">
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mb-1">
              <KeyRound size={22} className="text-blue-600" />
            </div>
            <h3 className="text-base font-bold text-[var(--navy)]">Redefinir senha de {profile.full_name}?</h3>
            <p className="text-sm text-muted-foreground">Isto irá gerar uma nova senha temporária. O usuário precisará usar esta senha para acessar e será forçado a trocá-la no primeiro login.</p>
            <div className="w-full mt-4">
              <p className="text-xs text-muted-foreground font-medium mb-2 text-center">Nova Senha Temporária</p>
              <input type="text" readOnly value={tempPassword} className="w-full h-12 px-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 font-mono font-bold text-lg text-center tracking-wider select-all cursor-copy" title="Clique para selecionar e copiar" />
            </div>
            <div className="flex gap-2 w-full mt-6">
              <button onClick={onCancel} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium text-sm">Cancelar</button>
              <button onClick={() => m.mutate()} disabled={m.isPending} className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-bold text-sm disabled:opacity-50">{m.isPending ? "Redefinindo..." : "Confirmar"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function buildWhatsAppLink(phone: string, name: string, email: string, tempPassword: string, roleLabel: string, managerName: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  const msg = `Olá ${name}! \n\nVocê foi cadastrado(a) como ${roleLabel} na equipe de ${managerName}.\n\nAcesso: ${window.location.origin}\nE-mail: ${email}\nSenha inicial: ${tempPassword}\n\nAcesse e altere sua senha no primeiro login. Bem-vindo(a)!`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
}

function SuccessSheet({ name, roleLabel, email, phone, tempPassword, teamLabel: team, onClose }: {
  name: string; roleLabel: string; email: string; phone: string; tempPassword: string; teamLabel?: string; onClose: () => void;
}) {
  const { profile } = useAuth();
  const waLink = buildWhatsAppLink(phone, name, email, tempPassword, roleLabel, team ?? profile?.team_name ?? profile?.full_name ?? "seu gerente");
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
      <div className="bg-white w-full rounded-t-2xl p-5 safe-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-center text-center gap-3 py-4">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
            <Check size={32} className="text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-[var(--navy)]">{roleLabel} criado!</h3>
          <p className="text-sm text-muted-foreground">{name} foi adicionado(a) com sucesso.</p>
        </div>
        <div className="space-y-3 mt-2">
          {waLink ? (
            <a href={waLink} target="_blank" rel="noreferrer"
              className="w-full h-12 rounded-xl bg-green-500 text-white font-semibold flex items-center justify-center gap-2">
              <MessageCircle size={18} /> Enviar acesso no WhatsApp
            </a>
          ) : (
            <div className="w-full px-4 py-3 rounded-xl bg-[var(--surface)] border border-border text-sm text-center text-muted-foreground">
              Sem telefone cadastrado — compartilhe o acesso manualmente.<br />
              <span className="font-mono font-bold text-[var(--navy)]">{tempPassword}</span>
            </div>
          )}
          <button onClick={onClose} className="w-full h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function AddBrokerSheet({
  onClose,
  teams,
  defaultTeamId,
}: {
  onClose: () => void;
  /** admin: equipes disponíveis (gerentes); gerente: não informa (usa a própria) */
  teams?: TeamOption[];
  defaultTeamId?: string | null;
}) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [teamId, setTeamId] = useState<string>(defaultTeamId ?? teams?.[0]?.id ?? "");
  const teamName = teams ? teams.find((t) => t.id === teamId)?.label : undefined;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [color, setColor] = useState("#B28069");
  const [tempPassword] = useState(() => randomTempPassword());
  const [created, setCreated] = useState<{ name: string; email: string; phone: string } | null>(null);

  // convite vincula o corretor à equipe (gerente) escolhida
  const inviteManagerId = teams ? teamId : profile?.id;
  const inviteLink = inviteManagerId ? `${window.location.origin}/cadastro?m=${inviteManagerId}` : null;

  const copyInviteLink = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink);
    toast.success("Link copiado!");
  };


  const m = useMutation({
    mutationFn: async () => {
      const tempSupabase = createClient(
        (supabase as any).supabaseUrl,
        (supabase as any).supabaseKey,
        { auth: { persistSession: false } }
      );

      const { data, error } = await tempSupabase.auth.signUp({
        email,
        password: tempPassword,
        options: {
          data: {
            full_name: name,
            phone: phone || null,
            force_password_change: true,
          },
        },
      });
      if (error) throw error;
      if (!data.user) throw new Error("Não foi possível criar o usuário.");
      if (teams && !teamId) throw new Error("Escolha a equipe do corretor.");

      // papel e equipe são definidos no banco, com checagem de permissão
      const { error: setupErr } = await supabase.rpc("crm_setup_member", {
        p_user_id: data.user.id,
        p_role: "broker",
        p_manager_id: teams ? teamId : undefined,
      });
      if (setupErr) throw setupErr;
      const { error: upErr } = await supabase
        .from("profiles")
        .update({ full_name: name, color, phone: phone || null })
        .eq("id", data.user.id);
      if (upErr) throw upErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-managers"] });
      qc.invalidateQueries({ queryKey: ["brokers-active"] });
      setCreated({ name, email, phone });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (created) {
    return <SuccessSheet name={created.name} roleLabel="Corretor" email={created.email} phone={created.phone} tempPassword={tempPassword} teamLabel={teamName} onClose={onClose} />;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div
        className="bg-white w-full rounded-t-2xl p-5 safe-bottom max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-[var(--navy)] mb-4">Adicionar corretor</h3>

        {teams && (
          <div className="mb-4">
            <label className="text-xs text-muted-foreground font-medium mb-1 block">Equipe</label>
            {teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">Cadastre um gerente antes de adicionar corretores.</p>
            ) : (
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
              >
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    Equipe {t.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {inviteLink && (
          <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <div className="flex items-center gap-2 mb-2">
              <Link size={14} className="text-amber-700" />
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Enviar para corretor se cadastrar</p>
            </div>
            <p className="text-xs text-amber-600 mb-3">Compartilhe o link abaixo. O corretor preenche os dados e fica vinculado à sua equipe automaticamente.</p>
            <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-amber-200 mb-3">
              <span className="text-xs text-gray-500 truncate flex-1 font-mono">{inviteLink}</span>
            </div>
            <button
              onClick={copyInviteLink}
              className="w-full h-9 rounded-lg bg-amber-100 text-amber-800 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-amber-200 transition-colors"
            >
              <Copy size={13} /> Copiar link de cadastro
            </button>
          </div>
        )}

        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">ou cadastrar manualmente</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="space-y-3">
          <input
            className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
            placeholder="Nome completo"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="email"
            className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
            placeholder="Telefone (ex: +55 11 99999-9999)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <div>
            <p className="text-xs text-muted-foreground font-medium mb-2">Cor do perfil (HEX)</p>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-12 h-12 p-1 rounded-xl bg-[var(--surface)] border border-border cursor-pointer flex-shrink-0"
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border text-sm font-medium text-[var(--navy)] uppercase w-full"
                placeholder="#000000"
                maxLength={7}
              />
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground font-medium mb-2 text-center">Senha Temporária</p>
            <input
              type="text"
              readOnly
              value={tempPassword}
              className="w-full h-12 px-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 font-mono font-bold text-lg text-center tracking-wider select-all cursor-copy"
              title="Clique para selecionar e copiar"
            />
            <p className="text-[11px] text-muted-foreground mt-2 text-center">O corretor deverá definir uma nova senha no primeiro acesso.</p>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium"
            >
              Cancelar
            </button>
            <button
              onClick={() => m.mutate()}
              disabled={!name || !email || m.isPending || (!!teams && !teamId)}
              className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50"
            >
              {m.isPending ? "Criando…" : "Criar corretor"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddManagerSheet({ onClose, kind = "master" }: { onClose: () => void; kind?: "master" | "hr" }) {
  const isHr = kind === "hr";
  const qc = useQueryClient();
  const [teamName, setTeamName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [tempPassword] = useState(() => randomTempPassword());
  const [created, setCreated] = useState<{ name: string; email: string; phone: string } | null>(null);

  const m = useMutation({
    mutationFn: async () => {
      const tempSupabase = createClient(
        (supabase as any).supabaseUrl,
        (supabase as any).supabaseKey,
        { auth: { persistSession: false } }
      );

      const { data, error } = await tempSupabase.auth.signUp({
        email,
        password: tempPassword,
        options: {
          data: {
            full_name: name,
            phone: phone || null,
            force_password_change: true,
          },
        },
      });
      if (error) throw error;
      if (!data.user) throw new Error("Não foi possível criar o usuário.");

      const { error: setupErr } = await supabase.rpc("crm_setup_member", {
        p_user_id: data.user.id,
        p_role: kind,
        p_team_name: isHr ? undefined : teamName.trim() || undefined,
      });
      if (setupErr) throw setupErr;
      const { error: upErr } = await supabase
        .from("profiles")
        .update({ full_name: name, phone: phone || null, color: "#7E5845" })
        .eq("id", data.user.id);
      if (upErr) throw upErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-managers"] });
      setCreated({ name, email, phone });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (created) {
    return <SuccessSheet name={created.name} roleLabel={isHr ? "RH" : "Gerente"} email={created.email} phone={created.phone} tempPassword={tempPassword} teamLabel={isHr ? "Paes & Gregori" : teamName.trim() || created.name} onClose={onClose} />;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div
        className="bg-white w-full rounded-t-2xl p-5 safe-bottom max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-[var(--navy)] mb-4">
          {isHr ? "Adicionar usuário de RH" : "Adicionar gerente"}
        </h3>
        <div className="space-y-3">
          {isHr ? (
            <p className="text-xs text-muted-foreground">
              O RH acessa o log de check-ins e os módulos que você liberar em Permissões. Não vê leads por padrão.
            </p>
          ) : (
            <input
              className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
              placeholder="Nome da equipe (ex.: Online P&G)"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
            />
          )}
          <input
            className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
            placeholder="Nome completo"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="email"
            className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
            placeholder="Telefone (ex: +55 11 99999-9999)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <div>
            <p className="text-xs text-muted-foreground font-medium mb-2 text-center">Senha Temporária</p>
            <input
              type="text"
              readOnly
              value={tempPassword}
              className="w-full h-12 px-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 font-mono font-bold text-lg text-center tracking-wider select-all cursor-copy"
              title="Clique para selecionar e copiar"
            />
            <p className="text-[11px] text-muted-foreground mt-2 text-center">O usuário deverá definir uma nova senha no primeiro acesso.</p>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium"
            >
              Cancelar
            </button>
            <button
              onClick={() => m.mutate()}
              disabled={!name || !email || m.isPending}
              className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50"
            >
              {m.isPending ? "Criando…" : isHr ? "Criar usuário de RH" : "Criar gerente"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditBrokerSheet({
  profile,
  teams,
  onClose,
}: {
  profile: Profile;
  /** admin: permite mover o corretor de equipe */
  teams?: TeamOption[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isManagerProfile = profile.role === "master";
  const [name, setName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [color, setColor] = useState(profile.color);
  const [teamName, setTeamName] = useState(profile.team_name ?? "");
  const [managerId, setManagerId] = useState(profile.manager_id ?? "");
  const [cargoId, setCargoId] = useState(profile.cargo_id ?? "");
  // admin: cargos do mesmo tipo (o tipo define quais dados a pessoa enxerga)
  const cargosQ = useQuery({
    queryKey: ["cargos-of-role", profile.role],
    enabled: !!teams,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cargos")
        .select("id,name")
        .eq("base_role", profile.role as Database["public"]["Enums"]["app_role"])
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const m = useMutation({
    mutationFn: async () => {
      const patch: Database["public"]["Tables"]["profiles"]["Update"] = { full_name: name, phone: phone || null, color };
      if (isManagerProfile) patch.team_name = teamName.trim() || null;
      // cargo: só o admin (o banco também bloqueia para os demais)
      if (teams && cargoId && cargoId !== profile.cargo_id) patch.cargo_id = cargoId;
      // mover de equipe: só o admin (o banco também bloqueia para os demais)
      if (teams && profile.role === "broker" && managerId && managerId !== profile.manager_id) patch.manager_id = managerId;
      const { error } = await supabase.from("profiles").update(patch).eq("id", profile.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-managers"] });
      qc.invalidateQueries({ queryKey: ["team-hr"] });
      qc.invalidateQueries({ queryKey: ["brokers-active"] });
      toast.success("Usuário atualizado");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div
        className="bg-white w-full rounded-t-2xl p-5 safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <Avatar name={name} color={color} src={profile.avatar_url} size={44} />
          <h3 className="text-lg font-semibold text-[var(--navy)]">
            {isManagerProfile ? "Editar gerente" : profile.role === "hr" ? "Editar usuário de RH" : "Editar corretor"}
          </h3>
        </div>
        <div className="space-y-3">
          {isManagerProfile && (
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Nome da equipe</label>
              <input
                className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
                placeholder="Ex.: Online P&G"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
              />
            </div>
          )}
          {teams && (cargosQ.data ?? []).length > 1 && (
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Cargo</label>
              <select
                value={cargoId}
                onChange={(e) => setCargoId(e.target.value)}
                className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
              >
                {(cargosQ.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {teams && profile.role === "broker" && (
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Equipe</label>
              <select
                value={managerId}
                onChange={(e) => setManagerId(e.target.value)}
                className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
              >
                {!teams.some((t) => t.id === managerId) && <option value={managerId}>Sem equipe</option>}
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    Equipe {t.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <input
            className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
            placeholder="Nome completo"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border flex items-center text-muted-foreground text-sm cursor-not-allowed">
            {profile.email}
          </div>
          <p className="text-[11px] text-muted-foreground -mt-1">O e-mail não pode ser alterado.</p>
          <input
            className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
            placeholder="Telefone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <div>
            <p className="text-xs text-muted-foreground font-medium mb-2">{isManagerProfile ? "Cor da equipe (aparece na escala)" : "Cor do perfil (HEX)"}</p>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-12 h-12 p-1 rounded-xl bg-[var(--surface)] border border-border cursor-pointer flex-shrink-0"
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border text-sm font-medium text-[var(--navy)] uppercase w-full"
                placeholder="#000000"
                maxLength={7}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium"
            >
              Cancelar
            </button>
            <button
              onClick={() => m.mutate()}
              disabled={!name || m.isPending}
              className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50"
            >
              {m.isPending ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ name, open, onCancel, onConfirm }: {
  name: string;
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onCancel}>
      <div className="bg-white w-full rounded-t-2xl p-5 safe-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-center text-center gap-2 py-2">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-1">
            <Trash2 size={22} className="text-red-600" />
          </div>
          <h3 className="text-base font-bold text-[var(--navy)]">Excluir {name}?</h3>
          <p className="text-sm text-muted-foreground">Esta ação não pode ser desfeita. O usuário será removido da equipe.</p>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium text-sm">
            Cancelar
          </button>
          <button onClick={onConfirm} className="flex-1 h-12 rounded-xl bg-red-600 text-white font-bold text-sm">
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}
