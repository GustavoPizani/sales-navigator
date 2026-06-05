import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar, CalendarDays, Building2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type FeatureKey = "schedule" | "agendamentos" | "projects" | "team";

export type FeaturesMap = Record<FeatureKey, boolean>;

export const FEATURE_DEFS: {
  key: FeatureKey;
  label: string;
  description: string;
  icon: React.ElementType;
  adminOnly?: boolean;
}[] = [
  {
    key: "schedule",
    label: "Escala",
    description: "Escala de plantão e turnos da equipe",
    icon: Calendar,
  },
  {
    key: "agendamentos",
    label: "Agendamentos",
    description: "Agenda de visitas e compromissos com clientes",
    icon: CalendarDays,
  },
  {
    key: "projects",
    label: "Imóveis",
    description: "Catálogo de projetos e imóveis disponíveis",
    icon: Building2,
  },
  {
    key: "team",
    label: "Time",
    description: "Gestão de equipe, corretores e performance",
    icon: Users,
    adminOnly: true,
  },
];

const DEFAULT_FEATURES: FeaturesMap = {
  schedule: true,
  agendamentos: true,
  projects: true,
  team: true,
};

export function useFeatures() {
  const { profile, isAdmin, refreshProfile } = useAuth();
  const qc = useQueryClient();

  // Brokers fetch their manager's feature config
  const managerQ = useQuery({
    queryKey: ["manager-features", profile?.manager_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("enabled_features")
        .eq("id", profile!.manager_id!)
        .maybeSingle();
      return ((data as any)?.enabled_features ?? null) as FeaturesMap | null;
    },
    enabled: !!profile?.manager_id && !isAdmin,
    staleTime: 60_000,
  });

  const rawFeatures: FeaturesMap = isAdmin
    ? { ...DEFAULT_FEATURES, ...((profile as any)?.enabled_features ?? {}) }
    : { ...DEFAULT_FEATURES, ...(managerQ.data ?? {}) };

  const saveFeatures = useMutation({
    mutationFn: async (features: FeaturesMap) => {
      const { error } = await supabase
        .from("profiles")
        .update({ enabled_features: features } as any)
        .eq("id", profile!.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      // Refresh the auth profile so features update immediately in the entire app
      await refreshProfile();
      qc.invalidateQueries({ queryKey: ["manager-features"] });
    },
  });

  return {
    features: rawFeatures,
    isFeatureEnabled: (key: FeatureKey) => rawFeatures[key] ?? true,
    saveFeatures,
  };
}
