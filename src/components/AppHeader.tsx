import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Settings, LogOut } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useAuth } from "@/hooks/useAuth";

export function AppHeader({
  title,
  left,
  right,
}: {
  title: string;
  left?: ReactNode;
  right?: ReactNode;
}) {
  const { isAdmin, signOut, profile } = useAuth();
  useEffect(() => {
    document.title = `${title} — ${profile?.full_name ?? "Sales Navigator"}`;
  }, [title, profile?.full_name]);

  return (
    <header className="bg-[var(--navy)] text-white safe-top sticky top-0 z-30 shadow-sm">
      <div className="px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {left}
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        <div className="flex items-center gap-0.5">
          {right}
          <button
            onClick={signOut}
            className="p-2 text-white/70 hover:text-white rounded-lg transition-colors"
            aria-label="Sair"
          >
            <LogOut size={20} />
          </button>
          <SettingsMenu isAdmin={isAdmin} />
        </div>
      </div>
    </header>
  );
}

function SettingsMenu({ isAdmin }: { isAdmin: boolean }) {
  const navigate = useNavigate();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="p-2 text-white/70 hover:text-white rounded-lg transition-colors"
          aria-label="Configurações"
        >
          <Settings size={20} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          style={{ zIndex: 999 }}
          className="bg-white rounded-2xl shadow-2xl border border-border py-1.5 min-w-[190px] text-[var(--navy)]"
        >
          <DropdownMenu.Item
            className="flex items-center px-4 py-2.5 text-sm font-medium hover:bg-[var(--surface)] cursor-pointer outline-none select-none rounded-lg mx-1"
            onSelect={() => navigate({ to: "/settings/profile" })}
          >
            Minha Conta
          </DropdownMenu.Item>
          {isAdmin && (
            <DropdownMenu.Item
              className="flex items-center px-4 py-2.5 text-sm font-medium hover:bg-[var(--surface)] cursor-pointer outline-none select-none rounded-lg mx-1"
              onSelect={() => navigate({ to: "/team" })}
            >
              Gestão de Equipe
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
