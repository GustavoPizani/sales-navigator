import { Link, Navigate } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { useHomePath } from "@/components/nav/useNavTabs";
import { useAuth } from "@/hooks/useAuth";
import type { ModuleKey } from "@/lib/modules";

/**
 * Bloqueio de rota pela matriz de permissões. Módulo oculto para o cargo:
 * a tela não abre nem pela URL (os dados também são bloqueados no banco).
 *
 * - modules: basta ter acesso a um deles
 * - adminOnly / checkinLog: telas de acesso fixo (fora da matriz)
 * - redirectHome: em vez de "sem permissão", leva à primeira tela permitida
 *   (usado no Dashboard, que é o destino padrão após o login)
 */
export function RequireModule({
  modules = [],
  min = "view",
  adminOnly = false,
  checkinLog = false,
  redirectHome = false,
  children,
}: {
  modules?: ModuleKey[];
  min?: "view" | "edit";
  adminOnly?: boolean;
  checkinLog?: boolean;
  redirectHome?: boolean;
  children: React.ReactNode;
}) {
  const { can, isSuperAdmin, canSeeCheckinLog } = useAuth();
  const home = useHomePath();

  const allowed = adminOnly
    ? isSuperAdmin
    : checkinLog
      ? canSeeCheckinLog
      : modules.some((m) => can(m, min));
  if (allowed) return <>{children}</>;

  if (redirectHome && home !== "/dashboard") return <Navigate to={home} replace />;
  return <NoAccess home={home} />;
}

export function NoAccess({ home }: { home: string }) {
  return (
    <div className="pb-nav">
      <AppHeader title="Sem permissão" />
      <div className="px-6 py-16 text-center max-w-md mx-auto">
        <div className="mx-auto h-14 w-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-4">
          <ShieldAlert size={28} />
        </div>
        <h2 className="text-lg font-bold text-[var(--navy)]">
          Você não tem permissão para acessar esta tela
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          O acesso a este módulo não está liberado para o seu cargo. Fale com o administrador se
          precisar dele.
        </p>
        <Link
          to={home}
          className="inline-flex mt-6 h-11 px-6 rounded-xl bg-[var(--navy)] text-white font-semibold items-center"
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
