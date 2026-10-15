import { lerParteLen, type ParteLen } from "@/lib/coleta.functions";

export type DashLen = {
  de: string;
  ate: string;
  tabelas: ParteLen["tabelas"];
  investimentoPeriodo: number;
  janelas: ParteLen["janelas"];
};

/** Uma página do dash, repetida se a API da LEN falhar (ela oscila em alguns horários). */
async function lerPagina(indice: number, de: string, ate: string, tentativas = 3) {
  let erro: unknown;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await lerParteLen({ data: { indice, de, ate } });
    } catch (e) {
      erro = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  const msg = erro instanceof Error ? erro.message : String(erro);
  throw new Error(
    `a API da LEN está instável agora (${msg.slice(0, 140)}). Tente de novo em alguns minutos.`,
  );
}

/**
 * Lê o dash da LEN inteiro para um período: uma chamada de servidor por página
 * (são 18), várias ao mesmo tempo. `progresso(feitas, total)` acompanha.
 */
export async function lerDashLen(
  de: string,
  ate: string,
  progresso?: (feitas: number, total: number) => void,
  simultaneas = 3,
): Promise<DashLen> {
  const primeira = await lerPagina(0, de, ate);
  const partes: ParteLen[] = new Array(primeira.total);
  partes[0] = primeira;
  let feitas = 1;
  progresso?.(feitas, primeira.total);
  let proxima = 1;
  const trabalhador = async () => {
    while (proxima < primeira.total) {
      const i = proxima++;
      partes[i] = await lerPagina(i, de, ate);
      progresso?.(++feitas, primeira.total);
    }
  };
  await Promise.all(Array.from({ length: simultaneas }, trabalhador));

  const tabelas: ParteLen["tabelas"] = {};
  let investimentoPeriodo = 0;
  for (const p of partes) {
    investimentoPeriodo += p.investimentoPeriodo;
    for (const [t, linhas] of Object.entries(p.tabelas))
      tabelas[t] = t === "al_mkt_palavras" ? linhas : [...(tabelas[t] ?? []), ...linhas];
  }
  return { de, ate, tabelas, investimentoPeriodo, janelas: primeira.janelas };
}
