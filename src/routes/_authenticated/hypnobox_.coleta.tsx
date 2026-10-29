import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck,
  Eye,
  EyeOff,
  Loader2,
  Megaphone,
  MessageSquare,
  RefreshCw,
  Users,
} from "lucide-react";
import { RequireModule } from "@/components/RequireModule";
import { NuvemFlutuante } from "@/components/hypnobox/coleta/NuvemFlutuante";
import { PainelColeta, type Gravacao } from "@/components/hypnobox/coleta/PainelColeta";
import { useColetaGuiada } from "@/components/hypnobox/coleta/useColetaGuiada";
import { PASSOS } from "@/lib/coleta/guia";
import {
  getColetaPainel,
  revelarContato,
  sincronizarCarga,
  type ColetaPainel,
} from "@/lib/coleta.functions";

export const Route = createFileRoute("/_authenticated/hypnobox_/coleta")({
  component: () => (
    <RequireModule adminOnly>
      <ColetaPage />
    </RequireModule>
  ),
});

type Row = Record<string, unknown>;
const brDate = (v: unknown) => {
  const s = typeof v === "string" ? v : "";
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—";
};
const brDataHora = (v: unknown) =>
  typeof v === "string" && v
    ? new Date(v).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const int = (v: unknown) => (v == null || v === "" ? "—" : Number(v).toLocaleString("pt-BR"));
const brl = (v: unknown) =>
  v == null
    ? "—"
    : Number(v).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      });

/** JSON → gzip → base64 (CompressionStream, nativo do navegador). */
async function compactar(dados: unknown): Promise<{ gz: string }> {
  const fluxo = new Blob([JSON.stringify(dados)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(fluxo).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { gz: btoa(bin) };
}

/** Mensagem legível de qualquer erro (o servidor às vezes devolve um objeto). */
function textoDoErro(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; status?: unknown; statusText?: unknown };
    if (typeof o.message === "string" && o.message) return o.message;
    if (o.status === 413) return "A carga ficou grande demais para enviar de uma vez.";
    if (typeof o.statusText === "string" && o.statusText)
      return `Erro do servidor: ${o.statusText}`;
    try {
      return `Erro do servidor: ${JSON.stringify(e).slice(0, 300)}`;
    } catch {
      /* objeto sem texto */
    }
  }
  return String(e);
}

