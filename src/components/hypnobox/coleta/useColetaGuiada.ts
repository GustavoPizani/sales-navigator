import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getColetaBase,
  getReferenciaColeta,
  lerParteLen,
  type ParteLen,
} from "@/lib/coleta.functions";
import { contatosDasVisitas, diagnosticoGuiado, montarCargaGuiada } from "@/lib/coleta/carga";
import {
  HYPNOBOX,
  PASSOS,
  concluirPasso,
  estadoInicial,
  juntar,
  limparPasso,
  passoAtual,
  type EstadoGuia,
  type Leitura,
  type PassoId,
  type Periodo,
} from "@/lib/coleta/guia";
import { hojeISO } from "@/lib/coleta/regras";
import codigoGuia from "./guia-hypnobox.js?raw";

// Coleta guiada, toda no navegador do ADM: o Sales Navigator abre o Hypnobox numa
// janela, você navega nela e o favorito "Guia da coleta" manda para cá o que está
// na tela (postMessage, só entre esta aba e a janela que ela abriu). O dash da LEN
// é lido pelo servidor, uma página por chamada. O que foi lido fica só nesta aba
// (sessionStorage), porque tem dado pessoal.

export type Checagem = {
  nome: string;
  valor: number;
  referencia: number;
  texto: string;
  referenciaTexto: string;
  /** com o que foi comparado ("24/10 a 26/10", "banco, 01/06 a 28/10"); null = sem comparação */
  ref: string | null;
  alerta: boolean;
};
export type Carga = {
  tabelas: Record<string, Record<string, string | number | boolean | null>[]>;
  coleta: { periodo_inicio: string; periodo_fim: string; fontes: string; observacao: string };
  checagens: Checagem[];
};

export type EstadoLen = {
  status: "pendente" | "rodando" | "ok" | "erro";
  progresso: { texto: string; feito: number; total: number } | null;
  erro: string | null;
  concluidoEm: string | null;
  linhas: number | null;
  resultado: {
    tabelas: ParteLen["tabelas"];
    resumo: { investimentoPeriodo: number; janelas: ParteLen["janelas"] };
  } | null;
};

/** Versão do código do favorito (VERSAO em guia-hypnobox.js). */
export const VERSAO_FAVORITO = 3;

const CHAVE = "sn-coleta-guiada";
const lenVazio = (): EstadoLen => ({
  status: "pendente",
  progresso: null,
  erro: null,
  concluidoEm: null,
  linhas: null,
  resultado: null,
});
const periodoPadrao = (): Periodo => ({ de: "2026-09-01", ate: hojeISO() });

type Salvo = { guia: EstadoGuia; len: EstadoLen };
function ler(): Salvo | null {
  try {
    const s = sessionStorage.getItem(CHAVE);
    return s ? (JSON.parse(s) as Salvo) : null;
  } catch {
    return null;
  }
}
function gravar(v: Salvo) {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify(v));
  } catch {
    /* sem espaço ou sem storage: vale enquanto a aba estiver aberta */
  }
}

/** Resumo que o painel dentro do Hypnobox desenha. */
function resumoParaPainel(e: EstadoGuia) {
  return {
    passoAtual: passoAtual(e),
    ultimaLeitura: e.ultimaLeitura,
    passos: PASSOS.map((p) => ({
      id: p.id,
      titulo: p.titulo,
      url: p.url,
      instrucoes: p.instrucoes(e.periodo),
      ...e.passos[p.id],
    })),
  };
}

