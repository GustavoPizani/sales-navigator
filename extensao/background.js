// Service worker da extensão.
//  - Clique no ícone: na aba do WhatsApp Web abre/recolhe a faixa (aba de antes da
//    instalação é recarregada); em outra aba, vai para o WhatsApp Web.
//  - A cada 5 minutos confere os prazos de contato vencidos: número no ícone e
//    notificação do Windows para cada prazo novo; clique abre a conversa.

const WA = "https://web.whatsapp.com/";

chrome.action.onClicked.addListener(async (abaAtual) => {
  if (abaAtual?.url?.startsWith(WA)) {
    try {
      await chrome.tabs.sendMessage(abaAtual.id, { gc: "alternar" });
    } catch {
      await chrome.tabs.reload(abaAtual.id);
    }
    return;
  }
  await irParaWhatsapp();
});

async function irParaWhatsapp(chatId) {
  const [aba] = await chrome.tabs.query({ url: `${WA}*` });
  if (!aba) {
    await chrome.tabs.create({ url: WA });
    return; // a conversa abre quando o corretor clicar na lista da faixa
  }
  await chrome.tabs.update(aba.id, { active: true });
  await chrome.windows.update(aba.windowId, { focused: true });
  if (chatId) chrome.tabs.sendMessage(aba.id, { gc: "abrir", chatId }).catch(() => {});
}

// ── prazos de contato ─────────────────────────────────────────────────────
const ler = (k) => chrome.storage.local.get(k).then((v) => v[k]);

/** Token válido da sessão da faixa; renova se preciso (e guarda para a faixa usar o mesmo). */
async function token() {
  const s = await ler("sessao");
  if (!s) return null;
  if (Date.now() < s.expira) return s;
  const cfg = await ler("configAuth");
  if (!cfg) return null;
  const r = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: cfg.supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: s.refresh }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  // a faixa pode ter renovado ao mesmo tempo: fica com a mais nova
  const atual = await ler("sessao");
  if (atual && atual.expira > Date.now()) return atual;
  const nova = { ...s, token: j.access_token, refresh: j.refresh_token, expira: Date.now() + (j.expires_in - 60) * 1000 };
  await chrome.storage.local.set({ sessao: nova });
  return nova;
}

async function conferirPrazos() {
  const s = await token().catch(() => null);
  if (!s) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  let itens = [];
  try {
    const r = await fetch(`${s.servidor}/api/ext/lista`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ situacao: "vencido", ordem: "prazo" }),
    });
    if (!r.ok) return;
    itens = (await r.json()).itens || [];
  } catch {
    return;
  }
  chrome.action.setBadgeBackgroundColor({ color: "#DC2626" });
  chrome.action.setBadgeText({ text: itens.length ? String(Math.min(itens.length, 99)) : "" });

  // notifica cada prazo uma vez (vínculo + horário do prazo)
  const avisados = (await ler("prazosAvisados")) || {};
  const agora = {};
  for (const i of itens) {
    const chave = `${i.id}|${i.retornar_em}`;
    agora[chave] = true;
    if (avisados[chave]) continue;
    chrome.notifications.create(`prazo|${i.wa_chat_id}|${i.id}`, {
      type: "basic",
      iconUrl: "icone.png",
      title: `Hora de falar com ${i.nome || "o cliente"}`,
      message: [i.retorno_nota, i.etapa, i.produto].filter(Boolean).join(" · ") || "Prazo de contato vencido.",
      priority: 1,
    });
  }
  await chrome.storage.local.set({ prazosAvisados: agora });
}

chrome.notifications.onClicked.addListener((id) => {
  const [tipo, chatId] = id.split("|");
  if (tipo !== "prazo") return;
  chrome.notifications.clear(id);
  irParaWhatsapp(chatId);
});

function agendar() {
  chrome.alarms.create("prazos", { periodInMinutes: 5, delayInMinutes: 0.2 });
}
chrome.runtime.onInstalled.addListener(agendar);
chrome.runtime.onStartup.addListener(agendar);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "prazos") conferirPrazos();
});
// a faixa avisa quando um prazo muda ou o corretor entra: confere na hora
chrome.runtime.onMessage.addListener((m) => {
  if (m?.gc === "conferir-prazos") conferirPrazos();
});
