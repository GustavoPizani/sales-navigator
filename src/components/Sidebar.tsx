import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, LogOut } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS, isTabActive, useNavTabs, type NavTab } from "@/components/nav/useNavTabs";

export const SIDEBAR_WIDTH = { expanded: "16rem", collapsed: "4.75rem" };

// Textos ficam sempre montados e só aparecem/somem por opacidade: ao abrir,
// nada muda de lugar (os ícones têm posição fixa), só a largura cresce.
const labelCls = (collapsed: boolean) =>
  `truncate transition-opacity duration-150 ${collapsed ? "opacity-0" : "opacity-100 delay-75"}`;

/**
 * Navegação do desktop (no celular é a BottomNav). Colada à esquerda, com a
 * mesma cor e altura do cabeçalho (AppHeader): os dois formam uma moldura em
 * "L" que abraça o conteúdo. Fica como um trilho de ícones e abre ao passar
 * o mouse (ou ao navegar por teclado), por cima do conteúdo, sem empurrá-lo.
 */
export function Sidebar() {
  const tabs = useNavTabs();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const collapsed = !open;
  const expand = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  // pequeno atraso ao sair, para não fechar em um deslize do mouse
  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 100);
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  return (
    <aside
      onMouseEnter={expand}
      onMouseLeave={scheduleClose}
      onFocus={expand}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) scheduleClose();
      }}
      className={`app-sidebar hidden lg:flex fixed left-0 top-0 bottom-0 z-40 flex-col text-white overflow-hidden will-change-[width] transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none ${
        open ? "shadow-[8px_0_32px_rgba(0,0,0,0.28)]" : ""
      }`}
      style={{ width: collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded }}
      aria-label="Navegação principal"
    >
      {/* Cabeçalho */}
      <div className="flex h-14 flex-shrink-0 items-center gap-2 pl-5 pr-4">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--gold)] to-[var(--gold-dark)] text-[13px] font-bold tracking-tight">
          P&amp;G
        </div>
        <div
          className={`min-w-0 flex-1 transition-opacity duration-150 ${collapsed ? "opacity-0" : "opacity-100 delay-75"}`}
        >
          <p className="truncate text-sm font-semibold leading-tight">Paes &amp; Gregori</p>
          <p className="truncate text-[11px] uppercase tracking-[0.18em] text-white/45">
            Gestão Comercial
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
          <li>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                navigate({ to: "/login" });
              }}
              className="group flex h-10 w-full items-center gap-3 rounded-lg pl-[17px] pr-3 text-sm text-white/65 transition-colors duration-150 hover:bg-white/[0.06] hover:text-white"
              title={collapsed ? "Sair" : undefined}
            >
              <LogOut size={18} className="flex-shrink-0" />
              <span className={labelCls(collapsed)}>Sair</span>
            </button>
          </li>
        </ul>
      </div>
    </aside>
  );
}

// Divisor (fechado) e título (aberto) ocupam a mesma altura, para a lista não pular.
function SectionLabel({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
  return (
    <div className="relative h-8">
      <div
        className={`absolute left-[14px] top-1/2 h-px w-6 bg-white/15 transition-opacity duration-150 ${collapsed ? "opacity-100" : "opacity-0"}`}
        aria-hidden
      />
      <p
        className={`absolute inset-x-3 top-1/2 -translate-y-1/2 truncate text-xs font-semibold uppercase tracking-[0.2em] text-white/35 transition-opacity duration-150 ${collapsed ? "opacity-0" : "opacity-100 delay-75"}`}
      >
        {children}
      </p>
    </div>
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
        className={`group relative flex h-10 items-center gap-3 rounded-lg pl-[17px] pr-3 text-sm transition-colors duration-150 ${
          active
            ? "bg-gradient-to-r from-[var(--gold)] to-[var(--gold-dark)] font-semibold text-white shadow-[0_6px_18px_rgba(178,128,105,0.35)]"
            : "text-white/65 hover:bg-white/[0.06] hover:text-white"
        }`}
      >
        <Icon size={18} strokeWidth={active ? 2.4 : 2} className="flex-shrink-0" />
        <span className={labelCls(collapsed)}>{tab.label}</span>
      </Link>
    </li>
  );
}

/**
 * Cartão do usuário (abre Minha conta). Inspirado em "premium profile card":
 * faixa diagonal cobre atrás da foto, anel branco, cargo em etiqueta. Fechado,
 * sobra só a foto, na mesma posição: o cartão aparece em volta dela ao abrir.
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
  const cardCls = collapsed
    ? "border-transparent bg-transparent"
    : active
      ? "border-[var(--gold)]/60 bg-white/[0.08]"
      : "border-white/10 bg-white/[0.05] hover:border-[var(--gold)]/40";
  return (
    <Link
      to="/settings/profile"
      title={collapsed ? `${name} — Minha conta` : undefined}
      className={`group relative mb-2 flex h-[4.75rem] items-center gap-3 overflow-hidden rounded-2xl border pl-[3px] pr-3 transition-colors duration-150 ${cardCls}`}
    >
      {/* faixa diagonal em gradiente cobre atrás da foto */}
      <span
        aria-hidden
        className={`absolute -left-6 -top-4 -bottom-4 w-[4.6rem] -skew-x-12 bg-gradient-to-b from-[var(--gold)] to-[var(--gold-dark)] transition-opacity duration-150 ${collapsed ? "opacity-0" : "opacity-90"}`}
      />
      <span
        className={`relative flex-shrink-0 rounded-full p-[2px] ${
          collapsed && !active
            ? "bg-gradient-to-br from-[var(--gold)] to-[var(--gold-dark)]"
            : "bg-white/90"
        }`}
      >
        <Avatar name={name} color={color} src={avatarUrl} size={40} />
      </span>
      <span
        className={`relative min-w-0 flex-1 transition-opacity duration-150 ${collapsed ? "opacity-0" : "opacity-100 delay-75"}`}
      >
        <span className="block truncate text-sm font-semibold leading-tight">{name}</span>
        <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-white/75">
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
