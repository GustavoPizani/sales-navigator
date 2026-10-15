import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  Database,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Square,
} from "lucide-react";
import type { Carga, Checagem, ColetaGuiada, EstadoLen } from "./useColetaGuiada";
import { PASSOS, type Periodo, type StatusPasso } from "@/lib/coleta/guia";
import type { ResultadoSincronizacao } from "@/lib/coleta.functions";

export type Gravacao =
  | { fase: "parada" }
  | { fase: "lendo" | "gravando" }
  | { fase: "confirmar"; carga: Carga }
  | { fase: "ok"; resultado: ResultadoSincronizacao; checagens: Checagem[]; em: string }
  | { fase: "erro"; erro: string };

const BOTAO =
  "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45";
const B_PRIMARIO = `${BOTAO} bg-[var(--navy)] text-white hover:bg-black`;
const B_DOURADO = `${BOTAO} bg-[var(--gold)] text-[var(--navy)] hover:brightness-105`;
const B_CONTORNO = `${BOTAO} border border-border bg-white text-[var(--navy)] hover:bg-[var(--surface)]`;
const B_LINK =
  "inline-flex items-center gap-1 rounded text-xs font-semibold text-[var(--gold-dark)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:opacity-45";
const CAMPO =
  "h-9 w-full min-w-0 rounded-lg border border-border bg-white px-2 text-sm text-[var(--navy)] focus:border-[var(--gold)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/40 disabled:bg-[var(--surface)]";

const brDate = (iso?: string | null) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—";
const brDataHora = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
const int = (n: number | null | undefined) => (n ?? 0).toLocaleString("pt-BR");

type Status = StatusPasso | EstadoLen["status"];
const SELO: Record<Status, { txt: string; cls: string }> = {
  pendente: { txt: "A fazer", cls: "bg-[var(--surface)] text-muted-foreground" },
  lendo: { txt: "Lendo", cls: "bg-sky-50 text-sky-700" },
  rodando: { txt: "Sincronizando", cls: "bg-sky-50 text-sky-700" },
  ok: { txt: "Feito", cls: "bg-green-50 text-green-700" },
  erro: { txt: "Erro", cls: "bg-red-50 text-red-700" },
};

const CHAVE_INSTALADO = "sn-guia-instalado";

