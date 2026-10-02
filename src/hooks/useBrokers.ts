import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface UseBrokersOptions {
  select?: string;
  includeInactive?: boolean;
  enabled?: boolean;
}

/**
 * Corretores visíveis para o usuário:
 * - admin / diretor → todos (todas as equipes)
 * - gerente (master) → só os da própria equipe (manager_id = gerente)
 * - corretor → vazio (não se aplica)
 */
export function useBrokers({
  select = "id,full_name,color,role,is_active,phone,email,setor",
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

      // gerente vê só a própria equipe; admin e diretor veem todas
      if (profile?.role === "master") {
        q = (q as any).eq("manager_id", profile.id);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
