import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface UseBrokersOptions {
  select?: string;
  includeInactive?: boolean;
  enabled?: boolean;
}

/**
 * Returns brokers scoped to the current user:
 * - director → all brokers (visão global)
 * - master / admin (manager) → only brokers where manager_id = profile.id
 * - broker → empty (not applicable)
 */
export function useBrokers({
  select = "id,full_name,color,role,is_active,phone,email",
  includeInactive = false,
  enabled = true,
}: UseBrokersOptions = {}) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["brokers-active", profile?.id, profile?.role, includeInactive],
    enabled: enabled && !!profile && (profile.role === "admin" || profile.role === "master" || profile.role === "director"),
    queryFn: async () => {
      let q = supabase
        .from("profiles")
        .select(select)
        .eq("role", "broker")
        .order("full_name");

      if (!includeInactive) {
        q = q.eq("is_active", true);
      }

      // master e admin (gerentes) veem apenas sua própria equipe; director vê todos
      if (profile?.role === "admin" || profile?.role === "master") {
        q = (q as any).eq("manager_id", profile.id);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
