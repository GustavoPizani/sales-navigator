/**
 * Roteiro guiado do Hypnobox. Você navega no Hypnobox como sempre; o botão
 * "Guia da coleta" (favorito) abre um painel na própria página, lê só a tabela
 * que já está na tela e manda para a aba da Coleta no Sales Navigator, que junta
 * tudo aqui. Nenhuma consulta é feita por trás.
 */
import { dataBR, isoParaBR } from "./regras";

export const HYPNOBOX = "https://paesegregori.hypnobox.com.br";

export type Periodo = { de: string; ate: string };
export type PassoId = "contatos" | "clientes" | "visitas" | "mensagens";
export type StatusPasso = "pendente" | "lendo" | "ok";

type Celulas = string[];
export type LinhaContato = {
  id_cliente: string | null;
  data: Celulas;
  atribuicao: Celulas;
  cliente: Celulas;
  origem: Celulas;
  canal: Celulas;
  duracao: Celulas;
  corretor: Celulas;
  produto: Celulas;
  cortados: boolean;
};
export type LinhaCliente = {
  id: string;
  c1: Celulas;
  coluna: string;
  c2: Celulas;
  c3: Celulas;
  c4: Celulas;
  c5: Celulas;
  midia?: string | null;
};
export type LinhaVisita = {
  visita_id: string;
  status: string;
  c0: Celulas;
  c1: Celulas;
  c2: Celulas;
  produto: string;
  c4: Celulas;
};
export type LinhaMensagem = { status: string; c1: Celulas; c2: Celulas; c4: Celulas; c6: Celulas };

/** O que o painel do Hypnobox manda a cada leitura da tela. */
export type Leitura = {
  passo: PassoId;
  url: string;
  cab: {
    periodoTela: { de: string; ate: string } | null;
    total: number | null;
    campos: { de: string; ate: string; tipoPeriodo: string };
  };
  linhas: unknown[];
  midias?: string[];
};

export type DadosGuia = {
  contatos: Record<string, LinhaContato>;
  clientes: Record<string, LinhaCliente>;
  visitas: Record<string, LinhaVisita>;
  mensagens: Record<string, LinhaMensagem>;
  visitasFim: Record<string, boolean>;
  /** visitas lidas em cada tipo de data (para saber quando o tipo chegou ao total) */
  visitasPorTipo?: Record<string, Record<string, true>>;
};
export type EstadoPasso = {
  status: StatusPasso;
  contagem: number;
  total: number | null;
  avisos: string[];
  concluidoEm: string | null;
};
export type EstadoGuia = {
  periodo: Periodo;
  passos: Record<PassoId, EstadoPasso>;
  dados: DadosGuia;
  ultimaLeitura: { passo: PassoId; em: string; novos: number; texto: string } | null;
};

export type Passo = {
  id: PassoId;
  titulo: string;
  url: string;
  serve: string;
  instrucoes: (p: Periodo) => string[];
};

