import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, KeyRound, Loader2, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { AppHeader } from "@/components/AppHeader";
import { confirmDialog } from "@/components/ConfirmDialog";
import { B_CONTORNO, B_PRIMARIO, CAMPO, useExtensaoLiberada } from "@/components/extensao/comum";
import { estadoExtensao, removerChaveIa, salvarChaveIa } from "@/lib/extensao.functions";

export const Route = createFileRoute("/_authenticated/settings/chave-ia")({
  component: ChaveIaPage,
});

const STATUS: Record<string, { txt: string; cls: string }> = {
  ok: { txt: "Funcionando", cls: "bg-green-100 text-green-800" },
  invalida: { txt: "Recusada pelo Groq", cls: "bg-red-100 text-red-700" },
  limite: { txt: "Limite grátis do dia atingido", cls: "bg-amber-100 text-amber-800" },
};

const brData = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const PASSOS = [
  <>
    Abra o{" "}
    <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" className="font-semibold underline">
      console.groq.com
    </a>{" "}
    e entre com a sua conta Google (é grátis, não pede cartão).
  </>,
  <>
    No menu, clique em <b>API Keys</b> e depois em <b>Create API Key</b>.
  </>,
  <>
    Dê um nome (por exemplo, <i>Gestão Comercial</i>) e clique em <b>Submit</b>.
  </>,
  <>
    Copie a chave que aparece (começa com <b>gsk_</b>). O Groq mostra a chave uma vez só.
  </>,
  <>Cole a chave aqui embaixo e clique em Testar e salvar.</>,
];

function ChaveIaPage() {
  const liberada = useExtensaoLiberada();
  const qc = useQueryClient();
  const estado = useQuery({ queryKey: ["extensao-estado"], queryFn: () => estadoExtensao(), enabled: liberada });
  const [chave, setChave] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const atual = estado.data?.chave;

  const salvar = async () => {
    setErro(null);
    setSalvando(true);
    try {
      const r = await salvarChaveIa({ data: { chave } });
      if (!r.ok) setErro(r.mensagem);
      else {
        setChave("");
        toast.success("Chave testada e salva");
        await qc.invalidateQueries({ queryKey: ["extensao-estado"] });
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message.replace(/^.*?: /, "") : String(e));
    } finally {
      setSalvando(false);
    }
  };

  const remover = async () => {
    if (
      !(await confirmDialog({
        title: "Remover a chave?",
        description: "As sugestões e transcrições param até você cadastrar outra.",
        confirmLabel: "Remover",
        danger: true,
      }))
    )
      return;
    await removerChaveIa();
    await qc.invalidateQueries({ queryKey: ["extensao-estado"] });
  };

  return (
    <div className="pb-nav">
      <AppHeader
        title="Minha chave de IA"
        left={
          <button onClick={() => window.history.back()} className="text-white/70 hover:text-white p-1.5 -ml-1.5" aria-label="Voltar">
            <ArrowLeft size={20} />
          </button>
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
                <KeyRound size={18} aria-hidden /> Sua chave do Groq
              </h2>
              <p className="mb-4 text-sm text-muted-foreground">
                A extensão usa esta chave para sugerir respostas e transcrever áudios. O plano grátis do Groq basta.
                A chave fica guardada cifrada no servidor e vale em qualquer computador; ela não aparece de novo na tela.
              </p>
              {estado.isLoading ? (
                <Loader2 className="animate-spin text-muted-foreground" size={18} aria-label="Carregando" />
              ) : atual ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--surface)] p-3">
                  <div className="text-sm">
                    <p className="font-semibold tabular-nums">gsk_…{atual.final4}</p>
                    <p className="text-xs text-muted-foreground">
                      Testada em {brData(atual.testada_em)} · último uso {brData(atual.ultimo_uso_em)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[atual.status]?.cls ?? ""}`}>
                      {STATUS[atual.status]?.txt ?? atual.status}
                    </span>
                    <button type="button" className={`${B_CONTORNO} h-9`} onClick={remover}>
                      <Trash2 size={15} aria-hidden /> Remover
                    </button>
                  </div>
                </div>
              ) : (
                <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Você ainda não cadastrou uma chave.</p>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-white p-5">
              <h2 className="mb-3 text-base font-semibold">{atual ? "Trocar a chave" : "Como criar a sua chave"}</h2>
              <ol className="mb-4 space-y-2">
                {PASSOS.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-snug">
                    <span className="mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-[var(--surface)] text-[11px] font-bold" aria-hidden>
                      {i + 1}
                    </span>
                    <span>{p}</span>
                  </li>
                ))}
              </ol>
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void salvar();
                }}
              >
                <label className="sr-only" htmlFor="chave-groq">
                  Chave do Groq
                </label>
                <input
                  id="chave-groq"
                  className={CAMPO}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="gsk_..."
                  value={chave}
                  onChange={(e) => setChave(e.target.value.trim())}
                />
                <button type="submit" className={B_PRIMARIO} disabled={salvando || chave.length < 20}>
                  {salvando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <CheckCircle2 size={15} aria-hidden />}
                  Testar e salvar
                </button>
              </form>
              {erro && (
                <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden /> {erro}
                </p>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                Limites grátis: o Groq mostra os da sua conta em{" "}
                <a href="https://console.groq.com/settings/limits" target="_blank" rel="noopener noreferrer" className="underline">
                  Settings › Limits <ExternalLink size={10} className="inline" aria-hidden />
                </a>
                . Se o limite do dia acabar, as funções de IA voltam no dia seguinte; o resto da extensão continua funcionando.
              </p>
            </section>

            <Link to="/extensao" className="block text-center text-sm font-semibold text-[var(--gold-dark)] underline-offset-2 hover:underline">
              Voltar para a guia da extensão
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
