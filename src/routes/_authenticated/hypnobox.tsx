import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RequireModule } from "@/components/RequireModule";
import { ROLE_LABELS, useHomePath } from "@/components/nav/useNavTabs";
import { useAuth } from "@/hooks/useAuth";
import {
  abrirHypnoboxData,
  criarLinkConferencia,
  getHypnoboxData,
  salvarDataVenda,
  type HypnoboxData,
  type HypnoboxRow,
} from "@/lib/hypnobox.functions";
import { lerDashLen, type DashLen } from "@/lib/coleta/len-cliente";
import type { LenInfo } from "@/components/hypnobox/HypnoboxFrame";

// o painel (página + biblioteca de gráficos) só é baixado ao abrir esta tela
const HypnoboxFrame = lazy(() => import("@/components/hypnobox/HypnoboxFrame"));

// lead: ID do Hypnobox; numérico fica como número para o endereço sair ?lead=192822
type Search = { tab?: string; lead?: string | number };
const leadParam = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);

// tabela do dash da LEN -> conjunto de dados do painel (valores como texto, igual ao banco)
const CONJUNTOS_LEN: Record<string, string> = {
  al_funil_produto: "funil_produto",
  al_status_geral: "status_geral",
  al_fontes: "fontes",
  al_descarte: "descarte",
  al_veiculo: "veiculo",
  al_mkt_campanhas: "mkt_campanhas",
  al_mkt_anuncios: "mkt_anuncios",
  al_mkt_palavras: "mkt_palavras",
  al_mkt_diario: "mkt_diario",
};
function conjuntosDoDash(d: DashLen) {
  const out: Record<string, HypnoboxRow[]> = {};
  for (const [tabela, id] of Object.entries(CONJUNTOS_LEN)) {
    const linhas = (d.tabelas[tabela] ?? []).map((r) => {
      const o: HypnoboxRow = {};
      for (const [k, v] of Object.entries(r)) o[k] = v == null ? "" : String(v);
      if ("outubro" in o && !("outubro_1a13" in o)) o.outubro_1a13 = o.outubro;
      return o;
    });
    if (id === "status_geral") linhas.sort((a, b) => Number(a.ordem) - Number(b.ordem));
    out[id] = linhas;
  }
  return out;
}

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
    queryFn: async () => abrirHypnoboxData(await getHypnoboxData()),
    staleTime: Infinity,
  });
  // data real de uma venda (aba Vendas): grava e troca só as datas no painel
  const queryClient = useQueryClient();
  const salvarVenda = useCallback(
    async (id: string, data: string | null) => {
      const linhas = await salvarDataVenda({ data: { id_cliente: id, data_venda: data } });
      queryClient.setQueryData<HypnoboxData>(["hypnobox-data"], (old) =>
        old ? { ...old, datasets: { ...old.datasets, vendas_data: linhas } } : old,
      );
    },
    [queryClient],
  );
  // link único para o corretor conferir as visitas do período (página /conferir, sem login)
  const criarLink = useCallback(async (corretor: string, nome: string, de: string, ate: string) => {
    const token = await criarLinkConferencia({ data: { corretor, nome, de, ate } });
    return `${window.location.origin}/conferir/${token}`;
  }, []);

  // dash da LEN de outros períodos (filtro de datas das abas de campanhas), guardado por período
  const cache = useRef(new Map<string, DashLen>());
  const [lenAtual, setLenAtual] = useState<DashLen | null>(null);
  const [lenInfo, setLenInfo] = useState<LenInfo>({ estado: "coleta" });
  const pedindo = useRef<string | null>(null);
  const pedirLen = useCallback(async (de: string | null, ate: string | null) => {
    // sem datas = volta para o período da última coleta (o que está no banco)
    if (!de || !ate) {
      pedindo.current = null;
      setLenAtual(null);
      setLenInfo({ estado: "coleta" });
      return;
    }
    const chave = `${de}|${ate}`;
    if (pedindo.current === chave) return;
    const pronto = cache.current.get(chave);
    if (pronto) {
      pedindo.current = null;
      setLenAtual(pronto);
      setLenInfo({ estado: "ok", de, ate });
      return;
    }
    pedindo.current = chave;
    setLenInfo({ estado: "carregando", de, ate, feitas: 0, total: 18 });
    try {
      const d = await lerDashLen(de, ate, (feitas, total) => {
        if (pedindo.current === chave) setLenInfo({ estado: "carregando", de, ate, feitas, total });
      });
      cache.current.set(chave, d);
      if (pedindo.current !== chave) return;
      pedindo.current = null;
      setLenAtual(d);
      setLenInfo({ estado: "ok", de, ate });
    } catch (e) {
      if (pedindo.current !== chave) return;
      pedindo.current = null;
      setLenInfo({ estado: "erro", de, ate, erro: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  const dados = useMemo(
    () =>
      dataQ.data && lenAtual
        ? { ...dataQ.data, datasets: { ...dataQ.data.datasets, ...conjuntosDoDash(lenAtual) } }
        : dataQ.data,
    [dataQ.data, lenAtual],
  );

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
        data={dados!}
        lenInfo={lenInfo}
        onPedirLen={pedirLen}
        onSalvarDataVenda={salvarVenda}
        onCriarLinkConferencia={criarLink}
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
