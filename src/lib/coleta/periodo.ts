/**
 * Período já coletado (do início da primeira coleta ao fim da última). A carga
 * completa do Hypnobox (todos os clientes, desde 2019) fica de fora: ela não é
 * uma coleta de período e puxaria o dash da LEN e o painel para anos atrás.
 */
export type ColetaPeriodo = {
  periodo_inicio: string | null;
  periodo_fim: string | null;
  fontes?: string | null;
};

export const ehCargaCompleta = (c: ColetaPeriodo) => /carga completa/i.test(c.fontes ?? "");

export function periodoColetado(coletas: ColetaPeriodo[]): { de: string; ate: string } | null {
  const doPeriodo = coletas.filter((c) => !ehCargaCompleta(c));
  const inicios = doPeriodo
    .map((c) => c.periodo_inicio)
    .filter((x): x is string => !!x)
    .sort();
  const fins = doPeriodo
    .map((c) => c.periodo_fim)
    .filter((x): x is string => !!x)
    .sort();
  return inicios.length && fins.length ? { de: inicios[0], ate: fins[fins.length - 1] } : null;
}
