import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_LEVELS, type ModuleKey, type PermissionLevel } from "@/lib/modules";

export type AppRole = "admin" | "broker" | "director" | "master" | "hr";
export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: AppRole;
  phone: string | null;
  color: string;
  is_active: boolean;
  manager_id: string | null;
  setor: "Online" | "Salão";
  enabled_features: Record<string, boolean> | null;
  reminder_minutes: number[];
  shift_reminder_time: string | null;
  avatar_url: string | null;
  team_name: string | null;
  cargo_id: string | null;
  /** Nome do cargo (ADM, RH, Gestor, Corretor ou um cargo criado pelo ADM). */
  cargo_name: string | null;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  isDirector: boolean;
  isMaster: boolean;
  /** Admin geral (vê todas as equipes; único que altera permissões). */
  isSuperAdmin: boolean;
  /** Gerente de equipe (role 'master'). */
  isManager: boolean;
  /** RH: acessa o log de check-ins e os módulos liberados pelo ADM. */
  isHr: boolean;
  /** Nível do usuário no módulo, pela matriz de permissões do cargo. */
  level: (module: ModuleKey) => PermissionLevel;
  /** O usuário alcança o nível mínimo no módulo? */
  can: (module: ModuleKey, min?: "view" | "edit") => boolean;
  /** Log de check-ins: fixo para ADM e RH (fora da matriz). */
  canSeeCheckinLog: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type Levels = Partial<Record<ModuleKey, PermissionLevel>>;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // null = matriz ainda não carregada (ou migration não aplicada): usa o padrão do tipo de cargo
  const [levels, setLevels] = useState<Levels | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (uid: string) => {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    if (error) console.error("Failed to load profile:", error);
    const base = (data as (Omit<Profile, "cargo_name"> & { cargo_id?: string | null }) | null) ?? null;
    if (!base) {
      setProfile(null);
      setLevels(null);
      return;
    }
    let cargoName: string | null = null;
    let loaded: Levels | null = null;
    if (base.cargo_id) {
      const [{ data: cargo }, { data: perms, error: pErr }] = await Promise.all([
        supabase.from("cargos").select("name").eq("id", base.cargo_id).maybeSingle(),
        supabase.from("cargo_permissions").select("module, level").eq("cargo_id", base.cargo_id),
      ]);
      cargoName = cargo?.name ?? null;
      if (!pErr && perms) {
        loaded = {};
        for (const p of perms) loaded[p.module as ModuleKey] = p.level as PermissionLevel;
      }
    }
    setProfile({ ...base, cargo_id: base.cargo_id ?? null, cargo_name: cargoName });
    setLevels(loaded);
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) {
        setTimeout(() => loadProfile(s.user.id), 0);
      } else {
        setProfile(null);
        setLevels(null);
      }
    });
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) await loadProfile(data.session.user.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const isSuperAdmin = profile?.role === "admin" || profile?.role === "director";

  const level = (module: ModuleKey): PermissionLevel => {
    if (!profile) return "hidden";
    if (isSuperAdmin) return "edit"; // ADM tem sempre acesso total
    if (levels) return levels[module] ?? "hidden";
    return DEFAULT_LEVELS[profile.role]?.[module] ?? "hidden";
  };
  const can = (module: ModuleKey, min: "view" | "edit" = "view") => {
    const l = level(module);
    return l === "edit" || (l === "view" && min === "view");
  };

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    isAdmin: profile?.role === "admin" || profile?.role === "master",
    isDirector: profile?.role === "director",
    isMaster: profile?.role === "master",
    isSuperAdmin,
    isManager: profile?.role === "master",
    isHr: profile?.role === "hr",
    level,
    can,
    canSeeCheckinLog: isSuperAdmin || profile?.role === "hr",
    signOut: async () => { await supabase.auth.signOut(); },
    refreshProfile: async () => { if (session?.user) await loadProfile(session.user.id); },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
