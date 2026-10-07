import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Eye, EyeOff, Bell, X, Camera, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { usePushNotifications } from "@/hooks/usePushNotifications";

export const Route = createFileRoute("/_authenticated/settings/profile")({
  component: ProfileSettingsPage,
});

const PALETTE = [
  "#14B8A6",
  "#F97316",
  "#8B5CF6",
  "#0EA5E9",
  "#F43F5E",
  "#10B981",
  "#B28069",
  "#64748B",
];

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <h2 className="text-base font-semibold text-[var(--navy)] mb-4">{title}</h2>
      {children}
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-12 px-4 pr-12 rounded-xl bg-[var(--surface)] border border-border focus:outline-none focus:border-[var(--gold)] text-[var(--navy)]"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow(!show)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

function FeatureToggle({
  label,
  description,
  icon: Icon,
  enabled,
  onChange,
}: {
  label: string;
  description: string;
  icon: React.ElementType;
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3.5">
      <div className="w-10 h-10 rounded-xl bg-[var(--surface)] flex items-center justify-center flex-shrink-0">
        <Icon size={18} className="text-[var(--navy)]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--navy)]">{label}</p>
        <p className="text-xs text-muted-foreground leading-tight">{description}</p>
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative w-12 h-6 rounded-full flex-shrink-0 transition-colors duration-200 ${
          enabled ? "bg-[var(--navy)]" : "bg-gray-200"
        }`}
        aria-pressed={enabled}
      >
        <span
          className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
            enabled ? "translate-x-7" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

function formatLeadTime(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} dia${min / 1440 > 1 ? "s" : ""}`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min} min`;
}

function NotificationsSection() {
  const { profile, isAdmin, isDirector, refreshProfile } = useAuth();
  const { supported, subscribed, loading, subscribe, unsubscribe } = usePushNotifications();
  const isManager = isAdmin || isDirector;

  const [reminderMinutes, setReminderMinutes] = useState<number[]>(
    profile?.reminder_minutes ?? [30],
  );
  const [newLeadTime, setNewLeadTime] = useState("");
  const [shiftReminderTime, setShiftReminderTime] = useState(
    profile?.shift_reminder_time?.slice(0, 5) ?? "",
  );

  const remindersChanged =
    JSON.stringify([...reminderMinutes].sort((a, b) => a - b)) !==
    JSON.stringify([...(profile?.reminder_minutes ?? [])].sort((a, b) => a - b));

  const addLeadTime = () => {
    const value = parseInt(newLeadTime);
    if (!value || value <= 0) return;
    if (!reminderMinutes.includes(value)) {
      setReminderMinutes((prev) => [...prev, value].sort((a, b) => a - b));
    }
    setNewLeadTime("");
  };

  const removeLeadTime = (value: number) => {
    setReminderMinutes((prev) => prev.filter((v) => v !== value));
  };

  const saveReminder = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ reminder_minutes: reminderMinutes } as any)
        .eq("id", profile!.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Lembretes atualizados!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const saveShiftReminder = useMutation({
    mutationFn: async (value: string | null) => {
      const { error } = await supabase
        .from("profiles")
        .update({ shift_reminder_time: value } as any)
        .eq("id", profile!.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Lembrete de escala atualizado!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleToggle = async () => {
    try {
      if (subscribed) {
        await unsubscribe();
        toast.success("Notificações desativadas");
      } else {
        await subscribe();
        toast.success("Notificações ativadas!");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Não foi possível alterar as notificações");
    }
  };

  return (
    <SectionCard title="Notificações">
      <div className="space-y-4">
        <FeatureToggle
          label="Notificações push"
          description={
            !supported
              ? "Seu navegador não suporta notificações push."
              : "Receba avisos de agendamentos direto no celular/desktop."
          }
          icon={Bell}
          enabled={subscribed}
          onChange={supported ? handleToggle : () => {}}
        />
        {loading && <p className="text-xs text-muted-foreground">Atualizando…</p>}

        {isManager && (
          <>
            <div className="pt-2 border-t border-border">
              <label className="text-xs text-muted-foreground font-medium mb-1 block">
                Lembretes de agendamento
              </label>
              <p className="text-[11px] text-muted-foreground mb-2">
                Você e o corretor recebem um lembrete push em cada uma dessas antecedências.
              </p>

              {reminderMinutes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {reminderMinutes.map((m) => (
                    <span
                      key={m}
                      className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-[var(--surface)] border border-border text-[var(--navy)]"
                    >
                      {formatLeadTime(m)}
                      <button
                        onClick={() => removeLeadTime(m)}
                        className="text-muted-foreground hover:text-red-500"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  placeholder="Minutos (ex: 1440 = 1 dia)"
                  className="flex-1 h-11 px-3 rounded-xl bg-[var(--surface)] border border-border focus:outline-none focus:border-[var(--gold)] text-[var(--navy)] text-sm"
                  value={newLeadTime}
                  onChange={(e) => setNewLeadTime(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addLeadTime()}
                />
                <button
                  onClick={addLeadTime}
                  className="px-3 h-11 rounded-xl bg-[var(--surface)] border border-border text-[var(--navy)] font-semibold"
                >
                  + Adicionar
                </button>
              </div>

              <button
                onClick={() => saveReminder.mutate()}
                disabled={!remindersChanged || saveReminder.isPending}
                className="mt-2 w-full h-11 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50"
              >
                {saveReminder.isPending ? "Salvando…" : "Salvar lembretes"}
              </button>
            </div>

            <div className="pt-2 border-t border-border">
              <label className="text-xs text-muted-foreground font-medium mb-1 block">
                Lembrete de escala (plantão do dia seguinte)
              </label>
              <p className="text-[11px] text-muted-foreground mb-2">
                Todo dia nesse horário, corretores com plantão marcado pra amanhã recebem um
                lembrete push (destacando plantão noturno).
              </p>
              <div className="flex gap-2">
                <input
                  type="time"
                  className="flex-1 h-11 px-3 rounded-xl bg-[var(--surface)] border border-border focus:outline-none focus:border-[var(--gold)] text-[var(--navy)] text-sm"
                  value={shiftReminderTime}
                  onChange={(e) => setShiftReminderTime(e.target.value)}
                />
                <button
                  onClick={() => saveShiftReminder.mutate(shiftReminderTime || null)}
                  disabled={
                    shiftReminderTime === (profile?.shift_reminder_time?.slice(0, 5) ?? "") ||
                    saveShiftReminder.isPending
                  }
                  className="px-4 h-11 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50"
                >
                  Salvar
                </button>
                {profile?.shift_reminder_time && (
                  <button
                    onClick={() => {
                      setShiftReminderTime("");
                      saveShiftReminder.mutate(null);
                    }}
                    disabled={saveShiftReminder.isPending}
                    className="px-3 h-11 rounded-xl border border-red-200 text-red-500 text-sm font-medium disabled:opacity-50"
                  >
                    Desativar
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}

// Reduz a foto para no máximo 512px (JPEG) antes de enviar.
async function resizeImage(file: File, max = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Não foi possível processar a imagem"))),
      "image/jpeg",
      0.88,
    ),
  );
}

function PhotoSection() {
  const { user, profile, refreshProfile } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!file.type.startsWith("image/"))
        throw new Error("Escolha uma imagem (JPG, PNG ou WebP).");
      const blob = await resizeImage(file);
      const path = `${user!.id}/avatar-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const old = profile?.avatar_url;
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: data.publicUrl })
        .eq("id", user!.id);
      if (error) throw error;
      // remove a foto anterior do storage
      const oldPath = old?.split("/avatars/")[1];
      if (oldPath) await supabase.storage.from("avatars").remove([oldPath]);
    },
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Foto atualizada!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removePhoto = useMutation({
    mutationFn: async () => {
      const oldPath = profile?.avatar_url?.split("/avatars/")[1];
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: null })
        .eq("id", user!.id);
      if (error) throw error;
      if (oldPath) await supabase.storage.from("avatars").remove([oldPath]);
    },
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Foto removida.");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const busy = upload.isPending || removePhoto.isPending;

  return (
    <SectionCard title="Foto de perfil">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="relative group rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
          aria-label="Alterar foto"
        >
          <Avatar
            name={profile?.full_name ?? "?"}
            color={profile?.color ?? "#B28069"}
            src={profile?.avatar_url}
            size={80}
          />
          <span className="absolute inset-0 rounded-full bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
            <Camera size={22} />
          </span>
          <span className="absolute -bottom-0.5 -right-0.5 h-7 w-7 rounded-full bg-[var(--gold)] text-white flex items-center justify-center ring-2 ring-white">
            <Camera size={14} />
          </span>
        </button>
        <div className="min-w-0 space-y-2">
          <p className="text-xs text-muted-foreground">
            JPG, PNG ou WebP. A foto aparece no menu e nos cards da equipe.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="h-10 px-3 rounded-lg bg-[var(--navy)] text-white text-sm font-semibold disabled:opacity-50"
            >
              {upload.isPending ? "Enviando…" : profile?.avatar_url ? "Trocar foto" : "Enviar foto"}
            </button>
            {profile?.avatar_url && (
              <button
                type="button"
                onClick={() => removePhoto.mutate()}
                disabled={busy}
                className="h-10 px-3 rounded-lg bg-red-50 text-red-600 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 size={14} /> Remover
              </button>
            )}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload.mutate(file);
          }}
        />
      </div>
    </SectionCard>
  );
}

