import {
  BarChart,
  Calendar,
  CalendarDays,
  ChartNoAxesCombined,
  Building2,
  Users,
  ClipboardList,
  GraduationCap,
  MapPinCheck,
  MessageCircle,
  ScrollText,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useExtensaoNoMenu } from "@/components/extensao/comum";

export type NavTab = {
  to: string;
  label: string;
  icon: React.ElementType;
  /** Fica fora da barra do celular. */
  sidebarOnly?: boolean;
  /** Em teste: tarja vermelha BETA no menu. */
  beta?: boolean;
  /** Subitens (abas da tela), mostrados na sidebar quando o item está aberto. */
  subs?: { grupo: string; itens: { label: string; tab?: string }[] }[];
};

/** Seções do Dashboard Hypnobox (abas do painel), para a sidebar do leitor (sem Atendimentos). */
export const SECOES_HYPNOBOX: NonNullable<NavTab["subs"]> = [
  {
    grupo: "Dashboard",
    itens: [
      { label: "Gráficos" },
      { label: "Desempenho por Corretor", tab: "corretores" },
      { label: "Vendas", tab: "vendas" },
    ],
  },
  {
    grupo: "Agendamentos",
    itens: [
      { label: "Agendamentos", tab: "agenda" },
      { label: "Relatório de visitas", tab: "visitas" },
    ],
  },
  {
    grupo: "Campanhas",
    itens: [
      { label: "Conversão por campanha", tab: "campanhas" },
      { label: "Mídia LEN", tab: "midia" },
      { label: "Mídia paga", tab: "pago" },
      { label: "LEN x Hypnobox", tab: "comparacao" },
    ],
  },
];

/**
 * Abas da navegação (barra do celular e sidebar), montadas pela matriz de
 * permissões do cargo: módulo oculto não aparece no menu (e a rota é bloqueada
 * pelo RequireModule).
 */
export function useNavTabs(): NavTab[] {
  const { profile, can, isSuperAdmin, isHr } = useAuth();
  // o ADM pode tirar a extensão do menu (chave em Minha conta)
  const extensaoNoMenu = useExtensaoNoMenu();
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
  if (can("training"))
    tabs.push({ to: "/treinamentos", label: "Treinamentos", icon: GraduationCap });
  if (can("team") && managesTeam) tabs.push({ to: "/team", label: "Time", icon: Users });
  // extensão do WhatsApp (substitui o WAHA para os corretores)
  if (extensaoNoMenu)
    tabs.push({ to: "/extensao", label: "Extensão WhatsApp", icon: MessageCircle, beta: true });
  // RH: o log de check-ins é a tela principal (o ADM acessa pelo menu "Geral")
  if (isHr && !isSuperAdmin)
    tabs.push({ to: "/checkin-log", label: "Log de check-ins", icon: ScrollText });
  // subsistema com navegação própria, no menu do desktop: o ADM e quem tem o
  // módulo "Dashboard Hypnobox" na matriz. Para o leitor é a tela inicial.
  if (isSuperAdmin || can("analise")) {
    const analise: NavTab = {
      to: "/hypnobox",
      label: "Dashboard Hypnobox",
      icon: ChartNoAxesCombined,
      sidebarOnly: true,
    };
    // o leitor vê o painel dentro do layout normal: as seções ficam na sidebar
    if (profile.role === "viewer") tabs.unshift({ ...analise, subs: SECOES_HYPNOBOX });
    else tabs.push(analise);
  }
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
  viewer: "Leitor",
};
