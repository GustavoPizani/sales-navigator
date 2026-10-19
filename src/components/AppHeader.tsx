import { useEffect, type ReactNode } from "react";
import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Settings, LogOut } from "lucide-react";
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
  const { isAdmin, isSuperAdmin, signOut, profile } = useAuth();
  useEffect(() => {
    document.title = `${title} — ${profile?.full_name ?? "Sales Navigator"}`;
  }, [title, profile?.full_name]);

  return (
    <header className="relative bg-[var(--navy)] text-white safe-top sticky top-0 z-30 shadow-sm lg:shadow-none">
      {/* desktop: canto côncavo que liga o cabeçalho à sidebar */}
      <span
        aria-hidden
        className="app-frame-corner pointer-events-none absolute left-0 top-full hidden lg:block"
      />
      <div className="px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {left ?? <BackButton />}
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        <div className="flex items-center gap-0.5">
          {right}
          {/* no desktop "Sair" e "Minha conta" ficam na sidebar */}
          <div className="flex items-center gap-0.5 lg:hidden">
            <button
              onClick={signOut}
              className="p-2 text-white/70 hover:text-white rounded-lg transition-colors"
              aria-label="Sair"
            >
              <LogOut size={20} />
            </button>
            <SettingsMenu isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} />
          </div>
        </div>
      </div>
    </header>
  );
}

/** Volta para a página anterior do app (só aparece quando há uma). */
function BackButton() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  if (!canGoBack) return null;
  return (
    <button
      type="button"
      onClick={() => router.history.back()}
      className="-ml-2 h-10 w-10 inline-flex items-center justify-center rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
      aria-label="Voltar para a página anterior"
      title="Voltar"
    >
      <ArrowLeft size={20} />
    </button>
  );
}

function SettingsMenu({ isAdmin, isSuperAdmin }: { isAdmin: boolean; isSuperAdmin: boolean }) {
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
