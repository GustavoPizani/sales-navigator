import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RequireModule } from "@/components/RequireModule";
import { ROLE_LABELS, useHomePath } from "@/components/nav/useNavTabs";
import { useAuth } from "@/hooks/useAuth";
import { getHypnoboxData } from "@/lib/hypnobox.functions";

// o painel (página + biblioteca de gráficos) só é baixado ao abrir esta tela
const HypnoboxFrame = lazy(() => import("@/components/hypnobox/HypnoboxFrame"));

// lead: ID do Hypnobox; numérico fica como número para o endereço sair ?lead=192822
type Search = { tab?: string; lead?: string | number };
const leadParam = (id: string) => (/^d+$/.test(id) ? Number(id) : id);

export const Route = createFileRoute("/_authenticated/hypnobox")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tab: typeof s.tab === "string" ? s.tab : undefined,
    lead: typeof s.lead === "string" || typeof s.lead === "number" ? s.lead : undefined,
  }),
  component: HypnoboxPageGuarded,
});

function HypnoboxPageGuarded() {
  return (
    <RequireModule adminOnly>
      <HypnoboxPage />
    </RequireModule>
  );
}

function HypnoboxPage() {
  const { profile } = useAuth();
  const home = useHomePath();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const [initialTab] = useState(search.tab);
  const [initialLead] = useState(search.lead == null ? undefined : String(search.lead));
  const dataQ = useQuery({
    queryKey: ["hypnobox-data"],
    queryFn: () => getHypnoboxData(),
    staleTime: Infinity,
  });

  if (dataQ.isLoading) return <Centered>Carregando análise…</Centered>;
  if (dataQ.error || !dataQ.data)
    return (
      <Centered>
        <p className="font-semibold text-[var(--navy)]">Não foi possível carregar a análise</p>
        <p className="mt-1 text-sm">
          {dataQ.error instanceof Error ? dataQ.error.message : "Tente novamente."}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => dataQ.refetch()}
            className="h-11 px-6 rounded-xl bg-[var(--navy)] text-white font-semibold"
          >
            Tentar novamente
          </button>
          <Link
            to={home}
            className="inline-flex h-11 items-center px-6 rounded-xl border border-border bg-white font-semibold text-[var(--navy)]"
          >
            Voltar ao sistema
          </Link>
        </div>
      </Centered>
    );

  return (
    <Suspense fallback={<Centered>Carregando análise…</Centered>}>
      <HypnoboxFrame
        data={dataQ.data}
        initialTab={initialTab}
        initialLead={initialLead}
        userName={profile?.full_name ?? ""}
        userRole={profile ? (ROLE_LABELS[profile.role] ?? profile.role) : ""}
        onTab={(tab) =>
          navigate({
            search: (prev: Search) => ({ ...prev, tab: tab === "graficos" ? undefined : tab }),
            replace: true,
          })
        }
        onLead={(id) =>
          navigate({
            search: (prev: Search) => ({ ...prev, lead: id ? leadParam(id) : undefined }),
            replace: true,
          })
        }
        onExit={() => navigate({ to: home })}
        onColeta={() => navigate({ to: "/hypnobox/coleta" })}
      />
    </Suspense>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center bg-[var(--surface)] p-6 text-center text-muted-foreground">
      <div>{children}</div>
    </div>
  );
}
