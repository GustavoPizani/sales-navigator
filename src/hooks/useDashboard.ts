import { useState, useMemo } from "react";
import { format, startOfMonth, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

export function useDashboardFilters() {
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [brokerId, setBrokerId] = useState("all");

  const applyDateRange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  return {
    startDate, setStartDate,
    endDate, setEndDate,
    brokerId, setBrokerId,
    appliedStartDate: startDate,
    appliedEndDate: endDate,
    appliedBrokerId: brokerId,
    applyDateRange,
    applyFilters: () => {},
  };
}

export function useDashboardData(atendimentos: any[]) {
  return useMemo(() => {
    let emTratativasSum = 0;
    let volumeVendasSum = 0;

    const monthlyData: Record<string, any> = {};

    atendimentos.forEach((a) => {
      if (a.status === "Em Tratativa") emTratativasSum += Number(a.valor) || 0;
      if (a.status === "Contrato Assinado") volumeVendasSum += Number(a.valor) || 0;

      const m = a.data.slice(0, 7); // yyyy-MM
      if (!monthlyData[m]) {
        monthlyData[m] = {
          name: format(parseISO(a.data), "MMM/yy", { locale: ptBR }),
          sortKey: m, Sim1: 0, Não1: 0, Sim2: 0, Não2: 0, Online: 0, Salão: 0, tratativasVal: 0, vendasVal: 0,
        };
      }

      if (a.visita) monthlyData[m].Sim1++; else monthlyData[m].Não1++;
      if (a.visita) {
        if (a.venda) monthlyData[m].Sim2++; else monthlyData[m].Não2++;
      }
      if (a.setor === "Online") monthlyData[m].Online++;
      else if (a.setor === "Salão") monthlyData[m].Salão++;

      if (a.status === "Contrato Gerado") monthlyData[m].tratativasVal += Number(a.valor) || 0;
      if (a.status === "Contrato Assinado") monthlyData[m].vendasVal += Number(a.valor) || 0;
    });

    const sorted = Object.values(monthlyData).sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    return {
      totalAtendimentos: atendimentos.length, totalVisitas: atendimentos.filter((a) => a.visita).length, totalVendas: atendimentos.filter((a) => a.venda).length,
      emTratativas: emTratativasSum, volumeVendas: volumeVendasSum,
      chart1Data: sorted.map((d) => ({ name: d.name, Sim: d.Sim1, Não: d.Não1 })), chart2Data: sorted.map((d) => ({ name: d.name, Sim: d.Sim2, Não: d.Não2 })), chart3Data: sorted.map((d) => ({ name: d.name, Online: d.Online, Salão: d.Salão })), chart4Data: sorted.map((d) => ({ name: d.name, valor: d.tratativasVal })), chart5Data: sorted.map((d) => ({ name: d.name, valor: d.vendasVal })),
    };
  }, [atendimentos]);
}