function ColetaPage() {
  const qc = useQueryClient();
  const col = useColetaGuiada();
  const painelQ = useQuery({ queryKey: ["coleta-painel"], queryFn: () => getColetaPainel() });
  const [gravacao, setGravacao] = useState<Gravacao>({ fase: "parada" });

  const gravar = async (forcar = false) => {
    try {
      const carga =
        gravacao.fase === "confirmar" && forcar
          ? gravacao.carga
          : (setGravacao({ fase: "lendo" }), await col.carga());
      if (!forcar && carga.checagens.some((c) => c.alerta))
        return setGravacao({ fase: "confirmar", carga });
      setGravacao({ fase: "gravando" });
      // compactada: uma coleta grande passa do limite de tamanho por pedido
      const resultado = await sincronizarCarga({
        data: await compactar({ tabelas: carga.tabelas, coleta: carga.coleta }),
      });
      setGravacao({
        fase: "ok",
        resultado,
        checagens: carga.checagens,
        em: new Date().toISOString(),
      });
      await qc.invalidateQueries({ queryKey: ["coleta-painel"] });
      await qc.invalidateQueries({ queryKey: ["hypnobox-data"] });
      await qc.invalidateQueries({ queryKey: ["coleta-base"] });
    } catch (e) {
      setGravacao({ fase: "erro", erro: textoDoErro(e) });
    }
  };

  // quando o roteiro do Hypnobox e o dash da LEN terminam, grava sozinho (uma vez)
  const pronto =
    col.len.status === "ok" && PASSOS.every((p) => col.guia.passos[p.id].status === "ok");
  const prontoAntes = useRef<boolean | null>(null);
  useEffect(() => {
    const antes = prontoAntes.current;
    prontoAntes.current = pronto;
    if (pronto && antes === false && gravacao.fase !== "gravando") void gravar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto]);

  // estado de cada fonte, para os cartões
  const itens: ItemFonte[] = [
    ...PASSOS.map((p) => ({
      id: p.id,
      titulo: p.titulo,
      status: col.guia.passos[p.id].status,
      contagem: col.guia.passos[p.id].contagem,
      progresso: null,
      erro: null,
      concluidoEm: col.guia.passos[p.id].concluidoEm,
    })),
    {
      id: "len",
      titulo: "Dash da LEN",
      status: col.len.status,
      contagem: col.len.linhas,
      progresso: col.len.progresso,
      erro: col.len.erro,
      concluidoEm: col.len.concluidoEm,
    },
  ];
  const naTela = col.naTela?.passo ? PASSOS.find((p) => p.id === col.naTela!.passo) : null;
  const resumo =
    col.len.status === "rodando" && col.len.progresso
      ? col.len.progresso.texto
      : gravacao.fase === "gravando"
        ? "Gravando no banco…"
        : naTela
          ? `Guia em ${naTela.titulo}`
          : undefined;

  return (
    <div className="min-h-dvh bg-[var(--surface)] pb-28">
      <header className="sticky top-0 z-30 bg-[var(--navy)] text-white safe-top">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <Link
            to="/hypnobox"
            className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-white/85 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
            aria-label="Voltar à Análise Hypnobox"
            title="Voltar à Análise Hypnobox"
          >
            <ArrowLeft size={18} />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">Coleta de dados</h1>
          <button
            type="button"
            onClick={() => painelQ.refetch()}
            className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
          >
            <RefreshCw
              size={15}
              className={painelQ.isFetching ? "animate-spin motion-reduce:animate-none" : ""}
              aria-hidden
            />
            <span className="hidden sm:inline">Atualizar</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Estado de cada fonte e prévia do que está gravado no banco da análise. A coleta roda pela
          janela flutuante: você navega no Hypnobox e o guia lê o que está na tela.
        </p>

        {painelQ.isLoading ? (
          <Esqueleto />
        ) : painelQ.error || !painelQ.data ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-white p-5 text-sm text-red-700"
          >
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">Não foi possível ler o banco da análise</p>
              <p className="mt-1">
                {painelQ.error instanceof Error ? painelQ.error.message : "Tente de novo."}
              </p>
            </div>
          </div>
        ) : (
          <>
            <Fontes painel={painelQ.data} itens={itens} />
            <Historico coletas={painelQ.data.coletas} />
            <Previas painel={painelQ.data} />
          </>
        )}
      </main>

      <NuvemFlutuante
        chave="hypnobox-coleta-nuvem"
        titulo="Coleta Hypnobox + LEN"
        resumoMinimizado={resumo}
        status={
          <span
            className={`mr-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              col.naTela && col.janelaAberta
                ? "bg-green-500/15 text-green-300"
                : "bg-white/10 text-white/60"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${col.naTela && col.janelaAberta ? "bg-green-400" : "bg-white/40"}`}
              aria-hidden
            />
            {col.naTela && col.janelaAberta
              ? "Guia ativo"
              : col.janelaAberta
                ? "Hypnobox aberto"
                : "Hypnobox fechado"}
          </span>
        }
      >
        <PainelColeta col={col} gravacao={gravacao} onGravar={gravar} />
      </NuvemFlutuante>
    </div>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Carregando">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-36 animate-pulse rounded-2xl bg-white motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-2xl bg-white motion-reduce:animate-none" />
    </div>
  );
}

// ---------------- estado de cada fonte ----------------

type ItemFonte = {
  id: string;
  titulo: string;
  status: "pendente" | "lendo" | "rodando" | "ok" | "erro";
  contagem: number | null;
  progresso: { texto: string } | null;
  erro: string | null;
  concluidoEm: string | null;
};

