import { Link, useLocation } from "@tanstack/react-router";
import { BarChart, Calendar, CalendarDays, Building2, Users, ClipboardList, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useFeatures } from "@/hooks/useFeatures";

type Tab = { to: string; label: string; icon: React.ElementType };

const adminTabs: Tab[] = [
  { to: "/dashboard", label: "Dashboard", icon: BarChart },
  { to: "/schedule",   label: "Escala",       icon: Calendar },
  { to: "/calendar",   label: "Agendamentos",  icon: CalendarDays },
  { to: "/projects",   label: "Imóveis",       icon: Building2 },
  { to: "/sales",      label: "Vendas",        icon: TrendingUp },
  { to: "/team",       label: "Time",          icon: Users },
];

const directorTabs: Tab[] = [
  { to: "/dashboard", label: "Dashboard",    icon: BarChart },
  { to: "/schedule",   label: "Escala",       icon: Calendar },
  { to: "/calendar",   label: "Agendamentos", icon: CalendarDays },
  { to: "/sales",      label: "Vendas",       icon: TrendingUp },
  { to: "/team",       label: "Time",         icon: Users },
];

const brokerTabs: Tab[] = [
  { to: "/dashboard",    label: "Dashboard",    icon: BarChart },
  { to: "/schedule",     label: "Minha Escala", icon: Calendar },
  { to: "/appointments", label: "Agendamentos", icon: ClipboardList },
  { to: "/projects",     label: "Imóveis",      icon: Building2 },
];

function filterTabs(tabs: Tab[], isFeatureEnabled: (k: any) => boolean, isBroker: boolean, setor: string | undefined): Tab[] {
  return tabs.filter((t) => {
    // Escala só aparece para corretores do setor Online — gestores/diretores
    // enxergam a escala do time inteiro, então não são filtrados pelo próprio setor.
    if (t.to === "/schedule")     return isFeatureEnabled("schedule") && (!isBroker || setor === "Online");
    if (t.to === "/calendar")     return isFeatureEnabled("agendamentos");
    if (t.to === "/appointments") return isFeatureEnabled("agendamentos");
    if (t.to === "/projects")     return isFeatureEnabled("projects");
    if (t.to === "/sales")        return isFeatureEnabled("sales");
    if (t.to === "/team")         return isFeatureEnabled("team");
    return true;
  });
}

export function BottomNav() {
  const { isAdmin, isDirector, profile } = useAuth();
  const { isFeatureEnabled } = useFeatures();
  const loc = useLocation();

  const baseTabs = isAdmin ? adminTabs : isDirector ? directorTabs : brokerTabs;
  const tabs = filterTabs(baseTabs, isFeatureEnabled, !isAdmin && !isDirector, profile?.setor);

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-[var(--navy)] text-white safe-bottom shadow-[0_-2px_12px_rgba(0,0,0,0.15)]">
      <ul className="flex justify-around items-stretch h-16 px-1">
        {tabs.map((t) => {
          const active = loc.pathname.startsWith(t.to);
          const Icon = t.icon;
          return (
            <li key={t.to} className="flex-1">
              <Link
                to={t.to}
                className={`flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium transition-colors ${
                  active ? "text-[var(--gold)]" : "text-white/70"
                }`}
              >
                <Icon size={22} strokeWidth={active ? 2.4 : 2} />
                <span>{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
