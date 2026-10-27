import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Timer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Mapeamento de tempo das funções da extensão (só o admin vê): por ação, nos
// últimos dias, quantas vezes, tempo médio e máximo e erros. "faixa" é o tempo
// que o corretor esperou; "servidor" é o tempo da rota por dentro do servidor.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as SupabaseClient<any>;

type Linha = { origem: "faixa" | "servidor"; acao: string; n: number; ms_total: number; ms_max: number; erros: number };

const NOMES: Record<string, string> = {
  "acao:abrir-conversa": "Abrir conversa (cliente na faixa)",
  "acao:sincronizar-mensagem-nova": "Guardar mensagem nova",
  "acao:sugerir": "Sugerir resposta",
  "acao:transcrever": "Transcrever áudio",
  "acao:lista": "Carregar a lista de clientes",
  "acao:vincular": "Vincular cliente",
  "acao:busca": "Buscar cliente",
  "acao:etiqueta": "Etiquetas",
  "acao:prazo": "Prazo de contato",
  "acao:publico": "Baixar público (CSV)",
  "acao:login": "Entrar na faixa",
  "acao:abrir": "Abrir conversa pela lista",
};
const nome = (a: string) => NOMES[a] ?? a.replace(/^(acao|api|wa):/, (_, t) => ({ acao: "Ação: ", api: "API: ", wa: "WhatsApp: " })[t as "acao"]);
const seg = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1).replace(".", ",")} s` : `${Math.round(ms)} ms`);
const cor = (ms: number) => (ms >= 5000 ? "text-red-700" : ms >= 2000 ? "text-amber-700" : "text-green-700");

export function TemposExtensao() {
  const [dias, setDias] = useState(7);
  const q = useQuery({
    queryKey: ["ext-metricas", dias],
    queryFn: async (): Promise<Linha[]> => {
      const desde = new Date(Date.now() - (dias - 1) * 864e5 - 3 * 3600e3).toISOString().slice(0, 10);
      const { data, error } = await db
        .from("ext_metricas")
        .select("origem, acao, n, ms_total, ms_max, erros")
        .gte("dia", desde)
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as Linha[];
    },
  });

  // soma dias e usuários; separa o que o corretor viu (ações) dos detalhes (API e WhatsApp)
  const grupos = useMemo(() => {
    const m = new Map<string, Linha>();
    for (const l of q.data ?? []) {
      const k = `${l.origem}|${l.acao}`;
      const t = m.get(k) ?? { ...l, n: 0, ms_total: 0, ms_max: 0, erros: 0 };
      t.n += l.n;
      t.ms_total += l.ms_total;
      t.ms_max = Math.max(t.ms_max, l.ms_max);
      t.erros += l.erros;
      m.set(k, t);
    }
    const todas = [...m.values()].sort((a, b) => b.ms_total / b.n - a.ms_total / a.n);
    return {
      acoes: todas.filter((l) => l.origem === "faixa" && l.acao.startsWith("acao:")),
      detalhes: todas.filter((l) => !(l.origem === "faixa" && l.acao.startsWith("acao:"))),
    };
  }, [q.data]);

  const tabela = (linhas: Linha[], mostrarOrigem: boolean) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-2 font-semibold">Função</th>
            {mostrarOrigem && <th className="py-1 pr-2 font-semibold">Onde</th>}
            <th className="py-1 pr-2 text-right font-semibold">Vezes</th>
            <th className="py-1 pr-2 text-right font-semibold">Média</th>
            <th className="py-1 pr-2 text-right font-semibold">Máximo</th>
            <th className="py-1 text-right font-semibold">Erros</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const media = l.ms_total / l.n;
            return (
              <tr key={`${l.origem}|${l.acao}`} className="border-t border-border">
                <td className="py-1.5 pr-2">{nome(l.acao)}</td>
                {mostrarOrigem && <td className="py-1.5 pr-2 text-muted-foreground">{l.origem === "faixa" ? "Faixa" : "Servidor"}</td>}
                <td className="py-1.5 pr-2 text-right tabular-nums">{l.n}</td>
                <td className={`py-1.5 pr-2 text-right font-semibold tabular-nums ${cor(media)}`}>{seg(media)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{seg(l.ms_max)}</td>
                <td className={`py-1.5 text-right tabular-nums ${l.erros ? "font-semibold text-red-700" : ""}`}>
                  {l.erros ? `${l.erros} (${Math.round((l.erros / l.n) * 100)}%)` : "0"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className="rounded-2xl border border-border bg-white p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Timer size={18} aria-hidden /> Tempos da extensão
        </h2>
        <label className="text-xs text-muted-foreground">
          Período{" "}
          <select
            className="ml-1 h-8 rounded-lg border border-border bg-white px-2 text-xs text-[var(--navy)]"
            value={dias}
            onChange={(e) => setDias(Number(e.target.value))}
          >
            <option value={1}>Hoje</option>
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
          </select>
        </label>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Só o admin vê. Média em verde até 2 s, âmbar até 5 s, vermelho acima. As ações são o tempo que o corretor esperou;
        os detalhes separam a API (faixa e servidor) e os pedidos ao WhatsApp Web, para achar onde está a demora.
      </p>
      {q.isError ? (
        <p className="text-sm text-red-700">Não foi possível ler os tempos (a migration 20261027000006 já rodou?).</p>
      ) : q.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !grupos.acoes.length && !grupos.detalhes.length ? (
        <p className="text-sm text-muted-foreground">Ainda não há medições neste período.</p>
      ) : (
        <div className="space-y-4">
          {grupos.acoes.length > 0 && tabela(grupos.acoes, false)}
          {grupos.detalhes.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-[var(--gold-dark)]">
                Detalhes: API e WhatsApp Web ({grupos.detalhes.length})
              </summary>
              <div className="mt-2">{tabela(grupos.detalhes, true)}</div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
