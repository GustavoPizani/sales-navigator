import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { HypnoboxData } from "@/lib/hypnobox.functions";
// Página do painel (HTML + CSS + script): nasceu do artefato publicado e
// passou a ser mantida aqui (conversão por campanha, comparação LEN x Hypnobox).
import painel from "./painel.html?raw";
// Folha de estilos do sistema principal: mesma base, fonte e cores no quadro.
import appCss from "@/styles.css?url";

const SCRIPT_START = painel.lastIndexOf("<script>");
const MARKUP = painel.slice(0, SCRIPT_START);
const SCRIPT = painel.slice(SCRIPT_START + "<script>".length, painel.lastIndexOf("</script>"));

const SRC_DOC = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Titillium+Web:wght@300;400;600;700&display=swap">
<link rel="stylesheet" href="${appCss}">
<style>
  /* Variáveis que só existem onde a página foi publicada. Sem elas a regra de
     fonte do painel é descartada e o texto cai na fonte padrão do navegador. */
  :root { --font-anthropic-sans: sans-serif; --cds-dur-slow: 300ms; }
  .sn { -webkit-font-smoothing: auto; }
</style>
</head>
<body>${MARKUP}
<style>
  /* Mesmas medidas do Dashboard do sistema principal (DashboardShared). */
  .sn-kpi { min-height: 100px; padding: 16px; }
  .sn-card h3, .sn-tablebar h3 { font-size: 14px; font-weight: 600; }
  .sn-table { font-size: 14px; }
  .sn-table th { font-size: 12px; padding: 12px 16px; }
  .sn-table td { padding: 12px 16px; }
  .sn-pager { font-size: 14px; }
