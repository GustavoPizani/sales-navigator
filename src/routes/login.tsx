import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AuthSplash } from "@/components/AuthSplash";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const glassCard: React.CSSProperties = {
  background: "rgba(30, 30, 30, 0.6)",
  backdropFilter: "blur(23px)",
  WebkitBackdropFilter: "blur(23px)",
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(255,255,255,0.04)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 48,
  paddingLeft: 16,
  paddingRight: 16,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 12,
  color: "white",
  fontSize: 15,
  outline: "none",
  transition: "border-color 0.15s",
};

function LoginPage() {
  const nav = useNavigate();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => setHasUsers((count ?? 0) > 0));
  }, []);

  useEffect(() => {
    if (!loading && session) {
      // volta para a página que a pessoa tentou abrir antes do login (ex.: QR do check-in)
      let target: string | null = null;
      try {
        target = window.sessionStorage.getItem("post-login-redirect");
        window.sessionStorage.removeItem("post-login-redirect");
      } catch {
        /* storage indisponível */
      }
      if (target && target.startsWith("/") && !target.startsWith("//")) window.location.replace(target);
      else nav({ to: "/dashboard", replace: true });
    }
  }, [session, loading, nav]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin },
        });
        if (err) throw err;
        toast.success("Conta criada. Você é o administrador!");
      } else {
        // senha copiada do WhatsApp costuma vir com espaço no fim
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password: password.trim(),
        });
        if (err) throw err;
      }
    } catch (err: any) {
      const msg: string = err.message || "";
      setError(
        /invalid login credentials/i.test(msg)
          ? "E-mail ou senha incorretos. Confira a senha (letras maiúsculas e minúsculas contam)."
          : /email not confirmed/i.test(msg)
            ? "E-mail ainda não confirmado. Fale com o seu gestor."
            : msg || "Falha na autenticação",
      );
    } finally {
      setBusy(false);
    }
  };

  const canSignup = hasUsers === false;

  // Sessão salva ainda sendo conferida, ou já logado (indo para o app): não
  // mostra o formulário, para o login não "piscar" a cada abertura.
  if (loading || session) return <AuthSplash />;

  return (
    <div className="h-screen overflow-hidden flex relative" style={{ background: "#1E1E1E", color: "white" }}>
      {/* Background glows */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute rounded-full" style={{ top: "-15%", left: "-10%", width: "60%", height: "60%", background: "radial-gradient(circle, rgba(178,128,105,0.08) 0%, transparent 70%)", filter: "blur(140px)" }} />
        <div className="absolute rounded-full" style={{ bottom: "-10%", right: "-5%", width: "40%", height: "40%", background: "radial-gradient(circle, rgba(45,45,45,0.6) 0%, transparent 70%)", filter: "blur(100px)" }} />
      </div>

      {/* LEFT — branding (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-24 relative z-10">
        <div style={{ marginBottom: 40 }}>
          {/* logo original é grafite; o filtro deixa branco sobre o fundo escuro */}
          <img
            src="/logo-paes-gregori.webp"
            alt="Paes & Gregori"
            style={{ width: "min(420px, 100%)", height: "auto", filter: "brightness(0) invert(1)", display: "block" }}
          />
          <h1 style={{ fontSize: "clamp(1.4rem, 2vw, 1.9rem)", fontWeight: 300, letterSpacing: "0.32em", lineHeight: 1.2, margin: "22px 0 0", textTransform: "uppercase", color: "#B28069" }}>
            Gestão Comercial
          </h1>
          <div style={{ height: 2, width: 64, background: "#B28069", marginTop: 16 }} />
        </div>
        <p style={{ fontSize: 20, color: "#A8A8A8", maxWidth: 400, lineHeight: 1.6, fontWeight: 300 }}>
          A plataforma de gestão para{" "}
          <span style={{ color: "white", fontWeight: 500 }}>corretores de alta performance</span>.
          Organize sua equipe com inteligência.
        </p>
      </div>

      {/* RIGHT — form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center lg:justify-end lg:pr-20 px-6 relative z-10 overflow-y-auto">
        <div style={{ width: "100%", maxWidth: 448, paddingTop: 32, paddingBottom: 32 }}>
          <div style={{ ...glassCard, padding: "40px 40px" }}>

            {/* no desktop o logo já aparece no painel da esquerda */}
            <img src="/logo-paes-gregori.webp" alt="Paes & Gregori" className="block lg:hidden" style={{ width: 200, height: "auto", filter: "brightness(0) invert(1)", marginBottom: 28 }} />
            <div style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 32, fontWeight: 700, color: "white", letterSpacing: "-0.02em", margin: "0 0 8px" }}>
                {mode === "signup" ? "Criar conta" : "Acessar conta"}
              </h2>
              <p style={{ color: "#989898", fontSize: 14, margin: 0 }}>
                {mode === "signup" ? "Configure sua conta para começar" : "Insira suas credenciais para entrar"}
              </p>
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {mode === "signup" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, color: "#DEDEDE" }}>Nome completo</label>
                  <input style={inputStyle} placeholder="Seu nome" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: "#DEDEDE" }}>E-mail</label>
                <input
                  type="email" autoComplete="email" required style={inputStyle} placeholder="seu@email.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(178,128,105,0.6)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: "#DEDEDE" }}>Senha</label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    required minLength={6} style={{ ...inputStyle, paddingRight: 48 }} placeholder="••••••••"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(178,128,105,0.6)")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                  />
                  <button type="button" tabIndex={-1} onClick={() => setShowPassword(!showPassword)}
                    style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#989898", padding: 0, display: "flex" }}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {error && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, borderRadius: 12, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", padding: "12px 16px", fontSize: 13, color: "#f87171" }}>
                  <span>⚠</span> {error}
                </div>
              )}

              <button type="submit" disabled={busy}
                style={{ width: "100%", height: 52, background: busy ? "rgba(178,128,105,0.55)" : "#B28069", color: "#2D2D2D", borderRadius: 12, fontWeight: 700, fontSize: 16, border: "none", cursor: busy ? "not-allowed" : "pointer", transition: "background 0.15s, box-shadow 0.15s", boxShadow: busy ? "none" : "0 0 25px rgba(178,128,105,0.2)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 }}
                onMouseEnter={(e) => { if (!busy) (e.currentTarget as HTMLButtonElement).style.background = "#C4957F"; }}
                onMouseLeave={(e) => { if (!busy) (e.currentTarget as HTMLButtonElement).style.background = "#B28069"; }}
              >
                {busy ? <><Loader2 size={18} className="animate-spin" /> Validando...</> : mode === "signup" ? "Criar conta de admin" : "Entrar"}
              </button>
            </form>

            <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 20 }}>
              {mode === "login" && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#989898", cursor: "pointer" }}>
                    <input type="checkbox" style={{ accentColor: "#B28069", width: 15, height: 15 }} />
                    Lembrar acesso
                  </label>
                  <a href="#" onClick={(e) => e.preventDefault()} style={{ color: "#B28069", textDecoration: "none", fontWeight: 500 }}>
                    Esqueceu a senha?
                  </a>
                </div>
              )}

              <div style={{ padding: "16px 20px", background: "rgba(178,128,105,0.05)", border: "1px solid rgba(178,128,105,0.12)", borderRadius: 16, display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#B28069", marginTop: 4, flexShrink: 0 }} />
                <p style={{ fontSize: 12, color: "#989898", lineHeight: 1.6, margin: 0 }}>
                  <span style={{ color: "#B28069", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Suporte:</span>
                  <br />Caso não tenha suas credenciais, solicite ao seu gestor imediato.
                </p>
              </div>

              {canSignup && mode === "signup" && (
                <button onClick={() => setMode("login")}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#989898", fontSize: 13, textAlign: "center", width: "100%" }}>
                  ← Voltar ao login
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
