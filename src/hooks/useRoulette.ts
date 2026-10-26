import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type RouletteSettings = Database["public"]["Tables"]["roulette_settings"]["Row"];
export type RouletteCheckin = Database["public"]["Tables"]["roulette_checkins"]["Row"];
export type CheckinStatus =
  "validated" | "standby" | "allocated" | "waiting_admin" | "not_allocated";
export type RouletteLocation = "central" | "plantao";

// a Central deixou de existir: registros antigos com "central" aparecem como Plantão
export const LOCATION_LABEL: Record<RouletteLocation, string> = {
  central: "Plantão",
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

/** Erro de localização com o motivo do navegador (1 = permissão negada, 2 = indisponível, 3 = tempo esgotado). */
export class ErroLocalizacao extends Error {
  constructor(
    message: string,
    public code: number,
  ) {
    super(message);
  }
}

// tempo máximo esperando o GPS melhorar
const ESPERA_GPS_MS = 20_000;
// acima disso o celular está mandando só a localização aproximada (no Android
// e no iPhone a "aproximada" vem com ± 2 a 3 km): não adianta esperar
const APROXIMADA_M = 1500;

const MSG_APROXIMADA = (m: number) =>
  `Seu celular está mandando só a localização aproximada (± ${Math.round(m)} m), e o check-in precisa da exata. ` +
  'No Android: Configurações › Apps › Chrome › Permissões › Localização › ligue "Usar localização precisa". ' +
  'No iPhone: Ajustes › Privacidade e Segurança › Serviços de Localização › Safari (ou Chrome) › ligue "Localização Exata". ' +
  "Depois toque em Fazer check-in de novo.";

/**
 * Lê a posição atual acompanhando o sinal: a primeira leitura costuma vir da
 * rede (imprecisa) e o GPS melhora em alguns segundos. Fica com a melhor leitura
 * e para assim que ela chega à precisão pedida (ou em 20 s). A precisão aceita
 * no check-in é conferida de novo no servidor.
 * @param onProgresso recebe a melhor precisão até agora (metros), para a tela mostrar
 * @param precisaoAlvo para de esperar quando a precisão chega a esse valor
 */
export async function getPosition(
  onProgresso?: (precisaoM: number) => void,
  precisaoAlvo = 50,
): Promise<GeolocationPosition> {
  if (!("geolocation" in navigator)) {
    throw new ErroLocalizacao("Este dispositivo não oferece localização.", 2);
  }
  const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
    let melhor: GeolocationPosition | null = null;
    let fim = false;
    let ultimoErro = 2;
    const terminar = (fn: () => void) => {
      if (fim) return;
      fim = true;
      navigator.geolocation.clearWatch(id);
      clearTimeout(limite);
      clearTimeout(aproximada);
      fn();
    };
    // a localização aproximada não melhora esperando: em 8 s, se é só ela, explica logo
    const aproximada = setTimeout(() => {
      if (melhor && melhor.coords.accuracy >= APROXIMADA_M) terminar(() => resolve(melhor!));
    }, 8_000);
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (!melhor || p.coords.accuracy < melhor.coords.accuracy) melhor = p;
        onProgresso?.(melhor.coords.accuracy);
        if (melhor.coords.accuracy <= precisaoAlvo) terminar(() => resolve(melhor!));
      },
      (err) => {
        // sem permissão não adianta esperar; os outros erros o GPS costuma superar
        if (err.code === 1)
          terminar(() =>
            reject(new ErroLocalizacao("Permita o acesso à localização para fazer o check-in.", 1)),
          );
        else ultimoErro = err.code;
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: ESPERA_GPS_MS },
    );
    const limite = setTimeout(
      () =>
        terminar(() =>
          melhor
            ? resolve(melhor)
            : reject(
                new ErroLocalizacao(
                  ultimoErro === 3
                    ? "O GPS não respondeu a tempo. Vá para perto de uma janela ou área aberta e tente de novo."
                    : "Não foi possível obter sua localização. Confira se a Localização do celular está ligada e tente de novo.",
                  ultimoErro,
                ),
              ),
        ),
      ESPERA_GPS_MS,
    );
  });
  if (pos.coords.accuracy >= APROXIMADA_M)
    throw new ErroLocalizacao(MSG_APROXIMADA(pos.coords.accuracy), 4);
  return pos;
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
 * Nome do PDV: "Plantão <produto>" (produto escolhido nas regras de check-in).
 * Há um plantão só (o do 312 JAM); "central" mostra o mesmo nome, para registros
 * antigos e respostas que ainda tragam esse local.
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
  const plantao = projectQ.data?.name ? `Plantão ${projectQ.data.name}` : "Plantão";
  return { central: plantao, plantao };
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
