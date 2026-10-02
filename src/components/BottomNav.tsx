import { useEffect, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { isTabActive, useNavTabs } from "@/components/nav/useNavTabs";

/**
 * Navegação do celular (no desktop a navegação é a Sidebar).
 * Barra escura em pílula; a aba ativa fica numa "ondulação" que sobe acima da
 * barra, com contorno cobre brilhante, e desliza até a aba tocada.
 */
export function BottomNav() {
  const tabs = useNavTabs();
  const { pathname } = useLocation();
  // A ondulação desliza já no toque (antes de a rota terminar de carregar),
  // para a troca de aba parecer imediata.
  const [pendingTo, setPendingTo] = useState<string | null>(null);
  useEffect(() => setPendingTo(null), [pathname]);
  const routeIndex = tabs.findIndex((t) => isTabActive(t, pathname));
  const pendingIndex = pendingTo ? tabs.findIndex((t) => t.to === pendingTo) : -1;
  const activeIndex = pendingIndex >= 0 ? pendingIndex : routeIndex;
  const n = Math.max(tabs.length, 1);
  // Nas abas das pontas a linha não se estende para o lado do canto arredondado.
  const neonPath =
    (activeIndex <= 0 ? "M0,24" : "M-30,24 L0,24") +
    " C18,24 26,1.5 50,1.5 C74,1.5 82,24 100,24" +
    (activeIndex === n - 1 ? "" : " L130,24");

  return (
    <nav
      className="lg:hidden fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+0.6rem)] pointer-events-none"
      aria-label="Navegação principal"
    >
      <div className="bump-nav relative pointer-events-auto mx-auto max-w-xl h-16 rounded-[28px]">
        {/* recorte lateral: a linha neon não passa das pontas arredondadas da barra */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [clip-path:inset(-40px_0_-12px_0_round_28px)]"
        >
          {/* Indicador deslizante: ondulação + brilho, ocupa a largura de uma aba.
              As abas ficam afastadas das pontas (px-5) para a ondulação da
              primeira/última aba não invadir o canto arredondado. */}
          <div className="absolute inset-y-0 inset-x-5">
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.65,0,0.35,1)]"
              style={{
                width: `${100 / n}%`,
                transform: `translateX(${Math.max(activeIndex, 0) * 100}%)`,
                opacity: activeIndex < 0 ? 0 : 1,
              }}
            >
              {/* ondulação + linha neon que continua pela borda da barra e se apaga nas pontas */}
              <svg
                className="bump-nav__bump absolute left-1/2 -translate-x-1/2 -top-[23px] w-[112px] h-[26px] overflow-visible"
                viewBox="-30 0 160 24"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient
                    id="bump-neon"
                    gradientUnits="userSpaceOnUse"
                    x1="-30"
                    y1="0"
                    x2="130"
                    y2="0"
                  >
                    <stop offset="0" stopColor="var(--gold)" stopOpacity="0" />
                    <stop offset="0.25" stopColor="var(--gold)" stopOpacity="1" />
                    <stop offset="0.75" stopColor="var(--gold)" stopOpacity="1" />
                    <stop offset="1" stopColor="var(--gold)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {/* preenchimento na cor da barra, cobrindo a borda superior */}
                <path
                  d="M0,24.6 C18,24.6 26,1.5 50,1.5 C74,1.5 82,24.6 100,24.6 Z"
                  fill="var(--bump-bar)"
                />
                <path
                  d={neonPath}
                  fill="none"
                  stroke="url(#bump-neon)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <span className="bump-nav__glow absolute bottom-0 left-1/2 -translate-x-1/2 h-px w-1/2 rounded-full" />
            </div>
          </div>
        </div>

        <ul className="relative flex h-full items-stretch px-5">
          {tabs.map((t, i) => {
            const active = i === activeIndex;
            const Icon = t.icon;
            return (
              <li key={t.to} className="flex-1 min-w-0">
                <Link
                  to={t.to}
                  aria-current={i === routeIndex ? "page" : undefined}
                  onClick={() => setPendingTo(t.to)}
                  className="flex h-full flex-col items-center justify-center gap-1 select-none [-webkit-tap-highlight-color:transparent]"
                >
                  <Icon
                    size={21}
                    strokeWidth={active ? 2.4 : 1.9}
                    className={`transition-all duration-300 ease-out ${
                      active
                        ? "-translate-y-[18px] text-[var(--gold)] drop-shadow-[0_0_6px_rgba(178,128,105,0.7)]"
                        : "text-white/85"
                    }`}
                  />
                  <span
                    className={`max-w-full truncate px-0.5 text-[10px] font-semibold transition-all duration-300 ${
                      active ? "-translate-y-2.5 text-[var(--gold)]" : "text-white/60"
                    }`}
                  >
                    {t.label}
                  </span>
                  <span
                    className={`h-1 w-1 rounded-full bg-[var(--gold)] transition-all duration-300 ${
                      active ? "-translate-y-2.5 opacity-100" : "opacity-0"
                    }`}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
