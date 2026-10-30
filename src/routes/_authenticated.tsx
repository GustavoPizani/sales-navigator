import { createFileRoute, Navigate, Outlet, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import toast from "react-hot-toast";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { AuthSplash } from "@/components/AuthSplash";
import { BottomNav } from "@/components/BottomNav";
import { Sidebar } from "@/components/Sidebar";
import { PushSubscriber } from "@/components/PushSubscriber";
import { ConfirmarVisitas } from "@/components/ConfirmarVisitas";
import { CheckinAlerts } from "@/components/CheckinAlerts";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { session, profile, loading, refreshProfile } = useAuth();
  if (loading) return <AuthSplash />;
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

// Desktop: trilho de ícones à esquerda, que abre ao passar o mouse por cima
// do conteúdo (o conteúdo não se desloca). Celular: barra inferior.
function AppShell() {
  const { isTester, isSuperAdmin, profile } = useAuth();
  const { pathname } = useLocation();
  // A Análise Hypnobox é um subsistema em tela cheia, com menu próprio (só o
  // ADM; o leitor a vê dentro do layout normal, com as seções na sidebar do sistema).
  if (isSuperAdmin && pathname.startsWith("/hypnobox"))
    return (
      <>
        <PushSubscriber />
        <CheckinAlerts />
        <Outlet />
      </>
    );
  return (
    <div className="min-h-screen bg-[var(--surface)]">
      {isTester && (
        <div className="fixed bottom-2 left-1/2 -translate-x-1/2 z-[80] pointer-events-none rounded-full bg-fuchsia-600 px-3 py-1 text-[11px] font-bold text-white shadow-lg">
          {profile?.is_test
            ? `CONTA DE TESTE · ${profile?.cargo_name ?? profile?.role}`
            : "MODO TESTE (LOCAL)"}
        </div>
      )}
      <PushSubscriber />
      {/* admin: aviso de cada check-in */}
      <CheckinAlerts />
      <Sidebar />
      <div className="min-w-0 transition-[padding] duration-200 ease-out motion-reduce:transition-none lg:pl-[var(--sidebar-w,4.75rem)]">
        <Outlet />
      </div>
      {/* depois do horário de uma visita: aconteceu ou não? */}
      <ConfirmarVisitas />
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
        <h2 className="text-xl font-semibold text-[var(--navy)]">
          Não foi possível carregar seu perfil
        </h2>
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

/** Erro do login (Supabase) em português, com o que a pessoa pode fazer. */
function erroDeSenha(error: { message?: string; code?: string }) {
  const msg = (error.message ?? "").toLowerCase();
  const code = error.code ?? "";
  if (code === "same_password" || msg.includes("different from the old"))
    return "A nova senha precisa ser diferente da senha provisória que você recebeu.";
  if (code === "weak_password" || msg.includes("password should"))
    return "Senha fraca: use pelo menos 6 caracteres, misturando letras e números.";
  if (code === "reauthentication_needed" || msg.includes("reauthentication"))
    return "Por segurança, saia e entre de novo com a senha provisória antes de trocar.";
  if (code === "session_not_found" || msg.includes("session missing") || msg.includes("jwt"))
    return "Sua sessão expirou. Saia e entre de novo com a senha provisória.";
  if (msg.includes("failed to fetch") || msg.includes("network"))
    return "Sem conexão com a internet. Confira o sinal e tente de novo.";
  return "Não foi possível trocar a senha agora. Tente de novo em instantes.";
}

function ForcePasswordChange() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (password.length < 6) return setErro("A senha deve ter no mínimo 6 caracteres.");
    if (password !== confirm) return setErro("As duas senhas não são iguais.");

    setBusy(true);
    const { error } = await supabase.auth.updateUser({
      password,
      data: { force_password_change: false },
    });
    if (error) {
      setBusy(false);
      // o código técnico fica no console para o suporte; a pessoa vê a explicação
      console.error("[troca de senha]", error.code, error.message);
      return setErro(erroDeSenha(error));
    }
    // garante que a sessão salva já venha sem a marca de "trocar senha"
    await supabase.auth.refreshSession().catch(() => {});
    toast.success("Senha atualizada!");
    window.location.reload();
  };

  const sair = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen bg-[var(--surface)] grid place-items-center p-4 safe-top safe-bottom">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-border w-full max-w-sm">
        <h2 className="text-xl font-bold text-[var(--navy)] mb-2">Trocar senha</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Como este é o seu primeiro acesso, por segurança defina uma senha nova, diferente da
          provisória.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label
              htmlFor="nova-senha"
              className="text-xs font-medium text-muted-foreground mb-1 block"
            >
              Nova senha
            </label>
            <div className="relative">
              <input
                id="nova-senha"
                name="new-password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={6}
                className="w-full h-12 px-4 pr-12 rounded-xl bg-[var(--surface)] border border-border text-base"
                placeholder="Mínimo de 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Esconder senha" : "Mostrar senha"}
                className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 inline-flex items-center justify-center text-muted-foreground"
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <div>
            <label
              htmlFor="confirma-senha"
              className="text-xs font-medium text-muted-foreground mb-1 block"
            >
              Repita a nova senha
            </label>
            <input
              id="confirma-senha"
              name="confirm-new-password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              required
              className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-base"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {erro && (
            <p
              role="alert"
              className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2"
            >
              {erro}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold disabled:opacity-50"
          >
            {busy ? "Salvando..." : "Salvar nova senha e entrar"}
          </button>
          <button
            type="button"
            onClick={sair}
            className="w-full h-10 text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Sair e entrar de novo
          </button>
        </form>
      </div>
    </div>
  );
}
