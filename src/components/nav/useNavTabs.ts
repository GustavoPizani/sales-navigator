import {
  BarChart,
  Calendar,
  CalendarDays,
  Building2,
  Users,
  ClipboardList,
  MapPinCheck,  ScrollText,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export type NavTab = { to: string; label: string; icon: React.ElementType };

/**
 * Abas da navegação (barra do celular e sidebar), montadas pela matriz de
 * permissões do cargo: módulo oculto não aparece no menu (e a rota é bloqueada
 * pelo RequireModule).
 */
export function useNavTabs(): NavTab[] {
  const { profile, can, isSuperAdmin, isHr } = useAuth();
  if (!profile) return [];
  const isBroker = profile.role === "broker";
  const managesTeam =
    profile.role === "admin" || profile.role === "director" || profile.role === "master";

  const tabs: NavTab[] = [];
  // o Dashboard também abriga os Atendimentos (leads); para o corretor a tela
  // abre nos clientes dele, então o menu diz "Clientes"
  if (can("dashboard") || can("leads"))
    tabs.push({
      to: "/dashboard",
      label: isBroker && can("leads") ? "Clientes" : "Dashboard",
      icon: isBroker && can("leads") ? Users : BarChart,
    });
  if (can("schedule"))
    tabs.push({ to: "/schedule", label: isBroker ? "Minha Escala" : "Escala", icon: Calendar });
  if (can("checkin")) tabs.push({ to: "/checkin", label: "Check-in", icon: MapPinCheck });
  if (can("appointments"))
    tabs.push(
      isBroker
        ? { to: "/appointments", label: "Agendamentos", icon: ClipboardList }
        : { to: "/calendar", label: "Agendamentos", icon: CalendarDays },
    );
  if (can("projects")) tabs.push({ to: "/projects", label: "Imóveis", icon: Building2 });
  if (can("team") && managesTeam) tabs.push({ to: "/team", label: "Time", icon: Users });  // RH: o log de check-ins é a tela principal (o ADM acessa pelo menu "Geral")
  if (isHr && !isSuperAdmin)
    tabs.push({ to: "/checkin-log", label: "Log de check-ins", icon: ScrollText });
  return tabs;
}

/** Primeira tela que o usuário pode abrir (destino após o login). */
export function useHomePath(): string {
  const tabs = useNavTabs();
  return tabs[0]?.to ?? "/settings/profile";
}

/** A página do lead pertence à área de atendimentos do Dashboard. */
export function isTabActive(tab: NavTab, pathname: string) {
  if (tab.to === "/dashboard" && pathname.startsWith("/leads/")) return true;
  return pathname.startsWith(tab.to);
}

export const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  director: "Diretor",
  master: "Gerente",
  broker: "Corretor",
  hr: "RH",
};
