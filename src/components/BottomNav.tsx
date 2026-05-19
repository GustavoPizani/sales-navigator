import { Link, useLocation } from "@tanstack/react-router";
import { Sun, Calendar, CalendarDays, Building2, Users, ClipboardList } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const adminTabs = [
  { to: "/my-day", label: "My Day", icon: Sun },
  { to: "/schedule", label: "Schedule", icon: Calendar },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/projects", label: "Projects", icon: Building2 },
  { to: "/team", label: "Team", icon: Users },
] as const;

const brokerTabs = [
  { to: "/my-day", label: "My Day", icon: Sun },
  { to: "/schedule", label: "My Schedule", icon: Calendar },
  { to: "/appointments", label: "Appointments", icon: ClipboardList },
] as const;

export function BottomNav() {
  const { isAdmin } = useAuth();
  const loc = useLocation();
  const tabs = isAdmin ? adminTabs : brokerTabs;
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
