import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Check } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/cadastro")({
  component: CadastroPage,
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

function CadastroPage() {
  const nav = useNavigate();
  const search = Route.useSearch() as Record<string, string>;
  const managerId = search.m ?? null;

  const [managerName, setManagerName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.body.style.backgroundColor = "#020617";
    return () => { document.body.style.backgroundColor = ""; };
  }, []);

  useEffect(() => {
    if (!managerId) return;
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", managerId)
      .maybeSingle()
      .then(({ data }) => setManagerName(data?.full_name ?? null));
  }, [managerId]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    if (!managerId) {
      setError("Link de convite inválido. Solicite um novo link ao seu gerente.");
      return;
    }

    setBusy(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name, role: "broker", phone: phone || null, manager_id: managerId },
          emailRedirectTo: window.location.origin,
        },
      });
      if (signUpError) throw signUpError;

      if (data.user && data.session) {
        // Email confirmation is disabled — session is live, update the profile the trigger created
        await (supabase.from("profiles") as any).update({
          full_name: name,
          phone: phone || null,
          role: "broker",
          manager_id: managerId,
          is_active: true,
          color: "#C9A84C",
        }).eq("id", data.user.id);
        // Sign out so broker doesn't enter the app before manager activates them
        await supabase.auth.signOut();
      }

      toast.success("Conta criada com sucesso!");
      setDone(true);
    } catch (err: any) {
      setError(err.message || "Erro ao criar conta.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="h-screen overflow-hidden flex items-center justify-center relative" style={{ background: "#020617", color: "white" }}>
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute rounded-full" style={{ top: "-15%", left: "-10%", width: "60%", height: "60%", background: "radial-gradient(circle, rgba(201,168,76,0.08) 0%, transparent 70%)", filter: "blur(140px)" }} />
        </div>
        <div style={{ ...glassCard, padding: "48px 40px", maxWidth: 420, width: "100%", margin: "0 24px", textAlign: "center", position: "relative", zIndex: 10 }}>
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(201,168,76,0.15)", border: "2px solid rgba(201,168,76,0.4)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
            <Check size={36} color="#C9A84C" />
          </div>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: "white", letterSpacing: "-0.02em", margin: "0 0 12px" }}>Cadastro realizado!</h2>
          <p style={{ color: "#94a3b8", fontSize: 15, lineHeight: 1.6, margin: "0 0 32px" }}>
            Sua conta foi criada com sucesso.{managerName ? ` Você está vinculado à equipe de ${managerName}.` : ""} Aguarde a confirmação do gestor para acessar o sistema.
          </p>
          <button
            onClick={() => nav({ to: "/login" })}
            style={{ width: "100%", height: 52, background: "#C9A84C", color: "#0C2340", borderRadius: 12, fontWeight: 700, fontSize: 16, border: "none", cursor: "pointer" }}
          >
            Ir para o login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative px-4 py-8" style={{ background: "#020617", color: "white" }}>
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute rounded-full" style={{ top: "-15%", left: "-10%", width: "60%", height: "60%", background: "radial-gradient(circle, rgba(201,168,76,0.08) 0%, transparent 70%)", filter: "blur(140px)" }} />
        <div className="absolute rounded-full" style={{ bottom: "-10%", right: "-5%", width: "40%", height: "40%", background: "radial-gradient(circle, rgba(15,23,42,0.6) 0%, transparent 70%)", filter: "blur(100px)" }} />
      </div>

      <div style={{ width: "100%", maxWidth: 448, position: "relative", zIndex: 10 }}>
        <div style={{ ...glassCard, padding: "40px 40px" }}>
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 30, fontWeight: 700, color: "white", letterSpacing: "-0.02em", margin: "0 0 8px" }}>
              Criar sua conta
            </h2>
            {managerId && managerName ? (
              <p style={{ color: "#94a3b8", fontSize: 14, margin: 0 }}>
                Você foi convidado por{" "}
                <span style={{ color: "#C9A84C", fontWeight: 600 }}>{managerName}</span>
              </p>
            ) : (
              <p style={{ color: "#94a3b8", fontSize: 14, margin: 0 }}>
                Preencha os dados abaixo para se cadastrar
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: "#cbd5e1" }}>Nome completo</label>
              <input
                style={inputStyle}
                placeholder="Seu nome completo"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,168,76,0.6)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: "#cbd5e1" }}>E-mail</label>
              <input
                type="email"
                autoComplete="email"
                required
                style={inputStyle}
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,168,76,0.6)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: "#cbd5e1" }}>Telefone (opcional)</label>
              <input
                type="tel"
                style={inputStyle}
                placeholder="+55 11 99999-9999"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,168,76,0.6)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: "#cbd5e1" }}>Senha</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  style={{ ...inputStyle, paddingRight: 48 }}
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,168,76,0.6)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                />
                <button type="button" tabIndex={-1} onClick={() => setShowPassword(!showPassword)}
                  style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 0, display: "flex" }}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: "#cbd5e1" }}>Confirmar senha</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  style={{ ...inputStyle, paddingRight: 48 }}
                  placeholder="Repita a senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,168,76,0.6)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                />
                <button type="button" tabIndex={-1} onClick={() => setShowConfirm(!showConfirm)}
                  style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 0, display: "flex" }}>
                  {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, borderRadius: 12, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", padding: "12px 16px", fontSize: 13, color: "#f87171" }}>
                <span>⚠</span> {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{ width: "100%", height: 52, background: busy ? "rgba(201,168,76,0.55)" : "#C9A84C", color: "#0C2340", borderRadius: 12, fontWeight: 700, fontSize: 16, border: "none", cursor: busy ? "not-allowed" : "pointer", transition: "background 0.15s, box-shadow 0.15s", boxShadow: busy ? "none" : "0 0 25px rgba(201,168,76,0.2)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 }}
              onMouseEnter={(e) => { if (!busy) (e.currentTarget as HTMLButtonElement).style.background = "#d4b45c"; }}
              onMouseLeave={(e) => { if (!busy) (e.currentTarget as HTMLButtonElement).style.background = "#C9A84C"; }}
            >
              {busy ? <><Loader2 size={18} className="animate-spin" /> Criando conta...</> : "Criar conta"}
            </button>
          </form>

          <div style={{ marginTop: 24, textAlign: "center" }}>
            <button
              onClick={() => nav({ to: "/login" })}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: 13 }}
            >
              Já tem uma conta? Entrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
