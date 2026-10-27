// Ponte com o WhatsApp Web (roda no "mundo" da página, junto com a WA-JS).
// Recebe pedidos do content script por eventos do documento e responde com JSON.
// Lista fechada de ações: lê a conversa aberta e as mensagens, baixa um áudio e
// coloca texto na caixa de mensagem. Não envia nada.
(() => {
  if (window.__gcPonte) return;
  window.__gcPonte = true;

  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const emitir = (tipo, dados) =>
    document.dispatchEvent(new CustomEvent("gc-wa-evento", { detail: JSON.stringify({ tipo, dados }) }));
  const responder = (id, ok, dados) =>
    document.dispatchEvent(new CustomEvent("gc-wa-resposta", { detail: JSON.stringify({ id, ok, dados }) }));

  async function pronto() {
    for (let i = 0; i < 1200; i++) {
      if (window.WPP && (window.WPP.isFullReady || window.WPP.isReady)) return true;
      await dormir(500);
    }
    return false;
  }

  const idDe = (x) => (typeof x === "string" ? x : x?._serialized || "");

  async function telefoneDe(chatId) {
    if (chatId.endsWith("@c.us")) return chatId.split("@")[0];
    try {
      const e = await WPP.contact.getPnLidEntry(chatId);
      return (e?.phoneNumber?.id || idDe(e?.phoneNumber).split("@")[0] || "").replace(/\D/g, "");
    } catch {
      return "";
    }
  }

  async function conversaAtiva() {
    const chat = WPP.chat.getActiveChat();
    if (!chat) return null;
    const id = idDe(chat.id);
    const grupo = Boolean(chat.isGroup) || id.endsWith("@g.us") || id.endsWith("@newsletter") || id === "status@broadcast";
    const c = chat.contact || {};
    return {
      id,
      grupo,
      nome: chat.formattedTitle || chat.name || c.name || c.pushname || c.verifiedName || "",
      telefone: grupo ? "" : await telefoneDe(id),
    };
  }

  // tipos do WhatsApp → formato compacto (a/i/v/d); o resto (avisos, apagadas, enquetes…) fica de fora
  const TIPO = { chat: "", ptt: "a", audio: "a", image: "i", sticker: "i", video: "v", gif: "v", document: "d" };

  function compacta(m) {
    if (!(m.type in TIPO) || m.isNotification) return null;
    const tipo = TIPO[m.type];
    const id = idDe(m.id);
    const deMim = m.id?.fromMe ?? m.fromMe ?? id.startsWith("true_");
    let texto = "";
    if (tipo === "") texto = m.body || "";
    else if (tipo === "d") texto = m.caption || m.filename || "";
    else if (tipo !== "a") texto = m.caption || "";
    if (tipo === "" && !texto.trim()) return null;
    return {
      id,
      ts: Number(m.t) || 0,
      lado: deMim ? ">" : "<",
      ...(tipo ? { tipo } : {}),
      ...(tipo === "a" && m.duration ? { seg: Math.round(Number(m.duration)) } : {}),
      texto,
    };
  }

  async function mensagens(chatId, quantas) {
    const raw = await WPP.chat.getMessages(chatId, { count: quantas });
    return raw.map(compacta).filter((m) => m && m.ts > 0);
  }

  async function baixarAudio(msgId) {
    const blob = await WPP.chat.downloadMedia(msgId);
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { base64: btoa(bin), tipo: blob.type || "audio/ogg" };
  }

  const ACOES = {
    conversaAtiva: () => conversaAtiva(),
    mensagens: ({ chatId, quantas }) => mensagens(chatId, Math.min(Math.max(Number(quantas) || 80, 1), 500)),
    baixarAudio: ({ msgId }) => baixarAudio(msgId),
    // etiquetas do WhatsApp Business (o WhatsApp comum não tem: business = false)
    etiquetasWa: async () => {
      try {
        const lista = await WPP.labels.getAllLabels();
        return {
          business: true,
          etiquetas: lista.map((l) => ({ id: String(l.id), nome: l.name, cor: l.hexColor || null })),
        };
      } catch (err) {
        return { business: false, motivo: String(err?.code || err?.message || err) };
      }
    },
    etiquetasDaConversa: async ({ chatId }) => {
      const chat = WPP.chat.get(chatId);
      return (chat?.labels || []).map(String);
    },
    marcarEtiquetaWa: async ({ chatId, labelId, marcar }) => {
      await WPP.labels.addOrRemoveLabels(chatId, [{ labelId: String(labelId), type: marcar ? "add" : "remove" }]);
      return true;
    },
    criarEtiquetaWa: async ({ nome }) => {
      const l = await WPP.labels.addNewLabel(String(nome));
      return { id: String(l.id), nome: l.name, cor: l.hexColor || null };
    },
    abrirConversa: async ({ chatId }) => {
      await WPP.chat.openChatBottom(chatId);
      return true;
    },
    porNaCaixa: async ({ chatId, texto }) => {
      await WPP.chat.setInputText(String(texto), chatId);
      return true;
    },
  };

  document.addEventListener("gc-wa-pedido", async (e) => {
    let pedido;
    try {
      pedido = JSON.parse(e.detail);
    } catch {
      return;
    }
    const acao = ACOES[pedido?.acao];
    if (!acao) return responder(pedido?.id, false, "Ação não permitida");
    try {
      responder(pedido.id, true, await acao(pedido.dados || {}));
    } catch (err) {
      responder(pedido.id, false, String(err?.message || err));
    }
  });

  pronto().then((ok) => {
    if (!ok) return emitir("erro", "O WhatsApp Web não carregou a tempo. Recarregue a página.");
    emitir("pronto", true);
    WPP.on("chat.active_chat", async () => emitir("conversa", await conversaAtiva().catch(() => null)));
    WPP.on("chat.new_message", (m) => {
      const chatId = idDe(m?.id?.remote) || idDe(m?.from) || idDe(m?.to);
      const fromMe = Boolean(m?.id?.fromMe);
      emitir("mensagem", { chatId: fromMe ? idDe(m?.id?.remote) || idDe(m?.to) : chatId });
    });
    conversaAtiva()
      .then((c) => emitir("conversa", c))
      .catch(() => {});
  });
})();
