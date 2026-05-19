import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Detect if there's any profile (admin already exists) — anyone can read active profiles
    supabase.from("profiles").select("id", { count: "exact", head: true })
      .then(({ count }) => setHasUsers((count ?? 0) > 0));
  }, []);

  useEffect(() => {
    if (!loading && session) nav({ to: "/my-day", replace: true });
  }, [session, loading, nav]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created. You're the admin!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      toast.error(err.message || "Authentication failed");
    } finally { setBusy(false); }
  };

  const canSignup = hasUsers === false; // only first user can self-signup

  return (
    <div className="min-h-screen bg-[var(--navy)] text-white flex flex-col">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-[var(--gold)] text-[var(--navy)] text-3xl font-extrabold mb-4">GC</div>
            <h1 className="text-2xl font-bold">Gestão Comercial</h1>
            <p className="text-white/60 text-sm mt-1">Sales team management</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <input className="w-full h-12 px-4 rounded-xl bg-white/10 placeholder-white/50 border border-white/15 focus:outline-none focus:border-[var(--gold)]"
                placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            )}
            <input type="email" autoComplete="email" required
              className="w-full h-12 px-4 rounded-xl bg-white/10 placeholder-white/50 border border-white/15 focus:outline-none focus:border-[var(--gold)]"
              placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={8}
              className="w-full h-12 px-4 rounded-xl bg-white/10 placeholder-white/50 border border-white/15 focus:outline-none focus:border-[var(--gold)]"
              placeholder="Password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="submit" disabled={busy}
              className="w-full h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-semibold disabled:opacity-60">
              {busy ? "Please wait…" : mode === "signup" ? "Create admin account" : "Sign in"}
            </button>
          </form>
          {canSignup && (
            <button onClick={() => setMode(mode === "login" ? "signup" : "login")}
              className="w-full mt-4 text-sm text-white/70 hover:text-white">
              {mode === "login" ? "First time? Create the admin account →" : "← Back to sign in"}
            </button>
          )}
          {hasUsers && (
            <p className="text-xs text-white/50 text-center mt-6">
              Broker accounts are created by your admin from inside the app.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