export const PASSOS: Passo[] = [
  {
    id: "contatos",
    titulo: "Relatório de contatos",
    url: `${HYPNOBOX}/?controle=Relatorio&acao=contato`,
    serve: "Cada entrada de lead (novos e retornos), com mídia, canal, corretor e produto.",
    instrucoes: (p) => [
      `Em Período, escolha ${isoParaBR(p.de)} a ${isoParaBR(p.ate)}. Nos filtros: Tipo de Período "Data de Cadastro" e Tipo de Acesso "Todos". Clique em Gerar.`,
      "Em Exibir por página, escolha 100 e passe por todas as páginas.",
    ],
  },
  {
    id: "clientes",
    titulo: "Clientes",
    url: `${HYPNOBOX}/?controle=Cliente`,
    serve: "Momento, submomento, corretor e status de cada cliente: atualiza quem já existe e cadastra quem é novo.",
    instrucoes: (p) => [
      `Nos filtros, Tipo do período "Atualização", de ${isoParaBR(p.de)} a ${isoParaBR(p.ate)}, sem filtrar mídia. Clique em Aplicar.`,
      "Em Exibir por página, escolha 100 e passe por todas as páginas.",
    ],
  },
  {
    id: "visitas",
    titulo: "Visitas",
    url: `${HYPNOBOX}/?controle=Visita`,
    serve: "Visitas agendadas, realizadas e não realizadas, com corretor e cliente.",
    instrucoes: (p) => [
      `Tipo do Período "Data da visita", de ${isoParaBR(p.de)} a ${isoParaBR(p.ate)}, 100 por página: passe por todas as páginas.`,
      'Depois troque para "Data de Criação", mesmo período, e passe de novo pelas páginas.',
    ],
  },
  {
    id: "mensagens",
    titulo: "Mensagens recebidas",
    url: `${HYPNOBOX}/?controle=Mensagem`,
    serve: "Mensagens por corretor e por horário (só as de mídia LEN ficam).",
    instrucoes: (p) => [
      `Em Recebidas, período de ${isoParaBR(p.de)} a ${isoParaBR(p.ate)}, sem as arquivadas.`,
      "Escolha o maior número por página e passe por todas as páginas.",
    ],
  },
];

const passoVazio = (): EstadoPasso => ({
  status: "pendente",
  contagem: 0,
  total: null,
  avisos: [],
  concluidoEm: null,
});
export const dadosVazios = (): DadosGuia => ({
  contatos: {},
  clientes: {},
  visitas: {},
  mensagens: {},
  visitasFim: {},
});
export function estadoInicial(periodo: Periodo): EstadoGuia {
  return {
    periodo,
    passos: {
      contatos: passoVazio(),
      clientes: passoVazio(),
      visitas: passoVazio(),
      mensagens: passoVazio(),
    },
    dados: dadosVazios(),
    ultimaLeitura: null,
  };
}

export const passoAtual = (e: EstadoGuia) =>
  PASSOS.find((p) => e.passos[p.id].status !== "ok")?.id ?? null;

const fmt = (n: number) => n.toLocaleString("pt-BR");

