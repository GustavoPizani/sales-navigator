import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const glassCard: React.CSSProperties = {
  background: "rgba(9, 21, 32, 0.55)",
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
    if (!loading && session) nav({ to: "/dashboard", replace: true });
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
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
    } catch (err: any) {
      setError(err.message || "Falha na autenticação");
    } finally {
      setBusy(false);
    }
  };

  const canSignup = hasUsers === false;

  return (
    <div className="h-screen overflow-hidden flex relative" style={{ background: "#020617", color: "white" }}>
      {/* Background glows */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute rounded-full" style={{ top: "-15%", left: "-10%", width: "60%", height: "60%", background: "radial-gradient(circle, rgba(201,168,76,0.08) 0%, transparent 70%)", filter: "blur(140px)" }} />
        <div className="absolute rounded-full" style={{ bottom: "-10%", right: "-5%", width: "40%", height: "40%", background: "radial-gradient(circle, rgba(15,23,42,0.6) 0%, transparent 70%)", filter: "blur(100px)" }} />
      </div>

      {/* LEFT — branding (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-24 relative z-10">
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: "clamp(2.8rem, 4vw, 4rem)", fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1, margin: 0, textTransform: "uppercase", fontStyle: "italic" }}>
            Gestão de<br />
            <span style={{ color: "#C9A84C" }}>Equipes Setin</span>
          </h1>
          <div style={{ height: 6, width: 80, background: "#C9A84C", borderRadius: 999, marginTop: 14 }} />
        </div>
        <p style={{ fontSize: 20, color: "#94a3b8", maxWidth: 400, lineHeight: 1.6, fontWeight: 300 }}>
          A plataforma de gestão para{" "}
          <span style={{ color: "white", fontWeight: 500 }}>corretores de alta performance</span>.
          Organize sua equipe com inteligência.
        </p>
      </div>

      {/* RIGHT — form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center lg:justify-end lg:pr-20 px-6 relative z-10 overflow-y-auto">
        <div style={{ width: "100%", maxWidth: 448, paddingTop: 32, paddingBottom: 32 }}>
          <div style={{ ...glassCard, padding: "40px 40px" }}>

            <div style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 32, fontWeight: 700, color: "white", letterSpacing: "-0.02em", margin: "0 0 8px" }}>
                {mode === "signup" ? "Criar conta" : "Acessar conta"}
              </h2>
              <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>
                {mode === "signup" ? "Configure sua conta para começar" : "Insira suas credenciais para entrar"}
              </p>
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {mode === "signup" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, color: "#cbd5e1" }}>Nome completo</label>
                  <input style={inputStyle} placeholder="Seu nome" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: "#cbd5e1" }}>E-mail</label>
                <input
                  type="email" autoComplete="email" required style={inputStyle} placeholder="seu@email.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,168,76,0.6)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: "#cbd5e1" }}>Senha</label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    required minLength={6} style={{ ...inputStyle, paddingRight: 48 }} placeholder="••••••••"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,168,76,0.6)")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                  />
                  <button type="button" tabIndex={-1} onClick={() => setShowPassword(!showPassword)}
                    style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 0, display: "flex" }}>
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
                style={{ width: "100%", height: 52, background: busy ? "rgba(201,168,76,0.55)" : "#C9A84C", color: "#0C2340", borderRadius: 12, fontWeight: 700, fontSize: 16, border: "none", cursor: busy ? "not-allowed" : "pointer", transition: "background 0.15s, box-shadow 0.15s", boxShadow: busy ? "none" : "0 0 25px rgba(201,168,76,0.2)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 }}
                onMouseEnter={(e) => { if (!busy) (e.currentTarget as HTMLButtonElement).style.background = "#d4b45c"; }}
                onMouseLeave={(e) => { if (!busy) (e.currentTarget as HTMLButtonElement).style.background = "#C9A84C"; }}
              >
                {busy ? <><Loader2 size={18} className="animate-spin" /> Validando...</> : mode === "signup" ? "Criar conta de admin" : "Entrar"}
              </button>
            </form>

            <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 20 }}>
              {mode === "login" && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#64748b", cursor: "pointer" }}>
                    <input type="checkbox" style={{ accentColor: "#C9A84C", width: 15, height: 15 }} />
                    Lembrar acesso
                  </label>
                  <a href="#" onClick={(e) => e.preventDefault()} style={{ color: "#C9A84C", textDecoration: "none", fontWeight: 500 }}>
                    Esqueceu a senha?
                  </a>
                </div>
              )}

              <div style={{ padding: "16px 20px", background: "rgba(201,168,76,0.05)", border: "1px solid rgba(201,168,76,0.12)", borderRadius: 16, display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#C9A84C", marginTop: 4, flexShrink: 0 }} />
                <p style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, margin: 0 }}>
                  <span style={{ color: "#C9A84C", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Suporte:</span>
                  <br />Caso não tenha suas credenciais, solicite ao seu gestor imediato.
                </p>
              </div>

              {canSignup && mode === "signup" && (
                <button onClick={() => setMode("login")}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: 13, textAlign: "center", width: "100%" }}>
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