export function PainelColeta({
  col,
  gravacao,
  onGravar,
}: {
  col: ColetaGuiada;
  gravacao: Gravacao;
  onGravar: (forcar?: boolean) => void;
}) {
  const { guia, len, naTela, janelaAberta } = col;
  const [periodo, setPeriodo] = useState<Periodo>(guia.periodo);
  const [erro, setErro] = useState<string | null>(null);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [instalado, setInstalado] = useState(false);

  useEffect(() => setPeriodo(guia.periodo), [guia.periodo]);
  useEffect(() => {
    try {
      setInstalado(localStorage.getItem(CHAVE_INSTALADO) === "1");
    } catch {
      /* sem storage */
    }
  }, []);
  // o guia falou com esta aba: o favorito está instalado
  useEffect(() => {
    if (!naTela || instalado) return;
    setInstalado(true);
    try {
      localStorage.setItem(CHAVE_INSTALADO, "1");
    } catch {
      /* sem storage */
    }
  }, [naTela, instalado]);

  const acao = (fn: () => unknown) => {
    setErro(null);
    try {
      fn();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  };

  const passos = PASSOS.map((p) => ({
    ...p,
    instrucoes: p.instrucoes(guia.periodo),
    ...guia.passos[p.id],
  }));
  const feitos = passos.filter((p) => p.status === "ok").length;
  const algoOk = feitos > 0 || len.status === "ok";
  const ocupado = gravacao.fase === "lendo" || gravacao.fase === "gravando";
  const periodoInvalido = !periodo.de || !periodo.ate || periodo.de > periodo.ate;
  const titulo = (id?: string | null) => passos.find((p) => p.id === id)?.titulo ?? "";
  const guiaAtivo = Boolean(janelaAberta && naTela);

  // você ainda está na página de um passo que acabou de terminar: hora de seguir
  const leitura = guia.ultimaLeitura;
  const recemFeito =
    leitura && naTela?.passo === leitura.passo && guia.passos[leitura.passo].status === "ok"
      ? passos.find((p) => p.id === leitura.passo)
      : null;

  const mudarPeriodo = (p: Periodo) => {
    setPeriodo(p);
    if (p.de && p.ate && p.de <= p.ate) col.definirPeriodo(p);
  };

  const sessao = !janelaAberta
    ? { txt: "Aba do Hypnobox fechada", cls: "text-muted-foreground", dot: "bg-gray-300" }
    : guiaAtivo
      ? {
          txt: `Guia ativo${naTela?.passo ? ` em ${titulo(naTela.passo)}` : ""}`,
          cls: "text-green-700",
          dot: "bg-green-500",
        }
      : {
          txt: "Entre no Hypnobox e clique no favorito Guia da coleta",
          cls: "text-sky-700",
          dot: "bg-sky-500 animate-pulse motion-reduce:animate-none",
        };

  return (
    <div className="space-y-4 p-4 text-[var(--navy)]">
      <Favorito href={col.favorito} instalado={instalado} />

      <section
        aria-labelledby="coleta-sessao"
        className="rounded-2xl border border-border bg-[var(--surface)] p-3"
      >
        <h3 id="coleta-sessao" className="sr-only">
          Período e janela do Hypnobox
        </h3>
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Período da coleta
          </legend>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            De
            <input
              type="date"
              className={`${CAMPO} mt-1`}
              value={periodo.de}
              max={periodo.ate}
              onChange={(e) => mudarPeriodo({ ...periodo, de: e.target.value })}
            />
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Até
            <input
              type="date"
              className={`${CAMPO} mt-1`}
              value={periodo.ate}
              min={periodo.de}
              onChange={(e) => mudarPeriodo({ ...periodo, ate: e.target.value })}
            />
          </label>
        </fieldset>
        {periodoInvalido && (
          <p className="mt-2 text-xs text-red-700">A data inicial precisa ser anterior à final.</p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p
            className={`flex min-w-0 items-center gap-1.5 text-xs font-medium ${sessao.cls}`}
            aria-live="polite"
          >
            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${sessao.dot}`} aria-hidden />
            {sessao.txt}
          </p>
          <button
            type="button"
            className={janelaAberta ? `${B_CONTORNO} h-9` : `${B_PRIMARIO} h-9`}
            disabled={periodoInvalido}
            onClick={() => acao(() => col.sincronizar(periodo))}
          >
            {janelaAberta ? (
              <>
                <ExternalLink size={15} aria-hidden /> Mostrar o Hypnobox
              </>
            ) : (
              <>
                <RefreshCw size={15} aria-hidden /> Sincronizar
              </>
            )}
          </button>
        </div>
        {!janelaAberta && (
          <p className="mt-2 text-xs leading-snug text-muted-foreground">
            Abre o Hypnobox numa aba nova do seu navegador. Você entra com o seu login, navega como
            sempre e clica no favorito <b>Guia da coleta</b> em cada página: o guia aparece ali, lê
            só o que está na tela e te diz a próxima página.
          </p>
        )}
      </section>

      {erro && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden />
          {erro}
        </p>
      )}

      {recemFeito && (
        <div
          role="status"
          className="rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-green-900"
        >
          <p className="flex items-center gap-1.5 font-semibold">
            <CheckCircle2 size={16} aria-hidden /> {recemFeito.titulo}: escaneado (
            {int(recemFeito.contagem)} registros)
          </p>
          {col.passoAtual ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs">Próxima página: {titulo(col.passoAtual)}</span>
              <button
                type="button"
                className={`${B_PRIMARIO} h-9`}
                onClick={() => acao(() => col.irPara(col.passoAtual!))}
              >
                Ir para {titulo(col.passoAtual)} <ArrowRight size={15} aria-hidden />
              </button>
            </div>
          ) : (
            <p className="mt-1 text-xs">Todas as páginas do Hypnobox foram lidas.</p>
          )}
        </div>
      )}

      <section aria-labelledby="coleta-roteiro">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3
            id="coleta-roteiro"
            className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Roteiro no Hypnobox
          </h3>
          <span className="text-xs tabular-nums text-muted-foreground">
            {feitos} de {passos.length} feitos
          </span>
        </div>
        <ol className="space-y-2">
          {passos.map((p, i) => (
            <Passo
              key={p.id}
              n={i + 1}
              p={p}
              atual={col.passoAtual === p.id}
              aberto={abertos[p.id] ?? col.passoAtual === p.id}
              onAbrir={(v) => setAbertos((x) => ({ ...x, [p.id]: v }))}
              naTela={guiaAtivo && naTela?.passo === p.id}
              outraTela={
                guiaAtivo && naTela?.passo && naTela.passo !== p.id ? titulo(naTela.passo) : null
              }
              leitura={leitura?.passo === p.id ? leitura : null}
              janelaAberta={janelaAberta}
              onIr={() => acao(() => col.irPara(p.id))}
              onConcluir={() => acao(() => col.concluir(p.id))}
              onLimpar={() => acao(() => col.limpar(p.id))}
            />
          ))}
        </ol>
      </section>

      <ItemLen
        it={len}
        bloqueado={ocupado || periodoInvalido}
        onRodar={() => void col.sincronizarLen(periodo)}
        onParar={col.pararLen}
      />

      <Gravar gravacao={gravacao} disabled={!algoOk || ocupado} onGravar={onGravar} />

      {algoOk && (
        <div className="text-right">
          <button
            type="button"
            className={B_LINK}
            onClick={() => {
              if (window.confirm("Apagar tudo o que foi lido nesta coleta e começar de novo?"))
                col.recomecar();
            }}
          >
            <RotateCcw size={12} aria-hidden /> Recomeçar a coleta
          </button>
        </div>
      )}
    </div>
  );
}

/** Botão para arrastar aos favoritos (uma vez). O React não aceita href "javascript:", por isso vai pelo DOM. */
function Favorito({ href, instalado }: { href: string; instalado: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [aberto, setAberto] = useState(!instalado);
  useEffect(() => setAberto(!instalado), [instalado]);
  useEffect(() => {
    if (ref.current && href) ref.current.setAttribute("href", href);
  }, [href, aberto]);
  return (
    <section
      aria-labelledby="coleta-favorito"
      className="rounded-2xl border border-border bg-white"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-2xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <Bookmark size={16} className="flex-shrink-0 text-[var(--gold-dark)]" aria-hidden />
        <span id="coleta-favorito" className="flex-1 text-sm font-semibold">
          Favorito Guia da coleta
        </span>
        {instalado && <span className="text-xs text-green-700">Instalado</span>}
        <ChevronDown
          size={16}
          className={`text-muted-foreground transition-transform motion-reduce:transition-none ${aberto ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {aberto && (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-3 text-sm">
          <p className="leading-snug">
            Arraste o botão abaixo para a barra de favoritos do navegador (se a barra não aparece:{" "}
            <kbd className="rounded border border-border px-1 text-xs">Ctrl</kbd>+
            <kbd className="rounded border border-border px-1 text-xs">Shift</kbd>+
            <kbd className="rounded border border-border px-1 text-xs">B</kbd>). Só precisa fazer
            isso uma vez.
          </p>
          <a
            ref={ref}
            className={`${B_DOURADO} w-full cursor-grab active:cursor-grabbing`}
            onClick={(e) => {
              e.preventDefault();
              window.alert(
                "Arraste este botão para a barra de favoritos. Ele funciona dentro do Hypnobox.",
              );
            }}
          >
            <Bookmark size={15} aria-hidden /> Guia da coleta
          </a>
          <p className="text-xs leading-snug text-muted-foreground">
            No Hypnobox, clique nele em cada página do roteiro: abre o guia ali mesmo. Ele só lê a
            tabela que você está vendo e manda para esta aba; não clica nem consulta nada por você.
          </p>
        </div>
      )}
    </section>
  );
}

type PassoVisto = {
  id: string;
  titulo: string;
  serve: string;
  instrucoes: string[];
  status: StatusPasso;
  contagem: number;
  total: number | null;
  avisos: string[];
};

function Passo({
  n,
  p,
  atual,
  aberto,
  onAbrir,
  naTela,
  outraTela,
  leitura,
  janelaAberta,
  onIr,
  onConcluir,
  onLimpar,
}: {
  n: number;
  p: PassoVisto;
  atual: boolean;
  aberto: boolean;
  onAbrir: (v: boolean) => void;
  naTela: boolean;
  outraTela: string | null;
  leitura: { em: string; novos: number; texto: string } | null;
  janelaAberta: boolean;
  onIr: () => void;
  onConcluir: () => void;
  onLimpar: () => void;
}) {
  const selo = SELO[p.status];
  const pct = p.total ? Math.min(100, Math.round((p.contagem / p.total) * 100)) : null;
  const corpo = `passo-${p.id}`;
  return (
    <li
      className={`rounded-2xl border bg-white transition-colors ${
        naTela && p.status !== "ok"
          ? "border-sky-300 shadow-[0_0_0_3px_rgba(14,165,233,0.12)]"
          : atual
            ? "border-[var(--gold)]"
            : "border-border"
      }`}
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-2xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
        aria-expanded={aberto}
        aria-controls={corpo}
        onClick={() => onAbrir(!aberto)}
      >
        <span
          className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-xs font-bold ${
            p.status === "ok"
              ? "bg-green-600 text-white"
              : atual
                ? "bg-[var(--navy)] text-white"
                : "bg-[var(--surface)] text-[var(--navy)]"
          }`}
          aria-hidden
        >
          {p.status === "ok" ? <CheckCircle2 size={16} /> : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold leading-tight">{p.titulo}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${selo.cls}`}
            >
              {selo.txt}
            </span>
          </span>
          {p.contagem > 0 && (
            <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
              {int(p.contagem)}
              {p.total ? ` de ${int(p.total)}` : ""} registros lidos
            </span>
          )}
        </span>
        <ChevronDown
          size={16}
          className={`flex-shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${aberto ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {aberto && (
        <div id={corpo} className="space-y-3 border-t border-border px-3 pb-3 pt-3">
          <p className="text-xs leading-snug text-muted-foreground">{p.serve}</p>
          <ol className="space-y-1.5">
            {p.instrucoes.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm leading-snug">
                <span
                  className="mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-[var(--surface)] text-[11px] font-bold"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ol>

          {naTela ? (
            <p
              className="flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800"
              aria-live="polite"
            >
              <ScanLine
                size={15}
                className="flex-shrink-0 animate-pulse motion-reduce:animate-none"
                aria-hidden
              />
              {leitura
                ? leitura.texto
                : "O guia está nesta página. Assim que a tabela aparecer, ele lê."}
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {!janelaAberta
                  ? "Clique em Sincronizar e entre no Hypnobox."
                  : outraTela
                    ? `O guia está em ${outraTela}.`
                    : "Abra esta página e clique no favorito Guia da coleta."}
              </span>
              <button
                type="button"
                className={`${B_DOURADO} h-9`}
                disabled={!janelaAberta}
                onClick={onIr}
              >
                Ir para a página <ArrowRight size={15} aria-hidden />
              </button>
            </div>
          )}

          {pct != null && p.status !== "ok" && (
            <div className="h-1.5 overflow-hidden rounded-full bg-sky-100" aria-hidden>
              <div
                className="h-full rounded-full bg-sky-500 transition-[width] motion-reduce:transition-none"
                style={{ width: `${Math.max(pct, 3)}%` }}
              />
            </div>
          )}

          {p.avisos.length > 0 && (
            <ul className="space-y-1">
              {p.avisos.map((a) => (
                <li key={a} className="flex items-start gap-1.5 text-xs text-amber-800">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" aria-hidden /> {a}
                </li>
              ))}
            </ul>
          )}

          {p.contagem > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <button type="button" className={B_LINK} onClick={onLimpar}>
                <RotateCcw size={12} aria-hidden /> Apagar e ler de novo
              </button>
              {p.status !== "ok" && (
                <button type="button" className={`${B_CONTORNO} h-9`} onClick={onConcluir}>
                  <CheckCircle2 size={15} aria-hidden /> Já passei por todas as páginas
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ItemLen({
  it,
  bloqueado,
  onRodar,
  onParar,
}: {
  it: EstadoLen;
  bloqueado: boolean;
  onRodar: () => void;
  onParar: () => void;
}) {
  const selo = SELO[it.status];
  const prog = it.progresso;
  const pct = prog && prog.total ? Math.round((prog.feito / prog.total) * 100) : null;
  const ate = it.resultado?.resumo.janelas[0]?.ate;
  return (
    <section aria-labelledby="coleta-len" className="rounded-2xl border border-border bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 id="coleta-len" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            Dash da LEN
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${selo.cls}`}>
              {selo.txt}
            </span>
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Roda sozinho ao sincronizar, pelo servidor.
            {it.status === "ok" && it.linhas != null ? ` ${int(it.linhas)} linhas` : ""}
            {it.status === "ok" && it.concluidoEm ? ` · ${brDataHora(it.concluidoEm)}` : ""}
          </p>
        </div>
        {it.status === "rodando" ? (
          <button type="button" className={`${B_CONTORNO} h-9 text-red-700`} onClick={onParar}>
            <Square size={14} aria-hidden /> Parar
          </button>
        ) : (
          <button
            type="button"
            className={`${B_CONTORNO} h-9`}
            disabled={bloqueado}
            onClick={onRodar}
          >
            <RefreshCw size={15} aria-hidden /> {it.status === "ok" ? "De novo" : "Sincronizar"}
          </button>
        )}
      </div>
      {prog && (
        <div className="mt-3" aria-live="polite">
          <div className="flex justify-between text-xs text-sky-800">
            <span className="truncate">{prog.texto}</span>
            {pct != null && <span className="tabular-nums">{pct}%</span>}
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sky-100">
            <div
              className="h-full rounded-full bg-sky-500 transition-[width] motion-reduce:transition-none"
              style={{ width: `${Math.max(pct ?? 3, 3)}%` }}
            />
          </div>
        </div>
      )}
      {it.erro && it.status === "erro" && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {it.erro}
        </p>
      )}
      {it.status === "ok" && ate && (
        <p className="mt-2 text-xs text-muted-foreground">
          Dados do dash até {brDate(ate)}. A LEN às vezes atrasa a base de CRM em alguns dias.
        </p>
      )}
    </section>
  );
}

const NOMES_TABELA: Record<string, string> = {
  al_leads: "Leads",
  al_visitas: "Visitas",
  al_mensagens_corretor: "Mensagens por corretor",
  al_mensagens_horario: "Mensagens por horário",
  al_funil_produto: "Funil por empreendimento",
  al_status_geral: "Status (LEN)",
  al_fontes: "Fontes (LEN)",
  al_descarte: "Descarte (LEN)",
  al_veiculo: "Veículos (LEN)",
  al_mkt_campanhas: "Campanhas",
  al_mkt_diario: "Mídia por dia",
  al_mkt_anuncios: "Anúncios",
  al_mkt_palavras: "Palavras-chave",
};

function Checagens({ itens }: { itens: Checagem[] }) {
  if (!itens.length) return null;
  return (
    <ul className="space-y-1 text-xs">
      {itens.map((c) => (
        <li
          key={c.nome}
          className={`flex items-center gap-2 ${c.alerta ? "text-amber-800" : "text-muted-foreground"}`}
        >
          {c.alerta ? (
            <AlertTriangle size={13} aria-hidden />
          ) : (
            <CheckCircle2 size={13} className="text-green-600" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">{c.nome}</span>
          <span className="tabular-nums font-semibold">{c.texto}</span>
          <span className="tabular-nums">(14/10: {c.referenciaTexto})</span>
        </li>
      ))}
    </ul>
  );
}

function Gravar({
  gravacao,
  disabled,
  onGravar,
}: {
  gravacao: Gravacao;
  disabled: boolean;
  onGravar: (forcar?: boolean) => void;
}) {
  return (
    <section
      aria-labelledby="coleta-gravar"
      className="rounded-2xl border border-border p-3"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="coleta-gravar" className="text-sm font-semibold">
            Gravar no banco
          </h3>
          <p className="text-xs text-muted-foreground">
            Leads e visitas: atualiza os que existem e insere os novos.
          </p>
        </div>
        <button
          type="button"
          className={`${B_PRIMARIO} h-9`}
          disabled={disabled}
          onClick={() => onGravar(false)}
        >
          {gravacao.fase === "lendo" || gravacao.fase === "gravando" ? (
            <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Database size={15} aria-hidden />
          )}
          {gravacao.fase === "lendo"
            ? "Conferindo…"
            : gravacao.fase === "gravando"
              ? "Gravando…"
              : "Gravar"}
        </button>
      </div>

      {gravacao.fase === "confirmar" && (
        <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">
            Números bem diferentes da coleta de 14/10
          </p>
          <Checagens itens={gravacao.carga.checagens} />
          <p className="text-xs text-amber-900/80">
            Confira antes de gravar. Se estiver certo, grave assim mesmo.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={`${B_DOURADO} h-9`} onClick={() => onGravar(true)}>
              Gravar assim mesmo
            </button>
          </div>
        </div>
      )}

      {gravacao.fase === "ok" && (
        <div className="mt-3 space-y-2 rounded-xl border border-green-200 bg-green-50 p-3 text-xs text-green-900">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <CheckCircle2 size={15} aria-hidden /> Gravado às {brDataHora(gravacao.em)}
          </p>
          <ul className="grid gap-0.5">
            {Object.entries(gravacao.resultado).map(([t, r]) => (
              <li key={t} className="flex justify-between gap-2">
                <span>{NOMES_TABELA[t] ?? t}</span>
                <span className="tabular-nums">
                  {r.substituidos != null
                    ? `${r.substituidos.toLocaleString("pt-BR")} linhas`
                    : `${(r.inseridos ?? 0).toLocaleString("pt-BR")} novos · ${(r.atualizados ?? 0).toLocaleString("pt-BR")} atualizados`}
                </span>
              </li>
            ))}
          </ul>
          <Checagens itens={gravacao.checagens} />
        </div>
      )}

      {gravacao.fase === "erro" && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"
        >
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
          {gravacao.erro}
        </p>
      )}
    </section>
  );
}
