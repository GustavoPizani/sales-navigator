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

export function useDashboardData(atendimentos: any[], vendas: any[] = []) {
  return useMemo(() => {
    let emTratativasSum = 0;
    const monthlyAtend: Record<string, any> = {};

    atendimentos.forEach((a) => {
      if (a.status === "Em Tratativa") emTratativasSum += Number(a.valor) || 0;

      const m = a.data.slice(0, 7);
      if (!monthlyAtend[m]) {
        monthlyAtend[m] = {
          name: format(parseISO(a.data), "MMM/yy", { locale: ptBR }),
          sortKey: m,
          Sim1: 0, Não1: 0,
          Online: 0, Salão: 0,
          tratativasVal: 0,
        };
      }
      if (a.visita) monthlyAtend[m].Sim1++; else monthlyAtend[m].Não1++;
      if (a.setor === "Online") monthlyAtend[m].Online++;
      else if (a.setor === "Salão") monthlyAtend[m].Salão++;
      if (a.status === "Contrato Gerado") monthlyAtend[m].tratativasVal += Number(a.valor) || 0;
    });

    // Sales metrics from vendas table (approved only)
    const approvedVendas = vendas.filter((v) => v.status === "approved");
    let volumeVendasSum = 0;
    const monthlyVendas: Record<string, { vendasVal: number; count: number }> = {};

    approvedVendas.forEach((v) => {
      volumeVendasSum += Number(v.valor) || 0;
      const m = v.data_venda.slice(0, 7);
      if (!monthlyVendas[m]) monthlyVendas[m] = { vendasVal: 0, count: 0 };
      monthlyVendas[m].vendasVal += Number(v.valor) || 0;
      monthlyVendas[m].count++;
    });

    // Merge all months from both sources
    const allMonths = new Set([...Object.keys(monthlyAtend), ...Object.keys(monthlyVendas)]);
    allMonths.forEach((m) => {
      if (!monthlyAtend[m]) {
        monthlyAtend[m] = {
          name: format(parseISO(m + "-01"), "MMM/yy", { locale: ptBR }),
          sortKey: m,
          Sim1: 0, Não1: 0,
          Online: 0, Salão: 0,
          tratativasVal: 0,
        };
      }
    });

    const sorted = Object.values(monthlyAtend).sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    return {
      totalAtendimentos: atendimentos.length,
      totalVisitas: atendimentos.filter((a) => a.visita).length,
      totalVendas: approvedVendas.length,
      emTratativas: emTratativasSum,
      volumeVendas: volumeVendasSum,
      chart1Data: sorted.map((d) => ({ name: d.name, Sim: d.Sim1, Não: d.Não1 })),
      chart2Data: sorted.map((d) => ({
        name: d.name,
        Sim: monthlyVendas[d.sortKey]?.count || 0,
        Não: Math.max(0, d.Sim1 - (monthlyVendas[d.sortKey]?.count || 0)),
      })),
      chart3Data: sorted.map((d) => ({ name: d.name, Online: d.Online, Salão: d.Salão })),
      chart4Data: sorted.map((d) => ({ name: d.name, valor: d.tratativasVal })),
      chart5Data: sorted.map((d) => ({ name: d.name, valor: monthlyVendas[d.sortKey]?.vendasVal || 0 })),
    };
  }, [atendimentos, vendas]);
}