/** Junta a leitura de uma tela com o que já foi lido no passo. Devolve um estado novo. */
export function juntar(estado: EstadoGuia, l: Leitura): EstadoGuia {
  const e: EstadoGuia = structuredClone(estado);
  const it = e.passos[l.passo];
  const d = e.dados;
  const per = e.periodo;
  const avisos: string[] = [];
  const telaDe = dataBR(l.cab.periodoTela?.de) || dataBR(l.cab.campos.de);
  const telaAte = dataBR(l.cab.periodoTela?.ate) || dataBR(l.cab.campos.ate);
  const periodoCerto = !telaDe || !telaAte || (telaDe === per.de && telaAte === per.ate);
  if (!periodoCerto)
    avisos.push(
      `A tela está de ${isoParaBR(telaDe)} a ${isoParaBR(telaAte)}; o passo pede ${isoParaBR(per.de)} a ${isoParaBR(per.ate)}.`,
    );

  let novos = 0;
  const guarda = <T>(mapa: Record<string, T>, chave: string | null | undefined, valor: T) => {
    if (!chave) return;
    if (!(chave in mapa)) novos++;
    mapa[chave] = valor;
  };
  let total = l.cab.total;
  let completo = false;

  if (l.passo === "contatos") {
    for (const x of l.linhas as LinhaContato[])
      guarda(d.contatos, [x.id_cliente || x.cliente.join("|"), x.data.join(" ")].join("#"), x);
    const todos = Object.values(d.contatos);
    const cortados = todos.filter((x) => x.cortados).length;
    if (cortados)
      avisos.push(
        `${fmt(cortados)} linhas têm texto cortado ("...") na tela; o cruzamento usa telefone e nome.`,
      );
    const noPeriodo = todos.filter((x) => {
      const dt = dataBR(x.data[0]);
      return dt && dt >= per.de && dt <= per.ate;
    }).length;
    it.contagem = todos.length;
    completo = periodoCerto && total != null && noPeriodo >= total;
  } else if (l.passo === "clientes") {
    const midia = l.midias && l.midias.length === 1 ? l.midias[0] : null;
    for (const x of l.linhas as LinhaCliente[])
      guarda(d.clientes, x.id, { ...x, midia: midia || d.clientes[x.id]?.midia || null });
    it.contagem = Object.keys(d.clientes).length;
    const vazias = (l.linhas as LinhaCliente[]).filter((x) => !x.c1.length && !x.c2.length).length;
    if (vazias)
      avisos.push(
        `${fmt(vazias)} linhas vieram com as colunas vazias: troque o favorito Guia da coleta pelo novo e leia esta tela de novo.`,
      );
    completo = !vazias && total != null && l.linhas.length > 0 && it.contagem >= total;
  } else if (l.passo === "visitas") {
    for (const x of l.linhas as LinhaVisita[]) guarda(d.visitas, x.visita_id, x);
    const tipo = l.cab.campos.tipoPeriodo || "padrao";
    const porTipo = ((d.visitasPorTipo ??= {})[tipo] ??= {});
    for (const x of l.linhas as LinhaVisita[]) porTipo[x.visita_id] = true;
    // fim daquele tipo de data: chegou ao total que a tela informa; sem o total
    // (favorito antigo), uma página com menos de 25 é a última
    const fimDoTipo =
      l.cab.total != null ? Object.keys(porTipo).length >= l.cab.total : l.linhas.length < 25;
    if (periodoCerto && fimDoTipo) d.visitasFim[tipo] = true;
    const tipos = Object.keys(d.visitasFim).length;
    if (tipos === 1 && fimDoTipo)
      avisos.push(
        "Fim das visitas por este tipo de data. Agora troque o tipo de período e consulte de novo.",
      );
    it.contagem = Object.keys(d.visitas).length;
    total = null;
    completo = tipos >= 2;
  } else {
    for (const x of l.linhas as LinhaMensagem[])
      guarda(d.mensagens, JSON.stringify([x.c1, x.c2, x.c4]), x);
    it.contagem = Object.keys(d.mensagens).length;
    completo = periodoCerto && total != null && it.contagem >= total;
  }

  it.avisos = avisos;
  it.total = total ?? it.total;
  if (l.linhas.length) {
    e.ultimaLeitura = {
      passo: l.passo,
      em: new Date().toISOString(),
      novos,
      texto: novos
        ? `Escaneei ${fmt(l.linhas.length)} linhas desta tela: ${fmt(novos)} novas (${fmt(it.contagem)} no passo${it.total ? ` de ${fmt(it.total)}` : ""}).`
        : `Esta tela já estava lida (${fmt(l.linhas.length)} linhas).`,
    };
  }
  if (it.status !== "ok") it.status = completo ? "ok" : it.contagem ? "lendo" : "pendente";
  if (it.status === "ok" && !it.concluidoEm) it.concluidoEm = new Date().toISOString();
  return e;
}

export function concluirPasso(estado: EstadoGuia, id: PassoId): EstadoGuia {
  if (!estado.passos[id].contagem) throw new Error("Nada foi lido neste passo ainda.");
  const e = structuredClone(estado);
  e.passos[id] = { ...e.passos[id], status: "ok", concluidoEm: new Date().toISOString() };
  return e;
}

export function limparPasso(estado: EstadoGuia, id: PassoId): EstadoGuia {
  const e = structuredClone(estado);
  e.dados[id] = {};
  if (id === "visitas") {
    e.dados.visitasFim = {};
    e.dados.visitasPorTipo = {};
  }
  e.passos[id] = passoVazio();
  if (e.ultimaLeitura?.passo === id) e.ultimaLeitura = null;
  return e;
}
