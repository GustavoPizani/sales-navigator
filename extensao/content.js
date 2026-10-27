// Content script: monta a faixa lateral (iframe com o painel da extensão) no
// WhatsApp Web e repassa mensagens entre o painel e a ponte (ponte.js).
(() => {
  if (window.__gcFaixa) return;
  window.__gcFaixa = true;

  const LARGURA = 340;
  const LINGUETA = 26;
  const ORIGEM_PAINEL = new URL(chrome.runtime.getURL("")).origin;

  const estilo = document.createElement("style");
  document.documentElement.appendChild(estilo);

  const faixa = document.createElement("div");
  faixa.id = "gc-faixa";
  faixa.style.cssText = `position:fixed;top:0;right:0;height:100vh;width:${LARGURA}px;z-index:2147483000;display:flex;transition:transform .2s ease;`;

  const lingueta = document.createElement("button");
  lingueta.type = "button";
  lingueta.title = "Gestão Comercial";
  lingueta.setAttribute("aria-label", "Abrir ou recolher a faixa do Gestão Comercial");
  lingueta.style.cssText = `position:absolute;left:-${LINGUETA}px;top:50%;transform:translateY(-50%);width:${LINGUETA}px;height:64px;border:0;border-radius:10px 0 0 10px;background:#2D2D2D;color:#B28069;cursor:pointer;display:grid;place-items:center;padding:0;box-shadow:-2px 0 6px rgba(0,0,0,.25);`;

  const iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL("painel.html");
  iframe.title = "Gestão Comercial";
  // sem fundo próprio: o painel pinta o dele (claro ou escuro, conforme o sistema)
  iframe.style.cssText = "border:0;width:100%;height:100%;background:transparent;color-scheme:normal;box-shadow:-2px 0 8px rgba(0,0,0,.18);";

  faixa.append(lingueta, iframe);

  let aberta = true;
  function aplicar() {
    faixa.style.transform = aberta ? "none" : `translateX(${LARGURA}px)`;
    // seta para a direita recolhe; para a esquerda abre
    lingueta.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${aberta ? "m9 18 6-6-6-6" : "m15 18-6-6 6-6"}"/></svg>`;
    lingueta.setAttribute("aria-expanded", String(aberta));
    // o WhatsApp encolhe para a faixa não cobrir a conversa
    estilo.textContent = aberta ? `#app{width:calc(100% - ${LARGURA}px)!important;}` : "";
    chrome.storage.local.set({ faixaAberta: aberta });
  }
  lingueta.addEventListener("click", () => {
    aberta = !aberta;
    aplicar();
  });
  // clique no ícone da extensão (background.js)
  chrome.runtime.onMessage.addListener((m, _remetente, responder) => {
    if (m?.gc === "alternar") {
      aberta = !aberta;
      aplicar();
      responder(true);
    } else if (m?.gc === "abrir" && m.chatId) {
      // clique na notificação de prazo: abre a conversa do cliente
      document.dispatchEvent(
        new CustomEvent("gc-wa-pedido", { detail: JSON.stringify({ id: 0, acao: "abrirConversa", dados: { chatId: m.chatId } }) }),
      );
      responder(true);
    }
  });
  chrome.storage.local.get("faixaAberta", (v) => {
    aberta = v.faixaAberta !== false;
    aplicar();
  });

  const montar = () => (document.body ? document.body.appendChild(faixa) : setTimeout(montar, 200));
  montar();

  // ponte → painel
  const paraPainel = (msg) => iframe.contentWindow?.postMessage(msg, ORIGEM_PAINEL);
  document.addEventListener("gc-wa-evento", (e) => {
    try {
      paraPainel({ gc: "evento", ...JSON.parse(e.detail) });
    } catch {}
  });
  document.addEventListener("gc-wa-resposta", (e) => {
    try {
      paraPainel({ gc: "resposta", ...JSON.parse(e.detail) });
    } catch {}
  });

  // painel → ponte
  window.addEventListener("message", (e) => {
    if (e.source !== iframe.contentWindow || e.origin !== ORIGEM_PAINEL) return;
    const m = e.data;
    if (m?.gc === "pedido")
      document.dispatchEvent(new CustomEvent("gc-wa-pedido", { detail: JSON.stringify({ id: m.id, acao: m.acao, dados: m.dados }) }));
    else if (m?.gc === "recolher") {
      aberta = false;
      aplicar();
    }
  });
})();
