import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import toast from "react-hot-toast";
import { useAuth } from "@/hooks/useAuth";
import { BottomNav } from "@/components/BottomNav";
import { SIDEBAR_WIDTH, Sidebar } from "@/components/Sidebar";
import { PushSubscriber } from "@/components/PushSubscriber";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { session, profile, loading, refreshProfile } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Carregando…</div>;
  if (!session) return <RedirectToLogin />;
  if (!profile) return <ProfileLoadFailed onRetry={refreshProfile} />;
  if (!profile.is_active)
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div>
          <h2 className="text-xl font-semibold text-[var(--navy)]">Conta inativa</h2>
          <p className="text-muted-foreground mt-2">Entre em contato com seu gestor.</p>
        </div>
      </div>
    );

  if (session.user.user_metadata?.force_password_change) {
    return <ForcePasswordChange />;
  }

  return <AppShell />;
}

const SIDEBAR_PREF_KEY = "sidebar:collapsed";

// Desktop: sidebar fixa à esquerda (recolhível, preferência lembrada no navegador).
// Celular: barra inferior.
function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(SIDEBAR_PREF_KEY, c ? "0" : "1");
      } catch {
        /* storage indisponível */
      }
      return !c;
    });
  const offset = collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded;

  return (
    <div className="min-h-screen bg-[var(--surface)]">
      <PushSubscriber />
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div
        className="min-w-0 transition-[padding] duration-300 ease-[cubic-bezier(0.65,0,0.35,1)] lg:pl-[var(--sidebar-offset)]"
        style={{ "--sidebar-offset": offset } as React.CSSProperties}
      >
        <Outlet />
      </div>
      <BottomNav />
    </div>
  );
}

const POST_LOGIN_REDIRECT_KEY = "post-login-redirect";

// Guarda a página que a pessoa tentou abrir (ex.: /checkin?auto=1 vindo do QR
// code) para voltar a ela depois do login.
function RedirectToLogin() {
  try {
    const target = window.location.pathname + window.location.search;
    if (target && target !== "/" && !target.startsWith("/login")) {
      window.sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, target);
    }
  } catch {
    /* storage indisponível */
  }
  return <Navigate to="/login" replace />;
}

function ProfileLoadFailed({ onRetry }: { onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center p-6 text-center">
      <div>
        <h2 className="text-xl font-semibold text-[var(--navy)]">Não foi possível carregar seu perfil</h2>
        <p className="text-muted-foreground mt-2">Verifique sua conexão e tente novamente.</p>
        <button
          onClick={handleRetry}
          disabled={retrying}
          className="mt-4 h-11 px-6 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50"
        >
          {retrying ? "Tentando..." : "Tentar novamente"}
        </button>
      </div>
    </div>
  );
}

function ForcePasswordChange() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error("A senha deve ter no mínimo 6 caracteres.");
    
    setBusy(true);
    const { error } = await supabase.auth.updateUser({
      password,
      data: { force_password_change: false },
    });
    setBusy(false);
    
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Senha atualizada! Redirecionando...");
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen bg-[var(--surface)] grid place-items-center p-4 safe-top safe-bottom">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-border w-full max-w-sm">
        <h2 className="text-xl font-bold text-[var(--navy)] mb-2">Trocar Senha</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Como este é o seu primeiro acesso, por motivos de segurança, você precisa definir uma nova senha.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Nova Senha</label>
            <input type="password" required minLength={6} className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border" placeholder="••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" disabled={busy} className="w-full h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold disabled:opacity-50">
            {busy ? "Salvando..." : "Salvar nova senha e entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
