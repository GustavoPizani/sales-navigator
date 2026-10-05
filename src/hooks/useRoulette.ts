import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type RouletteSettings = Database["public"]["Tables"]["roulette_settings"]["Row"];
export type RouletteCheckin = Database["public"]["Tables"]["roulette_checkins"]["Row"];
export type CheckinStatus =
  "validated" | "standby" | "allocated" | "waiting_admin" | "not_allocated";
export type RouletteLocation = "central" | "plantao";

export const LOCATION_LABEL: Record<RouletteLocation, string> = {
  central: "Central",
  plantao: "Plantão",
};

// Cores dos locais no mapa (paleta P&G)
export const LOCATION_COLOR: Record<RouletteLocation, string> = {
  central: "#2D2D2D",
  plantao: "#B28069",
};

export const STATUS_INFO: Record<
  CheckinStatus,
  { label: string; className: string; color: string }
> = {
  validated: { label: "Validado", className: "bg-green-100 text-green-700", color: "#16A34A" },
  allocated: { label: "Alocado", className: "bg-green-100 text-green-700", color: "#16A34A" },
  standby: { label: "Stand-by", className: "bg-amber-100 text-amber-800", color: "#D97706" },
  waiting_admin: {
    label: "Aguardando admin",
    className: "bg-orange-100 text-orange-700",
    color: "#EA580C",
  },
  not_allocated: {
    label: "Fora da roleta",
    className: "bg-gray-100 text-gray-600",
    color: "#6B7280",
  },
};

/** Local de uma vaga pela modalidade da escala. */
export const locationOfModality = (modality: string | null | undefined): RouletteLocation =>
  modality === "salao" ? "plantao" : "central";

export const hhmm = (t: string) => t.slice(0, 5);

export function useRouletteSettings() {
  return useQuery({
    queryKey: ["roulette-settings"],
    staleTime: 60_000,
    queryFn: async (): Promise<RouletteSettings | null> => {
      const { data, error } = await supabase
        .from("roulette_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** Lê a posição atual com alta precisão (GPS). */
export function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Este dispositivo não oferece localização."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? "Permita o acesso à localização para fazer o check-in."
            : err.code === err.TIMEOUT
              ? "Não foi possível obter o GPS a tempo. Tente de novo."
              : "Não foi possível obter sua localização.";
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}

/**
 * Fechamento do check-in em texto. tolerance_min negativo = fecha antes do
 * início (ex.: -5 → "5 min antes do início").
 */
export function closeLabel(toleranceMin: number) {
  if (toleranceMin === 0) return "no início do turno";
  return toleranceMin < 0
    ? `${-toleranceMin} min antes do início`
    : `${toleranceMin} min depois do início`;
}

/** Horário (local) em que o turno é processado: início + tolerância. */
export function allocationTime(turnDate: string, startTime: string, toleranceMin: number) {
  const d = new Date(`${turnDate}T${hhmm(startTime)}:00`);
  return new Date(d.getTime() + toleranceMin * 60_000);
}

export function checkinOpensAt(turnDate: string, startTime: string, openBeforeMin: number) {
  const d = new Date(`${turnDate}T${hhmm(startTime)}:00`);
  return new Date(d.getTime() - openBeforeMin * 60_000);
}

/**
 * Nomes dos 2 PDVs: "Central" e "Plantão <produto>" (produto escolhido nas
 * regras de check-in).
 */
export function usePdvLabels(): Record<RouletteLocation, string> {
  const settingsQ = useRouletteSettings();
  const projectId = settingsQ.data?.plantao_project_id;
  const projectQ = useQuery({
    queryKey: ["pdv-project", projectId],
    enabled: !!projectId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("projects")
        .select("id,name")
        .eq("id", projectId!)
        .maybeSingle();
      return data;
    },
  });
  return {
    central: "Central",
    plantao: projectQ.data?.name ? `Plantão ${projectQ.data.name}` : "Plantão",
  };
}

export type ShiftPeriodKey = "manha" | "tarde" | "noite";
export type ShiftPeriod = { key: ShiftPeriodKey; label: string; start: string; end: string };

export const DEFAULT_SHIFT_PERIODS: ShiftPeriod[] = [
  { key: "manha", label: "Manhã", start: "09:00", end: "14:00" },
  { key: "tarde", label: "Tarde", start: "14:00", end: "19:00" },
  { key: "noite", label: "Noite", start: "19:00", end: "23:00" },
];

/** Horário dos 3 turnos, definido pelo admin nas regras de check-in. */
export function useShiftPeriods(): ShiftPeriod[] {
  const s = useRouletteSettings().data;
  return DEFAULT_SHIFT_PERIODS.map((p) => ({
    ...p,
    start: s?.[`${p.key}_start`] ? hhmm(s[`${p.key}_start`]) : p.start,
    end: s?.[`${p.key}_end`] ? hhmm(s[`${p.key}_end`]) : p.end,
  }));
}
