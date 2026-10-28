import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, CheckCircle2, ExternalLink, Loader2, Lock, Plus, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";
import {
  abrirConferencia,
  informarVisita,
  removerVisitaInformada,
  responderVisita,
  type Conferencia,
  type VisitaConferencia,
  type VisitaInformada,
} from "@/lib/conferencia.functions";
import { linkHypnobox } from "@/lib/extensao/links";

// Página pública (sem login): o corretor abre o link único que o gestor mandou
// (corretor + período) e diz, visita a visita, se ela aconteceu.
export const Route = createFileRoute("/conferir/$token")({
  component: ConferirAgendaPage,
});

const dataBr = (iso: string) => format(parseISO(iso), "dd/MM/yyyy");

function ConferirAgendaPage() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const chaveQuery = ["conferir-agenda", token];
  const q = useQuery({
    queryKey: chaveQuery,
    queryFn: () => abrirConferencia({ data: { token } }),
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (q.isLoading)
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--surface)]">
        <Loader2 className="animate-spin text-[var(--gold)]" size={32} aria-label="Carregando" />
      </div>
    );

  if (q.isError || !q.data)
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[var(--surface)] px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600">
          <Lock size={32} aria-hidden />
        </div>
        <h2 className="text-xl font-bold text-[var(--navy)]">Link indisponível</h2>
        <p className="text-muted-foreground">{(q.error as Error | null)?.message}</p>
      </div>
    );

  const d = q.data;
  const feitas = d.visitas.filter((v) => v.aconteceu !== null).length;
  const atualizar = (chave: string, aconteceu: boolean | null, observacao: string) =>
    qc.setQueryData<Conferencia>(chaveQuery, (old) =>
      old ? { ...old, visitas: old.visitas.map((v) => (v.chave === chave ? { ...v, aconteceu, observacao } : v)) } : old,
    );

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-16">
      <header className="bg-[var(--navy)] px-5 py-5 text-white">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-xl font-bold">Olá, {d.nome}!</h1>
          <p className="text-sm text-white/70">
            Suas visitas de {dataBr(d.de)} a {dataBr(d.ate)}. Conte pra gente quais aconteceram.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4 text-[var(--navy)]">
        {d.visitas.length === 0 ? (
          <div className="rounded-2xl border border-border bg-white p-6 text-center text-sm text-muted-foreground">
            Nenhuma visita na sua agenda do Hypnobox nesse período. Fez alguma? Informe logo abaixo.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white p-4">
              <span className="text-sm">
                <b className="tabular-nums">
                  {feitas} de {d.visitas.length}
                </b>{" "}
                conferidas
              </span>
              <div className="h-2 flex-1 max-w-48 overflow-hidden rounded-full bg-[var(--surface)]" aria-hidden>
                <div className="h-full bg-[var(--gold)] transition-all" style={{ width: `${(feitas / d.visitas.length) * 100}%` }} />
              </div>
            </div>
            {feitas === d.visitas.length && (
              <p className="flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                <CheckCircle2 size={16} aria-hidden /> Pronto, tudo conferido. Obrigado! Se precisar, ainda dá para mudar.
              </p>
            )}
            <ul className="space-y-3">
              {d.visitas.map((v) => (
                <CartaoVisita key={v.chave} token={token} v={v} onSalvo={atualizar} />
              ))}
            </ul>
          </>
        )}
        <ForaDaAgenda
          token={token}
          d={d}
          aberto={d.visitas.length === 0}
          onMudou={(informadas) => qc.setQueryData<Conferencia>(chaveQuery, (old) => (old ? { ...old, informadas } : old))}
        />
      </div>
    </div>
  );
}