</style>
</body>
</html>`;

const ICON_CLOUD =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>';
const ICON_BACK =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>';

type Props = {
  data: HypnoboxData;
  initialTab?: string;
  /** ID do lead a abrir assim que o painel carrega. */
  initialLead?: string;
  userName: string;
  userRole: string;
  onTab: (tab: string) => void;
  /** Lead aberto (ou null ao fechar a ficha), para guardar no endereço. */
  onLead: (id: string | null) => void;
  onExit: () => void;
  /** Abre a Central de coleta (Hypnobox + LEN). */
  onColeta: () => void;
};

type PanelWindow = Window & {
  dash?: unknown;
  d3?: unknown;
  __started?: boolean;
  snOpenLead?: (id: string) => void;
};

const brDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Subsistema "Análise Hypnobox": roda a página do painel dentro de um quadro
 * isolado, em tela cheia. O objeto `dash`, que a página usa para ler os dados,
 * é fornecido aqui com as linhas vindas do segundo banco.
 */
export default function HypnoboxFrame(props: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const redraw = useRef<() => void>(() => {});

  useEffect(() => redraw.current(), [props.data]);

  const start = () => {
    const win = frame.current?.contentWindow as PanelWindow | null | undefined;
    if (!win || win.__started) return;
    win.__started = true;
    const doc = win.document;

    type Calc = { inputs: string[]; fn: (...rows: unknown[]) => unknown };
    const calcs = new Map<string, Calc>();
    const calcCache = new Map<string, unknown>();
    const listeners: (() => void)[] = [];
    let ready = false;

    const result = (status: string, data: unknown) => ({
      status,
      data,
      rows: data,
      message: "",
      refreshing: false,
      meta: [],
    });
    const read = (id: string): ReturnType<typeof result> => {
      const rows = latest.current.data.datasets[id];
      if (rows) return result("ok", rows);
      const calc = calcs.get(id);
      if (!calc) return result("missing", []);
      if (!calcCache.has(id))
        calcCache.set(id, calc.fn(...calc.inputs.map((input) => read(input).data)));
      return result("ok", calcCache.get(id));
    };
    redraw.current = () => {
      calcCache.clear();
      listeners.forEach((fn) => fn());
    };

    win.d3 = d3;
    win.dash = {
      data: read,
      calc: (id: string, def: Calc) => calcs.set(id, def),
      onData: (fn: () => void) => {
        listeners.push(fn);
        fn();
      },
      setLink: (name: string) => {
        if (ready) latest.current.onTab(name.replace(/^tab-/, ""));
      },
      setLead: (id: string | null) => {
        if (ready) latest.current.onLead(id);
      },
      refresh: () => {},
      params: () => ({}),
      setParams: () => {},
      resetParams: () => {},
      colors: d3.schemeTableau10.slice(0, 8),
    };

    // "hoje" do painel = dia da coleta dos dados (define o que está vencido)
    // e o período da última coleta define meses, notas e colunas do painel
    const { coletadoEm, periodo } = latest.current.data;
    const iso = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
    let codigo = SCRIPT;
    if (coletadoEm && iso(coletadoEm))
      codigo = codigo.replace("const HOJE = '2026-10-13';", () => `const HOJE = '${coletadoEm}';`);
    if (periodo && iso(periodo.de) && iso(periodo.ate))
      codigo = codigo.replace(
        "const META = { de: '2026-09-01', ate: '2026-10-13' };",
        () => `const META = { de: '${periodo.de}', ate: '${periodo.ate}' };`,
      );
    const script = doc.createElement("script");
    script.textContent = codigo;
    doc.body.appendChild(script);

    // o painel redesenha os gráficos quando a largura muda
    let timer = 0;
    win.addEventListener("resize", () => {
      win.clearTimeout(timer);
      timer = win.setTimeout(() => listeners.forEach((fn) => fn()), 150);
    });

    // quem está logado e a data dos dados
    const { userName, userRole, initialTab, initialLead } = latest.current;
    const setText = (selector: string, text: string) => {
      const el = doc.querySelector(selector);
      if (el) el.textContent = text;
    };
    setText(".sn-pc .nm", userName);
    setText(
      ".sn-pc .ph",
      userName
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] ?? "")
        .join("")
        .toUpperCase(),
    );
    const roleLabel = doc.querySelector(".sn-pc .rl")?.lastChild;
    if (roleLabel) roleLabel.textContent = userRole;
    if (coletadoEm) {
      setText(".sn-head .r b", `atualizado em ${brDate(coletadoEm)}`);
      setText(".sn-side .upd span", `Dados de ${brDate(coletadoEm)} · Hypnobox e LEN`);
    }

    // saída do subsistema: no menu lateral e, no celular, na barra de baixo
    const exit = () => latest.current.onExit();
    const sideBack = doc.createElement("button");
    sideBack.type = "button";
    sideBack.className = "it";
    sideBack.title = "Voltar ao sistema";
    sideBack.innerHTML = `${ICON_BACK}<span class="lab">Voltar ao sistema</span>`;
    sideBack.style.marginBottom = "6px";
    sideBack.addEventListener("click", exit);
    doc.querySelector(".sn-side .foot .sn-pc")?.before(sideBack);
    // Central de coleta: atualiza os dados desta análise
    const sideColeta = doc.createElement("button");
    sideColeta.type = "button";
    sideColeta.className = "it";
    sideColeta.title = "Coleta de dados";
    sideColeta.innerHTML = `${ICON_CLOUD}<span class="lab">Coleta de dados</span>`;
    sideColeta.addEventListener("click", () => latest.current.onColeta());
    sideBack.before(sideColeta);
    const barBack = doc.createElement("button");
    barBack.type = "button";
    barBack.innerHTML = `${ICON_BACK}<span>Voltar</span>`;
    barBack.addEventListener("click", exit);
    doc.querySelector(".sn-bottom .bar")?.prepend(barBack);

    if (initialTab) doc.getElementById(`tab-${initialTab}`)?.click();
    ready = true;
    if (initialLead) win.snOpenLead?.(initialLead);
  };

  return (
    <iframe
      ref={frame}
      title="Análise Hypnobox"
      srcDoc={SRC_DOC}
      onLoad={start}
      className="fixed inset-0 z-30 h-dvh w-full border-0 bg-[var(--surface)]"
    />
  );
}