function ProfileSettingsPage() {
  const { user, profile, isAdmin, isSuperAdmin, refreshProfile } = useAuth();

  // — Dados pessoais —
  const [name, setName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [teamName, setTeamName] = useState(profile?.team_name ?? "");
  const isManager = profile?.role !== "broker";

  const saveProfile = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("O nome não pode estar em branco");
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: name.trim(),
          phone: phone.trim() || null,
          ...(isManager ? { team_name: teamName.trim() || null } : {}),
        })
        .eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Dados atualizados!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // — Alterar senha —
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  const changePassword = useMutation({
    mutationFn: async () => {
      if (newPw.length < 8) throw new Error("A nova senha deve ter pelo menos 8 caracteres");
      if (newPw !== confirmPw) throw new Error("As senhas não coincidem");

      // Verify current password by re-authenticating
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: user!.email!,
        password: currentPw,
      });
      if (signInErr) throw new Error("Senha atual incorreta");

      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Senha alterada com sucesso!");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // — Aparência (admin only) —
  const [color, setColor] = useState(profile?.color ?? "#B28069");

  const saveColor = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("profiles").update({ color }).eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Cor atualizada!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="pb-nav">
      <AppHeader
        title="Minha Conta"
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

      <div className="px-4 pt-4 pb-6 space-y-4">
        {/* ── Foto ── */}
        <PhotoSection />

        {/* ── Notificações ── */}
        <NotificationsSection />

        {/* ── Dados pessoais ── */}
        <SectionCard title="Dados pessoais">
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">
                Nome completo
              </label>
              <input
                className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border focus:outline-none focus:border-[var(--gold)] text-[var(--navy)]"
                placeholder="Nome completo"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">E-mail</label>
              <input
                className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-muted-foreground cursor-not-allowed"
                value={user?.email ?? ""}
                readOnly
                disabled
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                O e-mail não pode ser alterado.
              </p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">
                Telefone
              </label>
              <input
                className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border focus:outline-none focus:border-[var(--gold)] text-[var(--navy)]"
                placeholder="(11) 99999-9999"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            {isManager && (
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">
                  Nome da equipe
                </label>
                <input
                  className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border focus:outline-none focus:border-[var(--gold)] text-[var(--navy)]"
                  placeholder="Ex.: Online P&G"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Aparece como "Equipe {teamName.trim() || name}" na tela Time.
                </p>
              </div>
            )}
            <button
              onClick={() => saveProfile.mutate()}
              disabled={saveProfile.isPending}
              className="w-full h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-60"
            >
              {saveProfile.isPending ? "Salvando…" : "Salvar dados"}
            </button>
          </div>
        </SectionCard>

        {/* ── Alterar senha ── */}
        <SectionCard title="Alterar senha">
          <div className="space-y-3">
            <PasswordInput
              value={currentPw}
              onChange={setCurrentPw}
              placeholder="Senha atual"
              autoComplete="current-password"
            />
            <PasswordInput
              value={newPw}
              onChange={setNewPw}
              placeholder="Nova senha (mín. 8 caracteres)"
              autoComplete="new-password"
            />
            <PasswordInput
              value={confirmPw}
              onChange={setConfirmPw}
              placeholder="Confirmar nova senha"
              autoComplete="new-password"
            />
            {newPw && confirmPw && newPw !== confirmPw && (
              <p className="text-xs text-red-600 font-medium">As senhas não coincidem.</p>
            )}
            <button
              onClick={() => changePassword.mutate()}
              disabled={
                !currentPw ||
                !newPw ||
                !confirmPw ||
                newPw !== confirmPw ||
                newPw.length < 8 ||
                changePassword.isPending
              }
              className="w-full h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-semibold disabled:opacity-50"
            >
              {changePassword.isPending ? "Alterando…" : "Alterar senha"}
            </button>
          </div>
        </SectionCard>

        {/* ── Aparência (admin only) ── */}
        {isAdmin && (
          <SectionCard title="Aparência do perfil">
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar
                  name={profile?.full_name ?? "?"}
                  color={color}
                  src={profile?.avatar_url}
                  size={56}
                />
                <div>
                  <p className="text-sm font-semibold text-[var(--navy)]">{profile?.full_name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{profile?.role}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-2">Cor do perfil</p>
                <div className="flex gap-2 flex-wrap">
                  {PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className="w-9 h-9 rounded-full transition-transform hover:scale-110"
                      style={{
                        background: c,
                        outline: color === c ? "3px solid var(--navy)" : "none",
                        outlineOffset: 2,
                      }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
              <button
                onClick={() => saveColor.mutate()}
                disabled={color === profile?.color || saveColor.isPending}
                className="w-full h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50"
              >
                {saveColor.isPending ? "Salvando…" : "Salvar cor"}
              </button>
            </div>
          </SectionCard>
        )}

        {/* ── Módulos (admin only) ── */}
        {isSuperAdmin && (
          <SectionCard title="Permissões e cargos">
            <p className="text-sm text-muted-foreground mb-3">
              Defina o que cada cargo vê e edita no sistema e consulte o histórico de alterações.
            </p>
            <Link
              to="/settings/permissions"
              className="inline-flex h-11 px-5 rounded-xl bg-[var(--navy)] text-white font-semibold items-center"
            >
              Abrir permissões
            </Link>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
