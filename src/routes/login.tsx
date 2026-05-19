import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 48,
  paddingLeft: 16,
  paddingRight: 16,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 12,
  color: "white",
  fontSize: 15,
  outline: "none",
};

const features = [
  "Escala do time organizada",
  "Agendamentos com clientes",
  "Visão completa do gestor",
];

function LoginPage() {
  const nav = useNavigate();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        toast.success("Conta criada. Você é o administrador!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
    } catch (err: any) {
      toast.error(err.message || "Falha na autenticação");
    } finally {
      setBusy(false);
    }
  };

  const canSignup = hasUsers === false;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0B1120",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background glow — deep blue, top-left */}
      <div
        style={{
          position: "absolute",
          top: "-20%",
          left: "-10%",
          width: "55%",
          height: "65%",
          background:
            "radial-gradient(circle, rgba(26,58,110,0.20) 0%, transparent 70%)",
          filter: "blur(80px)",
          pointerEvents: "none",
        }}
      />
      {/* Background glow — gold, bottom-right */}
      <div
        style={{
          position: "absolute",
          bottom: "-10%",
          right: "-10%",
          width: "35%",
          height: "45%",
          background:
            "radial-gradient(circle, rgba(201,168,76,0.05) 0%, transparent 70%)",
          filter: "blur(100px)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 10,
          minHeight: "100vh",
          display: "flex",
          flexWrap: "wrap",
        }}
      >
        {/* ── LEFT COLUMN — branding ── */}
        <div
          style={{
            width: "100%",
            padding: "40px 32px 24px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
          className="md:w-1/2 md:min-h-screen md:p-16"
        >
          <div>
            {/* Pill badge */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "5px 14px",
                borderRadius: 999,
                border: "1px solid rgba(201,168,76,0.35)",
                background: "rgba(201,168,76,0.08)",
                color: "#C9A84C",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.02em",
                marginBottom: 28,
              }}
            >
              Gestão de Times Comerciais
            </div>

            {/* Main heading */}
            <h1
              style={{
                fontSize: "clamp(2.6rem, 5.5vw, 3.75rem)",
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: "-0.025em",
                color: "white",
                margin: 0,
              }}
            >
              Gestão de equipes
              <br />
              <span style={{ color: "#C9A84C" }}>Setin</span>
            </h1>

            {/* Description */}
            <p style={{ color: "#94a3b8", fontSize: 15, marginTop: 16, lineHeight: 1.6 }}>
              Plataforma de gestão para corretores de alta performance.
            </p>

            {/* Feature list */}
            <ul style={{ listStyle: "none", padding: 0, margin: "24px 0 0" }}>
              {features.map((text) => (
                <li
                  key={text}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    color: "#94a3b8",
                    fontSize: 14,
                    marginBottom: 12,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#C9A84C",
                      flexShrink: 0,
                    }}
                  />
                  {text}
                </li>
              ))}
            </ul>
          </div>

          {/* Copyright */}
          <p
            style={{
              color: "#475569",
              fontSize: 12,
              marginTop: 40,
            }}
          >
            © 2025 Gestão de equipes Setin
          </p>
        </div>

        {/* ── RIGHT COLUMN — form ── */}
        <div
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px 24px 40px",
          }}
          className="md:w-1/2 md:p-16 md:min-h-screen"
        >
          <div style={{ width: "100%", maxWidth: 440 }}>
            {/* Glassmorphism card */}
            <div
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 24,
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                padding: 40,
              }}
            >
              {/* Card heading */}
              <h2
                style={{
                  color: "white",
                  fontSize: 22,
                  fontWeight: 700,
                  margin: "0 0 4px",
                }}
              >
                {mode === "signup"
                  ? "Criar conta de administrador"
                  : "Bem-vindo de volta"}
              </h2>
              <p style={{ color: "#94a3b8", fontSize: 14, margin: "0 0 24px" }}>
                {mode === "signup"
                  ? "Configure sua conta para começar"
                  : "Acesse sua conta para continuar"}
              </p>

              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Full name — signup only */}
                {mode === "signup" && (
                  <input
                    style={inputStyle}
                    placeholder="Nome completo"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                )}

                {/* Email */}
                <input
                  type="email"
                  autoComplete="email"
                  required
                  style={inputStyle}
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />

                {/* Password with show/hide */}
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete={
                      mode === "signup" ? "new-password" : "current-password"
                    }
                    required
                  minLength={6}
                    style={{ ...inputStyle, paddingRight: 48 }}
                  placeholder="••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: "absolute",
                      right: 14,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "#64748b",
                      padding: 0,
                      display: "flex",
                    }}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                {/* Remember + Forgot — login mode only */}
                {mode === "login" && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "#94a3b8",
                        fontSize: 14,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                        style={{
                          accentColor: "#C9A84C",
                          width: 16,
                          height: 16,
                        }}
                      />
                      Lembrar acesso
                    </label>
                    <a
                      href="#"
                      onClick={(e) => e.preventDefault()}
                      style={{
                        color: "#C9A84C",
                        fontSize: 14,
                        textDecoration: "none",
                      }}
                    >
                      Esqueceu a senha?
                    </a>
                  </div>
                )}

                {/* Primary button */}
                <button
                  type="submit"
                  disabled={busy}
                  style={{
                    width: "100%",
                    height: 52,
                    background: busy ? "rgba(201,168,76,0.6)" : "#C9A84C",
                    color: "#0C2340",
                    borderRadius: 12,
                    fontWeight: 700,
                    fontSize: 16,
                    border: "none",
                    cursor: busy ? "not-allowed" : "pointer",
                    transition: "background 0.15s",
                    marginTop: 4,
                  }}
                  onMouseEnter={(e) => {
                    if (!busy)
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "#d4b45c";
                  }}
                  onMouseLeave={(e) => {
                    if (!busy)
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "#C9A84C";
                  }}
                >
                  {busy
                    ? "Aguarde…"
                    : mode === "signup"
                    ? "Criar conta de admin"
                    : "Entrar"}
                </button>
              </form>

              {/* Info box */}
              <div
                style={{
                  marginTop: 20,
                  padding: "12px 16px",
                  borderRadius: 12,
                  background: "rgba(59,130,246,0.08)",
                  border: "1px solid rgba(59,130,246,0.2)",
                  color: "#94a3b8",
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                Não tem acesso? Solicite ao seu gestor.
              </div>

              {/* First-user signup toggle */}
              {canSignup && (
                <button
                  onClick={() =>
                    setMode(mode === "login" ? "signup" : "login")
                  }
                  style={{
                    width: "100%",
                    marginTop: 14,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#94a3b8",
                    fontSize: 13,
                    textAlign: "center",
                  }}
                >
                  {mode === "login"
                    ? "Primeira vez? Criar conta de administrador →"
                    : "← Voltar ao login"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
