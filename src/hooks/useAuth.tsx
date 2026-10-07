import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
  /** Conta de teste: invisível para os outros usuários; vê as funções em teste. */
  is_test?: boolean;
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
  /**
   * Vê as funções em teste: a conta de teste (em qualquer lugar) e o ADM
   * quando roda o sistema localmente (npm run dev).
   */
  isTester: boolean;
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

// Perfil e permissões da última sessão, guardados no aparelho para o app abrir
// na hora. São só para montar a tela: o banco confere tudo de novo em cada
// consulta, e os dados são atualizados em segundo plano logo depois.
const CACHE_KEY = "auth:profile-cache";
type Cached = { profile: Profile; levels: Levels | null };

function readCache(uid: string): Cached | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    return c?.profile?.id === uid ? c : null;
  } catch {
    return null;
  }
}
function writeCache(c: Cached | null) {
  try {
    if (c) window.localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    else window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* storage indisponível */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // null = matriz ainda não carregada (ou migration não aplicada): usa o padrão do tipo de cargo
  const [levels, setLevels] = useState<Levels | null>(null);
  const [loading, setLoading] = useState(true);

  // perfil + cargo + permissões em uma única consulta
  const fetchProfile = async (uid: string) => {
    const { data, error } = await (supabase as any)
      .from("profiles")
      .select("*, cargo:cargos(name, cargo_permissions(module, level))")
      .eq("id", uid)
      .maybeSingle();
    if (error) {
      // banco sem a tabela de cargos (migration antiga): só o perfil
      const plain = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
      if (plain.error) console.error("Failed to load profile:", plain.error);
      return plain.data ? { ...(plain.data as object), cargo: null } : null;
    }
    return data;
  };

  // evita carregar o mesmo perfil duas vezes ao mesmo tempo (o Supabase avisa
  // a sessão inicial por dois caminhos)
  const inFlight = useRef<{ uid: string; promise: Promise<void> } | null>(null);
  const loadProfile = (uid: string): Promise<void> => {
    if (inFlight.current?.uid === uid) return inFlight.current.promise;
    const promise = (async () => {
      const row = (await fetchProfile(uid)) as
        | (Omit<Profile, "cargo_name"> & {
            cargo_id?: string | null;
            cargo?: { name: string; cargo_permissions: { module: string; level: string }[] } | null;
          })
        | null;
      if (!row) {
        setProfile(null);
        setLevels(null);
        writeCache(null);
        return;
      }
      const { cargo, ...base } = row;
      let loaded: Levels | null = null;
      if (cargo?.cargo_permissions) {
        loaded = {};
        for (const p of cargo.cargo_permissions)
          loaded[p.module as ModuleKey] = p.level as PermissionLevel;
      }
      const next: Profile = {
        ...(base as Omit<Profile, "cargo_name">),
        cargo_id: base.cargo_id ?? null,
        cargo_name: cargo?.name ?? null,
      };
      setProfile(next);
      setLevels(loaded);
      writeCache({ profile: next, levels: loaded });
    })().finally(() => {
      if (inFlight.current?.promise === promise) inFlight.current = null;
    });
    inFlight.current = { uid, promise };
    return promise;
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) {
        setTimeout(() => loadProfile(s.user.id), 0);
      } else {
        setProfile(null);
        setLevels(null);
        writeCache(null);
      }
    });
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      const uid = data.session?.user?.id;
      if (uid) {
        const cached = readCache(uid);
        if (cached) {
          // abre na hora com os dados guardados e atualiza em segundo plano
          setProfile(cached.profile);
          setLevels(cached.levels);
          setLoading(false);
          void loadProfile(uid);
          return;
        }
        await loadProfile(uid);
      }
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    isTester: profile?.is_test === true || (import.meta.env.DEV && isSuperAdmin),
    level,
    can,
    canSeeCheckinLog: isSuperAdmin || profile?.role === "hr",
    signOut: async () => {
      writeCache(null);
      await supabase.auth.signOut();
    },
    refreshProfile: async () => { if (session?.user) await loadProfile(session.user.id); },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