function Fontes({ painel, itens }: { painel: ColetaPainel; itens: ItemFonte[] }) {
  const c = painel.contagens;
  const ultima = painel.coletas[0];
  const item = (...ids: string[]) => itens.filter((i) => ids.includes(i.id));
  const cards = [
    {
      titulo: "Clientes (leads LEN)",
      icone: Users,
      valor: c.al_leads,
      unidade: "leads",
      itens: item("contatos", "clientes"),
    },
    {
      titulo: "Visitas",
      icone: CalendarCheck,
      valor: c.al_visitas,
      unidade: "visitas",
      itens: item("visitas"),
    },
    {
      titulo: "Mensagens",
      icone: MessageSquare,
      valor: c.al_mensagens_corretor,
      unidade: "corretores",
      itens: item("mensagens"),
    },
    {
      titulo: "Dash da LEN",
      icone: Megaphone,
      valor: c.al_mkt_campanhas,
      unidade: "linhas de campanha",
      itens: item("len"),
    },
  ];
  return (
    <section aria-labelledby="fontes-titulo">
      <h2 id="fontes-titulo" className="mb-3 text-base font-semibold text-[var(--navy)]">
        Fontes de dados
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icone = card.icone;
          const erro = card.itens.find((i) => i.status === "erro");
          const rodando = card.itens.find((i) => i.status === "rodando" || i.status === "lendo");
          const feito = card.itens
            .map((i) => i.concluidoEm)
            .filter(Boolean)
            .sort()
            .pop();
          return (
            <article
              key={card.titulo}
              className="flex flex-col rounded-2xl border border-border bg-white p-4 shadow-sm"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--navy)]">
                <span
                  className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--surface)] text-[var(--gold-dark)]"
                  aria-hidden
                >
                  <Icone size={16} />
                </span>
                {card.titulo}
              </div>
              <p className="mt-3 text-3xl font-bold tabular-nums text-[var(--navy)]">
                {int(card.valor)}
              </p>
              <p className="text-xs text-muted-foreground">{card.unidade} no banco</p>
              <div className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                {rodando ? (
                  <span className="flex items-center gap-1.5 text-sky-700">
                    <Loader2
                      size={12}
                      className="animate-spin motion-reduce:animate-none"
                      aria-hidden
                    />
                    {rodando.progresso?.texto ??
                      (rodando.status === "lendo"
                        ? `${rodando.titulo}: ${int(rodando.contagem)} lidos pela tela`
                        : "Coletando…")}
                  </span>
                ) : erro ? (
                  <span className="flex items-start gap-1.5 text-red-700">
                    <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" aria-hidden />
                    {erro.erro}
                  </span>
                ) : feito ? (
                  <>Lido nesta coleta: {brDataHora(feito)}</>
                ) : (
                  <>Última gravação: {ultima ? brDataHora(ultima.coletado_em) : "nenhuma"}</>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Historico({ coletas }: { coletas: Row[] }) {
  return (
    <section
      aria-labelledby="hist-titulo"
      className="rounded-2xl border border-border bg-white shadow-sm"
    >
      <h2
        id="hist-titulo"
        className="border-b border-border px-4 py-3 text-base font-semibold text-[var(--navy)]"
      >
        Coletas gravadas
      </h2>
      {coletas.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhuma coleta gravada ainda.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {coletas.slice(0, 5).map((c) => (
            <li key={String(c.id)} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-[var(--navy)]">
                  {brDataHora(c.coletado_em)}
                </span>
                <span className="text-xs text-muted-foreground">
                  Período {brDate(c.periodo_inicio)} a {brDate(c.periodo_fim)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{String(c.fontes ?? "")}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------- prévia das tabelas ----------------

type Aba = "leads" | "visitas" | "mensagens" | "len";
const ABAS: { id: Aba; label: string }[] = [
  { id: "leads", label: "Leads" },
  { id: "visitas", label: "Visitas" },
  { id: "mensagens", label: "Mensagens" },
  { id: "len", label: "LEN" },
];

function Previas({ painel }: { painel: ColetaPainel }) {
  const [aba, setAba] = useState<Aba>("leads");
  const p = painel.previas;
  return (
    <section
      aria-labelledby="previa-titulo"
      className="rounded-2xl border border-border bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 id="previa-titulo" className="text-base font-semibold text-[var(--navy)]">
          Prévia das tabelas
        </h2>
        <div
          role="tablist"
          aria-label="Tabelas"
          className="flex gap-1 rounded-xl bg-[var(--surface)] p-1"
        >
          {ABAS.map((a) => (
            <button
              key={a.id}
              role="tab"
              type="button"
              aria-selected={aba === a.id}
              onClick={() => setAba(a.id)}
              className={`h-8 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] ${
                aba === a.id
                  ? "bg-white text-[var(--navy)] shadow-sm"
                  : "text-muted-foreground hover:text-[var(--navy)]"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" className="p-0">
        {aba === "leads" && (
          <Tabela
            linhas={p.leads}
            vazio="Nenhum lead gravado."
            nota={`Mostrando os ${p.leads.length} atualizados mais recentemente de ${int(painel.contagens.al_leads)}. Contato mascarado: use o olho para ver.`}
            colunas={[
              { k: "id_cliente", t: "ID", forte: true },
              {
                k: "contato",
                t: "Contato",
                contato: {
                  tabela: "al_leads",
                  id: "id_cliente",
                  nome: "nome",
                  email: "email",
                  tel: "telefone",
                },
              },
              { k: "cadastro", t: "Cadastro", f: brDate },
              { k: "atualizacao", t: "Atualização", f: brDate },
              { k: "produto", t: "Produto" },
              { k: "etapa", t: "Etapa" },
              { k: "corretor", t: "Corretor" },
              { k: "canal", t: "Canal" },
              { k: "campanha", t: "Campanha", largo: true },
            ]}
          />
        )}
        {aba === "visitas" && (
          <Tabela
            linhas={p.visitas}
            vazio="Nenhuma visita gravada."
            nota={`Mostrando ${p.visitas.length} de ${int(painel.contagens.al_visitas)}, das mais recentes.`}
            colunas={[
              { k: "visita_id", t: "Nº", forte: true },
              { k: "data", t: "Data", f: brDate },
              { k: "status", t: "Status" },
              { k: "id_cliente", t: "Cliente" },
              {
                k: "contato",
                t: "Contato",
                contato: {
                  tabela: "al_visitas",
                  id: "visita_id",
                  nome: "nome_cliente",
                  email: "email_cliente",
                },
              },
              { k: "corretor", t: "Corretor" },
              { k: "registrado_por", t: "Registrado por" },
              { k: "produto", t: "Produto" },
              { k: "grupo_origem", t: "Origem" },
            ]}
          />
        )}
        {aba === "mensagens" && (
          <div className="grid gap-0 lg:grid-cols-[2fr_1fr]">
            <Tabela
              linhas={p.mensagensCorretor}
              vazio="Nenhuma mensagem gravada."
              colunas={[
                { k: "corretor", t: "Corretor", forte: true },
                { k: "mensagens", t: "Mensagens", f: int, num: true },
                { k: "respondidas", t: "Respondidas", f: int, num: true },
                { k: "lidas_sem_resposta", t: "Lidas sem resposta", f: int, num: true },
                { k: "direcionadas", t: "Direcionadas", f: int, num: true },
                { k: "nao_lidas", t: "Não lidas", f: int, num: true },
              ]}
            />
            <Tabela
              linhas={p.mensagensHorario}
              vazio="—"
              colunas={[
                { k: "faixa", t: "Faixa", forte: true },
                { k: "mensagens", t: "Mensagens", f: int, num: true },
              ]}
            />
          </div>
        )}
        {aba === "len" && (
          <div className="divide-y divide-border">
            <Tabela
              titulo="Funil por empreendimento"
              linhas={p.funil}
              vazio="Nenhum dado da LEN gravado."
              colunas={[
                { k: "produto", t: "Empreendimento", forte: true },
                { k: "leads", t: "Leads", f: int, num: true },
                { k: "investimento", t: "Investimento", f: brl, num: true },
                { k: "meta_leads", t: "Meta", f: int, num: true },
                { k: "tentando_contato", t: "Tentando contato", f: int, num: true },
                { k: "em_contato", t: "Em contato", f: int, num: true },
                { k: "descarte", t: "Descarte", f: int, num: true },
              ]}
            />
            <Tabela
              titulo="Planejado x realizado por veículo"
              linhas={p.veiculo}
              vazio="—"
              colunas={[
                { k: "veiculo", t: "Veículo", forte: true },
                { k: "investimento_previsto", t: "Previsto", f: brl, num: true },
                { k: "investimento_real", t: "Realizado", f: brl, num: true },
                { k: "leads", t: "Leads", f: int, num: true },
                { k: "meta_leads", t: "Meta", f: int, num: true },
              ]}
            />
            <Tabela
              titulo="Campanhas com mais investimento"
              linhas={p.campanhas}
              vazio="—"
              colunas={[
                { k: "janela", t: "Janela" },
                { k: "campanha", t: "Campanha", forte: true, largo: true },
                { k: "canal", t: "Canal" },
                { k: "objetivo", t: "Objetivo" },
                { k: "investimento", t: "Investimento", f: brl, num: true },
                { k: "cliques", t: "Cliques", f: int, num: true },
              ]}
            />
          </div>
        )}
      </div>
    </section>
  );
}

type Coluna = {
  k: string;
  t: string;
  f?: (v: unknown) => string;
  num?: boolean;
  forte?: boolean;
  largo?: boolean;
  contato?: {
    tabela: "al_leads" | "al_visitas";
    id: string;
    nome: string;
    email: string;
    tel?: string;
  };
};

function Tabela({
  linhas,
  colunas,
  vazio,
  nota,
  titulo,
}: {
  linhas: Row[];
  colunas: Coluna[];
  vazio: string;
  nota?: string;
  titulo?: string;
}) {
  return (
    <div className="min-w-0">
      {titulo && <h3 className="px-4 pt-4 text-sm font-semibold text-[var(--navy)]">{titulo}</h3>}
      {nota && <p className="px-4 pt-3 text-xs text-muted-foreground">{nota}</p>}
      {linhas.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-[1] bg-[var(--surface)] text-xs uppercase text-[var(--navy)]">
              <tr>
                {colunas.map((c) => (
                  <th
                    key={c.k}
                    scope="col"
                    className={`whitespace-nowrap px-4 py-2.5 font-semibold ${c.num ? "text-right" : ""}`}
                  >
                    {c.t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((r, i) => (
                <tr key={i} className="border-b border-border transition-colors hover:bg-[#FDF8EC]">
                  {colunas.map((c) => (
                    <td
                      key={c.k}
                      className={`px-4 py-2.5 ${c.num ? "text-right tabular-nums" : ""} ${c.forte ? "font-semibold text-[var(--navy)]" : "text-muted-foreground"} ${
                        c.largo ? "min-w-[16rem]" : "whitespace-nowrap"
                      }`}
                    >
                      {c.contato ? (
                        <Contato linha={r} cfg={c.contato} />
                      ) : c.f ? (
                        c.f(r[c.k])
                      ) : r[c.k] == null || r[c.k] === "" ? (
                        "—"
                      ) : (
                        String(r[c.k])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Contato mascarado; o olho busca o valor real no servidor (só para esta linha). */
function Contato({ linha, cfg }: { linha: Row; cfg: NonNullable<Coluna["contato"]> }) {
  const [real, setReal] = useState<{
    nome: string | null;
    email: string | null;
    telefone: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const mascarado = {
    nome: linha[cfg.nome] as string | null,
    email: linha[cfg.email] as string | null,
    telefone: cfg.tel ? (linha[cfg.tel] as string | null) : null,
  };
  const v = real ?? mascarado;
  const formatarTel = (t: string | null) => {
    if (!real || !t) return t;
    const d = t.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
    return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : t;
  };
  if (!v.nome && !v.email && !v.telefone) return <span>—</span>;
  const alternar = async () => {
    if (real) return setReal(null);
    setBusy(true);
    try {
      setReal(await revelarContato({ data: { tabela: cfg.tabela, id: String(linha[cfg.id]) } }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex items-start gap-2">
      <span className="min-w-0 leading-tight">
        {v.nome && <span className="block text-[var(--navy)]">{v.nome}</span>}
        {v.email && <span className="block text-xs">{v.email}</span>}
        {v.telefone && (
          <span className="block text-xs tabular-nums">{formatarTel(v.telefone)}</span>
        )}
      </span>
      <button
        type="button"
        onClick={alternar}
        disabled={busy}
        className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--surface)] hover:text-[var(--navy)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
        aria-label={real ? "Esconder contato" : "Revelar contato"}
        title={real ? "Esconder contato" : "Revelar contato"}
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
        ) : real ? (
          <EyeOff size={14} />
        ) : (
          <Eye size={14} />
        )}
      </button>
    </span>
  );
}