export function useColetaGuiada() {
  const [guia, setGuia] = useState<EstadoGuia>(() => estadoInicial(periodoPadrao()));
  const [len, setLen] = useState<EstadoLen>(lenVazio);
  const [versaoFavorito, setVersaoFavorito] = useState<number | null>(null);
  const [naTela, setNaTela] = useState<{ passo: PassoId | null; url: string; em: number } | null>(
    null,
  );
  const [janelaAberta, setJanelaAberta] = useState(false);
  const guiaRef = useRef(guia);
  const janela = useRef<Window | null>(null);
  const painel = useRef<MessageEventSource | null>(null);
  const parar = useRef(false);

  // volta o que já tinha sido lido nesta aba
  useEffect(() => {
    const s = ler();
    if (!s) return;
    guiaRef.current = s.guia;
    setGuia(s.guia);
    setLen(s.len.status === "rodando" ? { ...s.len, status: "pendente", progresso: null } : s.len);
  }, []);
  useEffect(() => gravar({ guia, len }), [guia, len]);

  const avisarPainel = useCallback((e: EstadoGuia) => {
    const alvo = painel.current as Window | null;
    try {
      alvo?.postMessage(
        { origem: "sn-coleta", tipo: "estado", estado: resumoParaPainel(e) },
        HYPNOBOX,
      );
    } catch {
      /* janela fechada */
    }
  }, []);

  const mudar = useCallback(
    (fn: (e: EstadoGuia) => EstadoGuia) => {
      const novo = fn(guiaRef.current);
      guiaRef.current = novo;
      setGuia(novo);
      avisarPainel(novo);
    },
    [avisarPainel],
  );

  // mensagens do painel "Guia da coleta" (só da janela do Hypnobox)
  useEffect(() => {
    const aoMensagem = (ev: MessageEvent) => {
      if (ev.origin !== HYPNOBOX || !ev.data || ev.data.origem !== "sn-guia") return;
      painel.current = ev.source;
      setVersaoFavorito(typeof ev.data.versao === "number" ? ev.data.versao : 1);
      const d = ev.data as
        | { tipo: "ola"; url: string; passo: PassoId | null }
        | { tipo: "leitura"; leitura: Leitura }
        | { tipo: "concluir" | "limpar"; passo: PassoId };
      if (d.tipo === "ola") {
        setNaTela({ passo: d.passo, url: d.url, em: Date.now() });
        avisarPainel(guiaRef.current);
      } else if (d.tipo === "leitura") {
        setNaTela({ passo: d.leitura.passo, url: d.leitura.url, em: Date.now() });
        mudar((e) => juntar(e, d.leitura));
      } else if (d.tipo === "concluir") {
        try {
          mudar((e) => concluirPasso(e, d.passo));
        } catch {
          avisarPainel(guiaRef.current);
        }
      } else if (d.tipo === "limpar") {
        mudar((e) => limparPasso(e, d.passo));
      }
    };
    window.addEventListener("message", aoMensagem);
    return () => window.removeEventListener("message", aoMensagem);
  }, [mudar, avisarPainel]);

  // a janela do Hypnobox foi fechada?
  useEffect(() => {
    const t = window.setInterval(() => {
      const aberta = Boolean(janela.current && !janela.current.closed);
      setJanelaAberta(aberta);
      if (!aberta) setNaTela(null);
    }, 2000);
    return () => window.clearInterval(t);
  }, []);

  const sincronizarLen = useCallback(async (pedido: Periodo) => {
    parar.current = false;
    // o dash da LEN é trocado inteiro ao gravar: busca o período todo já coletado
    // (do início da primeira coleta até o fim desta), para não apagar o anterior
    const base = baseRef.current;
    const periodo: Periodo = {
      de: base?.de && base.de < pedido.de ? base.de : pedido.de,
      ate: base?.ate && base.ate > pedido.ate ? base.ate : pedido.ate,
    };
    const tabelas: ParteLen["tabelas"] = {};
    let investimentoPeriodo = 0;
    let janelas: ParteLen["janelas"] = [];
    setLen({
      ...lenVazio(),
      status: "rodando",
      progresso: { texto: "Dash LEN: começando", feito: 0, total: 1 },
    });
    try {
      for (let i = 0, total = 1; i < total; i++) {
        if (parar.current) throw new Error("Interrompido.");
        const parte = await lerParteLen({ data: { indice: i, de: periodo.de, ate: periodo.ate } });
        total = parte.total;
        janelas = parte.janelas;
        investimentoPeriodo += parte.investimentoPeriodo;
        for (const [t, linhas] of Object.entries(parte.tabelas)) {
          tabelas[t] = t === "al_mkt_palavras" ? linhas : [...(tabelas[t] ?? []), ...linhas];
        }
        setLen((l) => ({
          ...l,
          progresso: { texto: `Dash LEN: ${parte.nome}`, feito: i + 1, total },
        }));
      }
      setLen({
        status: "ok",
        progresso: null,
        erro: null,
        concluidoEm: new Date().toISOString(),
        linhas: Object.values(tabelas).reduce((a, t) => a + t.length, 0),
        resultado: { tabelas, resumo: { investimentoPeriodo, janelas } },
      });
    } catch (e) {
      setLen({ ...lenVazio(), status: "erro", erro: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  /** Abre o Hypnobox numa aba nova (você entra com o seu login) e começa a LEN. */
  const sincronizar = useCallback(
    (periodo: Periodo) => {
      if (guiaRef.current.periodo.de !== periodo.de || guiaRef.current.periodo.ate !== periodo.ate)
        mudar((e) => ({ ...e, periodo }));
      // aba comum do seu navegador (com favoritos e login salvos), ligada a esta aba
      const w = window.open(
        janela.current && !janela.current.closed ? "" : `${HYPNOBOX}/`,
        "sn-hypnobox",
      );
      if (!w)
        throw new Error(
          "O navegador bloqueou a janela do Hypnobox. Permita pop-ups para este site.",
        );
      janela.current = w;
      w.focus();
      setJanelaAberta(true);
      if (len.status !== "ok" && len.status !== "rodando") void sincronizarLen(periodo);
    },
    [len.status, mudar, sincronizarLen],
  );

  const definirPeriodo = useCallback(
    (periodo: Periodo) => mudar((e) => ({ ...e, periodo })),
    [mudar],
  );

  /** Abre a página do passo na janela do Hypnobox (o mesmo que digitar o endereço). */
  const irPara = useCallback((id: PassoId) => {
    const url = PASSOS.find((p) => p.id === id)!.url;
    const w = janela.current && !janela.current.closed ? janela.current : null;
    janela.current = window.open(url, "sn-hypnobox") ?? w;
    janela.current?.focus();
  }, []);

  // o que já está no banco: leads (para atualizar quem reaparece) e o período coletado
  const baseQ = useQuery({
    queryKey: ["coleta-base"],
    queryFn: () => getColetaBase(),
    staleTime: 60_000,
  });
  const baseRef = useRef(baseQ.data);
  baseRef.current = baseQ.data;

  const carga = useCallback(async (): Promise<Carga> => {
    const e = guiaRef.current;
    const prontos = Object.fromEntries(
      PASSOS.map((p) => [p.id, e.passos[p.id].status === "ok"]),
    ) as Record<PassoId, boolean>;
    // o banco: os mesmos dias antes do período, o dash da LEN já gravado e o
    // cliente das visitas que não está na lista lida
    const referencia = await getReferenciaColeta({
      data: {
        de: e.periodo.de,
        ate: e.periodo.ate,
        visitas: prontos.visitas ? contatosDasVisitas(Object.values(e.dados.visitas)) : [],
      },
    });
    return montarCargaGuiada(
      e.dados,
      prontos,
      e.periodo,
      len.status === "ok" ? len.resultado : null,
      baseQ.data ? new Set(baseQ.data.ids) : null,
      // a base já tem todos os clientes (carga completa de 23/10/2026): cada coleta
      // atualiza quem foi lido e cadastra quem é novo, de qualquer origem
      { completa: true, referencia },
    ) as Carga;
  }, [len, baseQ.data]);

  /** Favorito "Guia da coleta": o código do painel com o endereço deste site. */
  const favorito = useMemo(() => {
    if (typeof window === "undefined") return "";
    const codigo = codigoGuia
      .replace(/^\/\*[\s\S]*?\*\/\s*/, "")
      .replaceAll("__SN_ORIGEM__", window.location.origin);
    return `javascript:${encodeURIComponent(codigo)}`;
  }, []);

  return {
    guia,
    len,
    naTela,
    janelaAberta,
    /** versão do favorito que falou com esta aba (null = ainda nenhum) */
    favoritoDesatualizado: versaoFavorito !== null && versaoFavorito < VERSAO_FAVORITO,
    passoAtual: passoAtual(guia),
    favorito,
    sincronizar,
    sincronizarLen,
    pararLen: () => {
      parar.current = true;
    },
    definirPeriodo,
    irPara,
    concluir: (id: PassoId) => mudar((e) => concluirPasso(e, id)),
    limpar: (id: PassoId) => mudar((e) => limparPasso(e, id)),
    recomecar: () => {
      const novo = estadoInicial(guiaRef.current.periodo);
      guiaRef.current = novo;
      setGuia(novo);
      setLen(lenVazio());
      avisarPainel(novo);
    },
    carga,
    /** Resumo sem dado pessoal do que foi lido (para entender quem virou lead LEN). */
    diagnostico: () => diagnosticoGuiado(guiaRef.current.dados, guiaRef.current.periodo) as unknown,
  };
}

export type ColetaGuiada = ReturnType<typeof useColetaGuiada>;
