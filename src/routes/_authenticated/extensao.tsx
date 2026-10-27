import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  Lock,
  Puzzle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { B_CONTORNO, B_PRIMARIO, useExtensaoLiberada } from "@/components/extensao/comum";
import { TemposExtensao } from "@/components/extensao/TemposExtensao";
import { useAuth } from "@/hooks/useAuth";
import { estadoExtensao } from "@/lib/extensao.functions";
import { ARQUIVO_EXTENSAO, PASSOS_EXTENSAO, type PassoExtensao } from "@/lib/extensao/guia";

export const Route = createFileRoute("/_authenticated/extensao")({
  component: ExtensaoPage,
});

const brData = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";

/** Compara versões "0.1.0". */
const maisAntiga = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
};

function ExtensaoPage() {
  const liberada = useExtensaoLiberada();
  const { isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const estado = useQuery({
    queryKey: ["extensao-estado"],
    queryFn: () => estadoExtensao(),
    enabled: liberada,
    // a extensão marca passos sozinha (instalar, login, vincular...): a guia acompanha
    refetchInterval: 15_000,
  });
  const [arquivoPronto, setArquivoPronto] = useState<boolean | null>(null);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch(ARQUIVO_EXTENSAO, { method: "HEAD" })
      .then((r) => setArquivoPronto(r.ok && !/text\/html/.test(r.headers.get("content-type") ?? "")))
      .catch(() => setArquivoPronto(false));
  }, []);

  const feitos = estado.data?.passos ?? {};
  // o Guia do WhatsApp (passo 9) só libera com a extensão instalada e logada (passos 1 a 4)
  const extensaoPronta = Boolean(feitos.instalar && feitos.login);
  const passoAtual = PASSOS_EXTENSAO.find((p) => !feitos[p.id])?.id ?? null;
  const total = PASSOS_EXTENSAO.filter((p) => feitos[p.id]).length;
  const inst = estado.data?.instalacao;
  const desatualizada = inst && estado.data && maisAntiga(inst.versao, estado.data.versaoPublicada);

  const marcar = async (passo: "baixar" | "disparo") => {
    await supabase.rpc("ext_concluir_passo" as never, { _passo: passo } as never);
    await qc.invalidateQueries({ queryKey: ["extensao-estado"] });
  };

  return (
    <div className="pb-nav">
      <AppHeader
        title="Extensão WhatsApp"
        right={
          <span className="rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white" title="Em teste com o piloto">
            BETA
          </span>
        }
      />
      <div className="mx-auto max-w-2xl space-y-4 px-4 pb-6 pt-4 text-[var(--navy)]">
        {!liberada ? (
          <p className="rounded-2xl border border-border bg-white p-5 text-sm">
            A extensão do WhatsApp ainda está em teste e não foi liberada para a sua conta.
          </p>
        ) : (
          <>
            <section className="rounded-2xl border border-border bg-white p-5">
              <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
                <Puzzle size={18} aria-hidden /> Extensão do WhatsApp
              </h2>
              <p className="text-sm text-muted-foreground">
                As conversas com os clientes acontecem no WhatsApp Web, no computador, com a extensão do Gestão
                Comercial: uma faixa ao lado da conversa com o cliente do Hypnobox, há quanto tempo ele está parado,
                sugestões de resposta e transcrição de áudios. Ela não envia nada sozinha. Instale seguindo os passos
                abaixo.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {arquivoPronto ? (
                  <a href={ARQUIVO_EXTENSAO} download className={B_PRIMARIO} onClick={() => void marcar("baixar")}>
                    <Download size={15} aria-hidden /> Baixar a extensão
                  </a>
                ) : (
                  <span className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {arquivoPronto === null ? "Verificando o arquivo…" : "A extensão está sendo preparada. O download aparece aqui quando estiver pronto."}
                  </span>
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Ao instalar e entrar na extensão, você aceita o{" "}
                <a href="/termo-extensao" target="_blank" rel="noopener noreferrer" className="underline">
                  termo de uso
                </a>
                . Versão publicada:{" "}
                {estado.data?.versaoPublicada ?? "…"}
                {inst ? ` · a sua: ${inst.versao} (usada em ${brData(inst.ultimo_acesso_em)})` : ""}
              </p>
              {desatualizada && (
                <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden />
                  A extensão instalada é de uma versão antiga. Baixe de novo, extraia por cima da pasta antiga e clique em
                  ↻ (Recarregar) na extensão, em chrome://extensions.
                </p>
              )}
            </section>

            <section aria-labelledby="ext-roteiro">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 id="ext-roteiro" className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Primeiros passos
                </h3>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {total} de {PASSOS_EXTENSAO.length} feitos
                </span>
              </div>
              {passoAtual && (
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--gold)] bg-white p-3">
                  <span className="text-sm">
                    Próximo passo: <b>{PASSOS_EXTENSAO.find((p) => p.id === passoAtual)?.titulo}</b>
                  </span>
                  <button
                    type="button"
                    className={`${B_PRIMARIO} h-9`}
                    onClick={() => {
                      setAbertos((x) => ({ ...x, [passoAtual]: true }));
                      document.getElementById(`passo-${passoAtual}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                  >
                    Ver como fazer <ArrowRight size={15} aria-hidden />
                  </button>
                </div>
              )}
              <ol className="space-y-2">
                {PASSOS_EXTENSAO.map((p, i) => (
                  <PassoGuia
                    key={p.id}
                    n={i + 1}
                    p={p}
                    feitoEm={feitos[p.id] ?? null}
                    atual={passoAtual === p.id}
                    aberto={abertos[p.id] ?? passoAtual === p.id}
                    onAbrir={(v) => setAbertos((x) => ({ ...x, [p.id]: v }))}
                    onMarcar={p.manual ? () => void marcar(p.id as "baixar" | "disparo") : undefined}
                    bloqueado={p.id === "disparo" && !extensaoPronta}
                  />
                ))}
              </ol>
              {!passoAtual && (
                <p className="mt-3 flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                  <CheckCircle2 size={16} aria-hidden /> Tudo pronto. A extensão já está trabalhando com você.
                </p>
              )}
            </section>

            {isSuperAdmin && <TemposExtensao />}
          </>
        )}
      </div>
    </div>
  );
}


function PassoGuia({
  n,
  p,
  feitoEm,
  atual,
  aberto,
  onAbrir,
  onMarcar,
  bloqueado = false,
  extra = null,
}: {
  n: number;
  p: PassoExtensao;
  feitoEm: string | null;
  atual: boolean;
  aberto: boolean;
  onAbrir: (v: boolean) => void;
  onMarcar?: () => void;
  /** liberado só depois de outros passos */
  bloqueado?: boolean;
  extra?: ReactNode;
}) {
  const corpo = `passo-corpo-${p.id}`;
  return (
    <li id={`passo-${p.id}`} className={`rounded-2xl border bg-white ${atual ? "border-[var(--gold)]" : "border-border"}`}>
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-2xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
        aria-expanded={aberto}
        aria-controls={corpo}
        onClick={() => onAbrir(!aberto)}
      >
        <span
          className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-xs font-bold ${
            feitoEm ? "bg-green-600 text-white" : atual ? "bg-[var(--navy)] text-white" : "bg-[var(--surface)] text-[var(--navy)]"
          }`}
          aria-hidden
        >
          {feitoEm ? <CheckCircle2 size={16} /> : bloqueado ? <Lock size={13} /> : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-tight">{p.titulo}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {feitoEm
              ? `Feito em ${brData(feitoEm)}`
              : bloqueado
                ? "Libera depois de instalar e entrar na extensão"
                : p.manual
                  ? "Marque quando terminar"
                  : "Marca sozinho quando o sistema perceber"}
          </span>
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
                <span className="mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-[var(--surface)] text-[11px] font-bold" aria-hidden>
                  {i + 1}
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
          {bloqueado ? (
            <p className="flex items-start gap-2 rounded-xl bg-[var(--surface)] p-3 text-xs leading-snug">
              <Lock size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
              O guia do disparo fica na aba Disparo da faixa: libera quando a extensão estiver instalada e você tiver entrado nela (passos 1 a 4).
            </p>
          ) : (
            extra
          )}
          <div className="flex flex-wrap gap-2">
            {p.link &&
              (p.link.externo ? (
                <a href={p.link.href} target="_blank" rel="noopener noreferrer" className={`${B_CONTORNO} h-9`}>
                  {p.link.texto} <ExternalLink size={14} aria-hidden />
                </a>
              ) : (
                <Link to={p.link.href} className={`${B_CONTORNO} h-9`}>
                  {p.link.texto} <ArrowRight size={14} aria-hidden />
                </Link>
              ))}
            {onMarcar && !feitoEm && (
              <button type="button" className={`${B_PRIMARIO} h-9`} onClick={onMarcar}>
                <CheckCircle2 size={15} aria-hidden /> Marcar como feito
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
