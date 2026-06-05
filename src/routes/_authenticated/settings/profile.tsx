import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { useFeatures, FEATURE_DEFS, type FeaturesMap } from "@/hooks/useFeatures";

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
  "#C9A84C",
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

function ModulesSection() {
  const { features, saveFeatures } = useFeatures();
  const [local, setLocal] = useState<FeaturesMap>({ ...features });
  const [saving, setSaving] = useState(false);

  const hasChanges = FEATURE_DEFS.some((f) => local[f.key] !== features[f.key]);

  const toggle = (key: keyof FeaturesMap, value: boolean) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveFeatures.mutateAsync(local);
      toast.success("Módulos atualizados!");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <div className="mb-1">
        <h2 className="text-base font-semibold text-[var(--navy)]">Módulos da equipe</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Escolha quais seções ficam visíveis para você e toda a equipe.
        </p>
      </div>
      <div className="divide-y divide-border">
        {FEATURE_DEFS.map((f) => (
          <FeatureToggle
            key={f.key}
            label={f.label}
            description={f.description}
            icon={f.icon}
            enabled={local[f.key] ?? true}
            onChange={(v) => toggle(f.key, v)}
          />
        ))}
      </div>
      <button
        onClick={save}
        disabled={!hasChanges || saving}
        className="mt-4 w-full h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50 transition-opacity"
      >
        {saving ? "Salvando…" : "Salvar módulos"}
      </button>
    </div>
  );
}

function ProfileSettingsPage() {
  const { user, profile, isAdmin, refreshProfile } = useAuth();

  // — Dados pessoais —
  const [name, setName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");

  const saveProfile = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("O nome não pode estar em branco");
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: name.trim(), phone: phone.trim() || null })
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
  const [color, setColor] = useState(profile?.color ?? "#C9A84C");

  const saveColor = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ color })
        .eq("id", user!.id);
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
        {/* ── Dados pessoais ── */}
        <SectionCard title="Dados pessoais">
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Nome completo</label>
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
              <p className="text-[11px] text-muted-foreground mt-1">O e-mail não pode ser alterado.</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Telefone</label>
              <input
                className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border focus:outline-none focus:border-[var(--gold)] text-[var(--navy)]"
                placeholder="(11) 99999-9999"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
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
                <Avatar name={profile?.full_name ?? "?"} color={color} size={56} />
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
        {isAdmin && <ModulesSection />}
      </div>
    </div>
  );
}
