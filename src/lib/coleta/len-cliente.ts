import { lerParteLen, type ParteLen } from "@/lib/coleta.functions";

export type DashLen = {
  de: string;
  ate: string;
  tabelas: ParteLen["tabelas"];
  investimentoPeriodo: number;
  janelas: ParteLen["janelas"];
};

/**
 * Lê o dash da LEN inteiro para um período: uma chamada de servidor por página
 * (são 18), várias ao mesmo tempo. `progresso(feitas, total)` acompanha.
 */
export async function lerDashLen(
  de: string,
  ate: string,
  progresso?: (feitas: number, total: number) => void,
  simultaneas = 6,
): Promise<DashLen> {
  const primeira = await lerParteLen({ data: { indice: 0, de, ate } });
  const partes: ParteLen[] = new Array(primeira.total);
  partes[0] = primeira;
  let feitas = 1;
  progresso?.(feitas, primeira.total);
  let proxima = 1;
  const trabalhador = async () => {
    while (proxima < primeira.total) {
      const i = proxima++;
      partes[i] = await lerParteLen({ data: { indice: i, de, ate } });
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