/** Visitas que o corretor fez e que não estão na agenda do Hypnobox. */
function ForaDaAgenda({
  token,
  d,
  aberto,
  onMudou,
}: {
  token: string;
  d: Conferencia;
  aberto: boolean;
  onMudou: (informadas: VisitaInformada[]) => void;
}) {
  const [mostrar, setMostrar] = useState(aberto);
  const [idCliente, setIdCliente] = useState("");
  const [produto, setProduto] = useState("");
  const [dia, setDia] = useState("");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);
  const campo =
    "mt-1 h-10 w-full rounded-xl border border-border bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]";

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const nova = await informarVisita({ data: { token, id_cliente: idCliente, produto, data: dia, observacao: obs } });
      onMudou([...d.informadas, nova].sort((a, b) => a.data.localeCompare(b.data)));
      setIdCliente("");
      setProduto("");
      setDia("");
      setObs("");
      toast.success("Visita informada");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSalvando(false);
    }
  };
  const remover = async (id: string) => {
    try {
      await removerVisitaInformada({ data: { token, id } });
      onMudou(d.informadas.filter((v) => v.id !== id));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-white p-4" aria-labelledby="fora-agenda">
      <h2 id="fora-agenda" className="text-base font-bold">
        Visitas que não estão na agenda
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Fez alguma visita nesse período que não aparece aqui? Informe o cliente, o produto e o dia.
      </p>

      {d.informadas.length > 0 && (
        <ul className="mt-3 space-y-2">
          {d.informadas.map((v) => (
            <li key={v.id} className="flex items-start justify-between gap-3 rounded-xl bg-[var(--surface)] p-3">
              <div className="min-w-0 text-sm">
                <p className="font-semibold capitalize">{format(parseISO(v.data), "EEE, dd/MM", { locale: ptBR })}</p>
                <p className="font-bold">Cliente {v.id_cliente}</p>
                <p className="text-muted-foreground">{v.produto}</p>
                {v.observacao && <p className="mt-1 text-muted-foreground">{v.observacao}</p>}
              </div>
              <div className="flex flex-shrink-0 gap-1">
                <a
                  href={linkHypnobox(v.id_cliente)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center gap-1 rounded-xl border border-border bg-white px-2.5 text-sm font-semibold"
                >
                  Hypnobox <ExternalLink size={14} aria-hidden />
                </a>
                <button
                  type="button"
                  onClick={() => void remover(v.id)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-white text-red-600"
                  aria-label={`Remover a visita do cliente ${v.id_cliente}`}
                  title="Remover"
                >
                  <Trash2 size={15} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!mostrar ? (
        <button
          type="button"
          onClick={() => setMostrar(true)}
          className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-[var(--surface)]"
        >
          <Plus size={16} aria-hidden /> Informar uma visita
        </button>
      ) : (
        <form onSubmit={(e) => void enviar(e)} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">ID do cliente no Hypnobox</span>
            <input
              value={idCliente}
              onChange={(e) => setIdCliente(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              required
              placeholder="Ex.: 194155"
              className={campo}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">Dia da visita</span>
            <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} min={d.de} max={d.ate} required className={campo} />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-semibold text-muted-foreground">Produto</span>
            <input
              value={produto}
              onChange={(e) => setProduto(e.target.value)}
              list="produtos-visita"
              required
              placeholder="Comece a digitar e escolha da lista"
              className={campo}
            />
            <datalist id="produtos-visita">
              {d.produtos.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-semibold text-muted-foreground">Observação (opcional)</span>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Ex.: visitou o decorado com a família, vai voltar no sábado"
              className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
            />
          </label>
          <button
            type="submit"
            disabled={salvando}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[var(--navy)] px-4 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2"
          >
            {salvando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />} Salvar visita
          </button>
        </form>
      )}
    </section>
  );
}

function CartaoVisita({
  token,
  v,
  onSalvo,
}: {
  token: string;
  v: VisitaConferencia;
  onSalvo: (chave: string, aconteceu: boolean | null, observacao: string) => void;
}) {
  const [obs, setObs] = useState(v.observacao);
  const [salvando, setSalvando] = useState(false);
  const salvar = async (aconteceu: boolean | null, observacao = obs) => {
    setSalvando(true);
    try {
      await responderVisita({ data: { token, chave: v.chave, aconteceu, observacao } });
      onSalvo(v.chave, aconteceu, observacao);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };
  const dia = format(parseISO(v.data), "EEE, dd/MM", { locale: ptBR });
  const botao = (ativo: boolean, cor: string) =>
    `inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors disabled:opacity-60 ${
      ativo ? cor : "border-border bg-white text-[var(--navy)] hover:bg-[var(--surface)]"
    }`;

  return (
    <li className="rounded-2xl border border-border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold capitalize">
            {dia}
            {v.hora && v.hora !== "00:00" ? ` · ${v.hora}` : ""}
          </p>
          <p className="mt-0.5 text-base font-bold">Cliente {v.id_cliente}</p>
          <p className="text-sm text-muted-foreground">{v.produto}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No Hypnobox: {v.status || "sem situação"}
            {v.registros > 1 ? ` · agendada ${v.registros} vezes` : ""}
          </p>
        </div>
        <a
          href={linkHypnobox(v.id_cliente)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-[var(--surface)]"
        >
          Hypnobox <ExternalLink size={14} aria-hidden />
        </a>
      </div>

      <div className="mt-3 flex gap-2" role="group" aria-label={`A visita do cliente ${v.id_cliente} aconteceu?`}>
        <button
          type="button"
          disabled={salvando}
          aria-pressed={v.aconteceu === true}
          className={botao(v.aconteceu === true, "border-green-600 bg-green-600 text-white")}
          onClick={() => void salvar(v.aconteceu === true ? null : true)}
        >
          <Check size={16} aria-hidden /> Aconteceu
        </button>
        <button
          type="button"
          disabled={salvando}
          aria-pressed={v.aconteceu === false}
          className={botao(v.aconteceu === false, "border-red-600 bg-red-600 text-white")}
          onClick={() => void salvar(v.aconteceu === false ? null : false)}
        >
          <X size={16} aria-hidden /> Não aconteceu
        </button>
      </div>

      {v.aconteceu !== null && (
        <label className="mt-3 block">
          <span className="text-xs font-semibold text-muted-foreground">
            {v.aconteceu ? "Algum comentário? (opcional)" : "O que houve? (opcional)"}
          </span>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            onBlur={() => obs !== v.observacao && void salvar(v.aconteceu, obs)}
            maxLength={500}
            rows={2}
            placeholder={v.aconteceu ? "Ex.: gostou da planta de 2 dormitórios" : "Ex.: cliente remarcou para sábado"}
            className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
          />
        </label>
      )}
    </li>
  );
}
