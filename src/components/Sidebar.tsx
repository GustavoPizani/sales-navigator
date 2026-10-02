import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ChevronsLeft, ChevronsRight, LogOut, ScrollText, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS, isTabActive, useNavTabs, type NavTab } from "@/components/nav/useNavTabs";

export const SIDEBAR_WIDTH = { expanded: "16rem", collapsed: "4.75rem" };

/**
 * Navegação do desktop (no celular é a BottomNav). Colada à esquerda, com a
 * mesma cor e altura do cabeçalho (AppHeader): os dois formam uma moldura em
 * "L" que abraça o conteúdo. Recolhível: aberta mostra rótulos e perfil;
 * recolhida vira um trilho de ícones.
 */
export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const tabs = useNavTabs();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { profile, signOut, isSuperAdmin } = useAuth();

  return (
    <aside
      className="app-sidebar hidden lg:flex fixed left-0 top-0 bottom-0 z-40 flex-col text-white overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.65,0,0.35,1)]"
      style={{ width: collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded }}
      aria-label="Navegação principal"
    >
      {/* Cabeçalho */}
      <div
        className={`flex h-14 flex-shrink-0 items-center gap-2 ${collapsed ? "justify-center px-2" : "px-4"}`}
      >
        {!collapsed && (
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--gold)] to-[var(--gold-dark)] text-[13px] font-bold tracking-tight">
            P&amp;G
          </div>
        )}
        <div
          className={`min-w-0 flex-1 transition-opacity duration-200 ${collapsed ? "hidden" : "opacity-100"}`}
        >
          <p className="truncate text-sm font-semibold leading-tight">Paes &amp; Gregori</p>
          <p className="truncate text-[11px] uppercase tracking-[0.18em] text-white/45">
            Gestão Comercial
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pt-2">
        <SectionLabel collapsed={collapsed}>Menu</SectionLabel>
        <ul className="space-y-1">
          {tabs.map((t) => (
            <SidebarItem
              key={t.to}
              tab={t}
              active={isTabActive(t, pathname)}
              collapsed={collapsed}
            />
          ))}
        </ul>
      </nav>

      <div className="px-3 pb-4">
        <SectionLabel collapsed={collapsed}>Geral</SectionLabel>
        {profile && (
          <ProfileCard
            name={profile.full_name}
            role={ROLE_LABELS[profile.role] ?? profile.role}
            color={profile.color}
            avatarUrl={profile.avatar_url}
            active={pathname.startsWith("/settings/profile")}
            collapsed={collapsed}
          />
        )}
        <ul className="mt-1 space-y-1">
          {isSuperAdmin && (
            <>
              <SidebarItem
                tab={{ to: "/checkin-log", label: "Log de check-ins", icon: ScrollText }}
                active={pathname.startsWith("/checkin-log")}
                collapsed={collapsed}
              />
              <SidebarItem
                tab={{ to: "/settings/permissions", label: "Permissões", icon: ShieldCheck }}
                active={pathname.startsWith("/settings/permissions")}
                collapsed={collapsed}
              />
            </>
          )}
          <li>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                navigate({ to: "/login" });
              }}
              className={`group flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-white/65 transition-all duration-200 hover:bg-white/[0.06] hover:text-white ${collapsed ? "justify-center px-0" : ""}`}
              title={collapsed ? "Sair" : undefined}
            >
              <LogOut size={18} className="flex-shrink-0" />
              {!collapsed && <span className="truncate">Sair</span>}
            </button>
          </li>
        </ul>
      </div>
    </aside>
  );
}

function SectionLabel({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
  return collapsed ? (
    <div className="mx-auto my-3 h-px w-6 bg-white/15" aria-hidden />
  ) : (
    <p className="mb-2 mt-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">
      {children}
    </p>
  );
}

function SidebarItem({
  tab,
  active,
  collapsed,
}: {
  tab: NavTab;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = tab.icon;
  return (
    <li>
      <Link
        to={tab.to}
        aria-current={active ? "page" : undefined}
        title={collapsed ? tab.label : undefined}
        className={`group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-all duration-200 ${
          collapsed ? "justify-center px-0" : ""
        } ${
          active
            ? "bg-gradient-to-r from-[var(--gold)] to-[var(--gold-dark)] font-semibold text-white shadow-[0_6px_18px_rgba(178,128,105,0.35)]"
            : "text-white/65 hover:translate-x-0.5 hover:bg-white/[0.06] hover:text-white"
        }`}
      >
        <Icon size={18} strokeWidth={active ? 2.4 : 2} className="flex-shrink-0" />
        {!collapsed && <span className="truncate">{tab.label}</span>}
      </Link>
    </li>
  );
}

/**
 * Cartão do usuário (abre Minha conta). Inspirado em "premium profile card":
 * faixa diagonal cobre atrás da foto, anel branco, cargo em etiqueta.
 */
function ProfileCard({
  name,
  role,
  color,
  avatarUrl,
  active,
  collapsed,
}: {
  name: string;
  role: string;
  color: string;
  avatarUrl: string | null;
  active: boolean;
  collapsed: boolean;
}) {
  if (collapsed) {
    return (
      <Link
        to="/settings/profile"
        title={`${name} — Minha conta`}
        className="mb-2 flex justify-center rounded-xl py-1.5 transition-transform duration-200 hover:-translate-y-0.5"
      >
        <span
          className={`rounded-full p-[2px] ${active ? "bg-white" : "bg-gradient-to-br from-[var(--gold)] to-[var(--gold-dark)]"}`}
        >
          <Avatar
            name={name}
            color={color}
            src={avatarUrl}
            size={38}
            className="ring-2 ring-[#262626]"
          />
        </span>
      </Link>
    );
  }
  return (
    <Link
      to="/settings/profile"
      className={`group relative mb-2 flex items-center gap-3 overflow-hidden rounded-2xl border p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(0,0,0,0.35)] ${
        active
          ? "border-[var(--gold)]/60 bg-white/[0.08]"
          : "border-white/10 bg-white/[0.05] hover:border-[var(--gold)]/40"
      }`}
    >
      {/* faixa diagonal em gradiente cobre atrás da foto */}
      <span
        aria-hidden
        className="absolute -left-6 -top-4 -bottom-4 w-[4.6rem] -skew-x-12 bg-gradient-to-b from-[var(--gold)] to-[var(--gold-dark)] opacity-90 transition-[width] duration-300 group-hover:w-[5.2rem]"
      />
      <span className="relative flex-shrink-0 rounded-full shadow-[0_4px_14px_rgba(0,0,0,0.35)] ring-[3px] ring-white/90">
        <Avatar name={name} color={color} src={avatarUrl} size={44} />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold leading-tight">{name}</span>
        <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/75">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--gold)]" />
          <span className="truncate">{role}</span>
        </span>
        <span className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-[var(--gold)]">
          Minha conta
          <ArrowRight
            size={12}
            className="transition-transform duration-200 group-hover:translate-x-1"
          />
        </span>
      </span>
    </Link>
  );
}
