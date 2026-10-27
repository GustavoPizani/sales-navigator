// Painel da faixa lateral no WhatsApp Web (página da extensão, dentro de um iframe).
// Fala com o WhatsApp pela ponte (via content script) e com o Gestão Comercial
// pela API /api/ext, com o login do Supabase do próprio corretor.
(() => {
  const CFG = window.GC_CONFIG;
  const VERSAO = chrome.runtime.getManifest().version;
  const $app = document.getElementById("app");
  const $topo = document.getElementById("topo-acoes");

  const est = {
    sessao: null, // { servidor, token, refresh, expira }
    usuario: null,
    chave: null,
    versaoPublicada: null,
    waPronto: false,
    erroWa: null,
    conversa: null, // { id, nome, telefone, grupo }
    carregando: false,
    vinculo: null,
    hypnobox: null,
    lead: null,
    candidatos: null, // { leads, hypnobox, deOutroCorretor }
    msgsWa: [], // últimas mensagens lidas do WhatsApp (formato compacto)
    guardadas: [], // mensagens guardadas no sistema (com transcrições)
    sugestoes: null,
    ocupado: {}, // por ação
    aviso: null, // { tipo, texto }
    uso: null,
    aba: "lista", // conversa | lista (abre na lista; troca para a conversa quando o corretor abre uma)
    conversaInicial: true, // a primeira conversa ativa vem do carregamento, não de um clique
    etiquetas: [], // { id, nome, cor } do corretor
    editandoEtiquetas: false,
    filtros: { etiqueta_id: "", situacao: "todas", sem_contato_dias: "", ordem: "sem_contato" },
    itensLista: null,
    chaveLista: null,
    vinculados: {}, // chatId → true: conversas vinculadas (abre numa chamada só)
  };

  const CORES = ["#DC2626", "#EA580C", "#CA8A04", "#16A34A", "#0891B2", "#2563EB", "#7C3AED", "#B28069", "#6B7280"];
  const dias = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : null);
  const dataCurta = (iso) =>
    new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const vencido = (iso) => iso && Date.parse(iso) <= Date.now();

  // ── utilidades ────────────────────────────────────────────────────────────
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ha = (iso) => {
    if (!iso) return "";
    const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (min < 60) return `${min} min`;
    const h = Math.round(min / 60);
    return h < 48 ? `${h} h` : `${Math.round(h / 24)} dias`;
  };
  const guardar = (o) => chrome.storage.local.set(o);
  const ler = (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v[k])));
  const idCurto = (id) => String(id).replace(/[^0-9A-Za-z]/g, "").slice(-8);

  // ── mapeamento de tempo (para aprimorar a extensão) ───────────────────────
  // Agrupa por ação (quantas vezes, tempo total e máximo, erros) e manda o resumo
  // para o servidor a cada minuto e quando a aba fecha. Sem dado de cliente.
  const tempos = new Map();
  function medir(acao, ms, erro) {
    const t = tempos.get(acao) || { acao, n: 0, ms_total: 0, ms_max: 0, erros: 0 };
    t.n++;
    t.ms_total += Math.round(ms);
    t.ms_max = Math.max(t.ms_max, Math.round(ms));
    if (erro) t.erros++;
    tempos.set(acao, t);
  }
  async function cronometrar(acao, fn) {
    const ini = performance.now();
    try {
      const r = await fn();
      medir(acao, performance.now() - ini, false);
      return r;
    } catch (e) {
      medir(acao, performance.now() - ini, true);
      throw e;
    }
  }
  function enviarTempos() {
    const s = est.sessao;
    if (!tempos.size || !s || Date.now() >= s.expira) return;
    const itens = [...tempos.values()].slice(0, 100);
    tempos.clear();
    fetch(`${s.servidor}/api/ext/metricas`, {
      method: "POST",
      keepalive: true, // chega mesmo se a aba estiver fechando
      headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ itens }),
    }).catch(() => {});
  }
  setInterval(enviarTempos, 60_000);
  addEventListener("pagehide", enviarTempos);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && enviarTempos());

  // ── ponte com o WhatsApp ──────────────────────────────────────────────────
  let seqPedido = 0;
  const pendentes = new Map();
  function wa(acao, dados) {
    return cronometrar(`wa:${acao}`, () => pedirWa(acao, dados));
  }
  function pedirWa(acao, dados) {
    const id = ++seqPedido;
    return new Promise((resolve, reject) => {
      pendentes.set(id, { resolve, reject });
      parent.postMessage({ gc: "pedido", id, acao, dados }, "https://web.whatsapp.com");
      setTimeout(() => {
        if (pendentes.delete(id)) reject(new Error("O WhatsApp Web não respondeu."));
      }, 60000);
    });
  }
  window.addEventListener("message", (e) => {
    if (e.origin !== "https://web.whatsapp.com" || e.data?.gc == null) return;
    const m = e.data;
    if (m.gc === "resposta") {
      const p = pendentes.get(m.id);
      if (!p) return;
      pendentes.delete(m.id);
      m.ok ? p.resolve(JSON.parse(JSON.stringify(m.dados ?? null))) : p.reject(new Error(m.dados || "Erro no WhatsApp Web"));
    } else if (m.gc === "evento") aoEvento(m.tipo, m.dados);
  });

  // ── login (Supabase) e API ────────────────────────────────────────────────
  async function auth(grant, corpo) {
    const r = await fetch(`${CFG.supabaseUrl}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: { apikey: CFG.supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || "E-mail ou senha incorretos.");
    return { token: j.access_token, refresh: j.refresh_token, expira: Date.now() + (j.expires_in - 60) * 1000 };
  }

  async function tokenValido() {
    const s = est.sessao;
    if (!s) throw new Error("Entre com a sua conta.");
    if (Date.now() < s.expira) return s.token;
    // o service worker (prazos) pode ter renovado antes: usa a sessão guardada
    const guardada = await ler("sessao");
    if (guardada && guardada.expira > Date.now()) {
      Object.assign(s, guardada);
      return s.token;
    }
    try {
      Object.assign(s, await auth("refresh_token", { refresh_token: s.refresh }));
      await guardar({ sessao: s });
      return s.token;
    } catch {
      await sair();
      throw new Error("Sua sessão expirou. Entre de novo.");
    }
  }

  function api(rota, corpo) {
    return cronometrar(`api:${rota}`, () => chamarApi(rota, corpo));
  }
  async function chamarApi(rota, corpo) {
    const token = await tokenValido();
    const ehForm = corpo instanceof FormData;
    const r = await fetch(`${est.sessao.servidor}/api/ext/${rota}`, {
      method: corpo ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(corpo && !ehForm ? { "Content-Type": "application/json" } : {}) },
      body: ehForm ? corpo : corpo ? JSON.stringify(corpo) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      // 404 sem o JSON da nossa API: o servidor escolhido ainda não tem a extensão publicada
      const semApi = r.status === 404 && !j.erro;
      const e = new Error(
        semApi
          ? `O servidor "${(CFG.servidores.find((s) => s.url === est.sessao.servidor) || {}).nome || est.sessao.servidor}" ainda não tem a extensão publicada. Saia e entre escolhendo outro servidor.`
          : j.erro || `Erro ${r.status}`,
      );
      e.status = r.status;
      e.esperarSeg = j.esperarSeg || 0;
      if (r.status === 401) await sair();
      throw e;
    }
    return j;
  }

  // fila da IA: um pedido ao Groq por vez (limite grátis)
  let filaIA = Promise.resolve();
  const naFila = (fn) => {
    const p = filaIA.then(fn, fn);
    filaIA = p.catch(() => {});
    return p;
  };

  async function acao(nome, fn) {
    if (est.ocupado[nome]) return;
    est.ocupado[nome] = true;
    est.aviso = null;
    render();
    try {
      // tempo que o corretor esperou por esta ação (transcrições de áudios diferentes contam juntas)
      await cronometrar(`acao:${nome.startsWith("tr-") ? "transcrever" : nome}`, fn);
    } catch (e) {
      est.aviso = { tipo: e.status === 429 ? "alerta" : "erro", texto: e.message };
    } finally {
      est.ocupado[nome] = false;
      render();
    }
  }

  // ── fluxo ────────────────────────────────────────────────────────────────
  async function iniciar() {
    // o service worker usa para renovar a sessão ao conferir os prazos
    guardar({ configAuth: { supabaseUrl: CFG.supabaseUrl, supabaseKey: CFG.supabaseKey } });
    est.sessao = (await ler("sessao")) || null;
    est.vinculados = (await ler("vinculados")) || {};
    render();
    if (est.sessao) await abrirSessao();
    else await entrarPeloSistema();
  }

  /**
   * Entra sozinho com a conta logada no Gestão Comercial neste navegador
   * (sessao-sistema.js avisa qual é). A extensão ganha uma sessão própria, por um
   * link de uso único: não reaproveita a do site, para uma não derrubar a outra.
   */
  async function entrarPeloSistema(forcar) {
    if (est.sessao || est.ocupado.auto) return;
    const t = await ler("tokenSistema");
    // o que a faixa sabe do login do sistema (aparece na tela de entrada)
    est.sistema = !t?.access_token
      ? { situacao: "nenhum" }
      : t.expira < Date.now() + 60000
        ? { situacao: "expirado", servidor: t.servidor, email: t.email }
        : { situacao: "ok", servidor: t.servidor, email: t.email };
    render();
    if (est.sistema.situacao !== "ok") return;
    if (!CFG.servidores.some((s) => s.url === t.servidor)) return;
    if (!forcar && (await ler("ignorarToken")) === t.access_token) return; // saiu da faixa com este login
    est.ocupado.auto = true;
    est.aviso = null;
    render();
    try {
      const r = await fetch(`${t.servidor}/api/ext/conectar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${t.access_token}` },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || "Não foi possível entrar automaticamente.");
      const v = await fetch(`${CFG.supabaseUrl}/auth/v1/verify`, {
        method: "POST",
        headers: { apikey: CFG.supabaseKey, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "magiclink", token_hash: j.token_hash }),
      });
      const s = await v.json().catch(() => ({}));
      if (!v.ok || !s.access_token) throw new Error(s.msg || s.error_description || "Não foi possível entrar automaticamente.");
      est.sessao = {
        servidor: t.servidor,
        token: s.access_token,
        refresh: s.refresh_token,
        expira: Date.now() + ((s.expires_in || 3600) - 60) * 1000,
      };
      await guardar({ sessao: est.sessao, ultimoServidor: t.servidor });
      await chrome.storage.local.remove("ignorarToken");
      await abrirSessao();
    } catch (e) {
      est.aviso = { tipo: "alerta", texto: `${e.message} Entre com e-mail e senha.` };
    } finally {
      est.ocupado.auto = false;
      render();
    }
  }

  // o login do sistema chegou (ou mudou) com a faixa aberta: entra sozinho
  chrome.storage.onChanged.addListener((mudou) => {
    if (mudou.tokenSistema && !est.sessao) entrarPeloSistema();
  });

  async function abrirSessao() {
    try {
      const s = await api("sessao", { versao: VERSAO, navegador: navigator.userAgent.slice(0, 180), whatsapp: est.waPronto });
      est.usuario = s.usuario;
      est.chave = s.chave;
      est.versaoPublicada = s.versaoPublicada;
      render();
      carregarEtiquetas();
      if (est.aba === "lista") acao("lista", carregarLista);
      chrome.runtime.sendMessage({ gc: "conferir-prazos" }).catch(() => {});
      if (est.conversa) await abrirConversa();
      atualizarUso();
    } catch (e) {
      est.aviso = { tipo: "erro", texto: e.message };
      render();
    }
  }

  async function entrar(form) {
    const servidor = form.servidor.value.replace(/\/$/, "");
    const s = await auth("password", { email: form.email.value.trim(), password: form.senha.value });
    est.sessao = { servidor, ...s };
    await guardar({ sessao: est.sessao, ultimoServidor: servidor });
    await abrirSessao();
  }

  /** manual = o corretor clicou em Sair: não entra sozinho de novo com o mesmo login do sistema */
  async function sair(manual) {
    if (manual) {
      const t = await ler("tokenSistema");
      if (t?.access_token) await guardar({ ignorarToken: t.access_token });
    }
    Object.assign(est, {
      sessao: null,
      usuario: null,
      chave: null,
      vinculo: null,
      hypnobox: null,
      lead: null,
      candidatos: null,
      sugestoes: null,
      etiquetas: [],
      itensLista: null,
      chaveLista: null,
      vinculados: {},
      uso: null,
      aba: "lista",
      editandoEtiquetas: false,
      aviso: manual
        ? { tipo: "ok", texto: "Você saiu da faixa. Para entrar com outra conta, use e-mail e senha abaixo." }
        : est.aviso,
    });
    await chrome.storage.local.remove(["sessao", "prazosAvisados", "vinculados", "listaCache"]);
    chrome.runtime.sendMessage({ gc: "conferir-prazos" }).catch(() => {}); // limpa o número no ícone
    render();
  }

  function aoEvento(tipo, dados) {
    if (tipo === "pronto") {
      est.waPronto = true;
      if (est.usuario) carregarEtiquetas(); // agora dá para ler as etiquetas do WhatsApp Business
      if (est.usuario) api("sessao", { versao: VERSAO, whatsapp: true }).catch(() => {});
      render();
    } else if (tipo === "erro") {
      est.erroWa = dados;
      render();
    } else if (tipo === "conversa") {
      const mudou = dados?.id !== est.conversa?.id;
      est.conversa = dados;
      // conversa aberta pelo corretor: mostra a aba Conversa
      if (mudou && dados && !est.conversaInicial) est.aba = "conversa";
      est.conversaInicial = false;
      if (mudou) {
        Object.assign(est, { vinculo: null, hypnobox: null, lead: null, candidatos: null, msgsWa: [], guardadas: [], sugestoes: null, aviso: null, trocando: false });
        render();
        if (est.usuario && dados && !dados.grupo) cronometrar("acao:abrir-conversa", () => abrirConversa()).catch(() => {});
      }
    } else if (tipo === "mensagem") {
      if (dados?.chatId && dados.chatId === est.conversa?.id && vinculada()) agendarSincronia();
    }
  }

  const vinculada = () => est.vinculo && !est.vinculo.nao_cliente;

  /** Carrega o vínculo da conversa; com nomeBusca ou trocando, procura clientes para escolher. */
  async function abrirConversa(nomeBusca) {
    const c = est.conversa;
    if (!c || c.grupo || !est.usuario) return;
    est.carregando = true;
    est.termoBusca = nomeBusca || null;
    render();
    try {
      const buscando = est.trocando || Boolean(nomeBusca);
      // conversa que esta faixa já sabe que está vinculada: lê as mensagens e as
      // etiquetas do WhatsApp antes e manda tudo numa chamada só. Conversa que não
      // está vinculada não manda mensagem nenhuma.
      const jaVinculada = !buscando && est.vinculados[c.id] === true;
      const [msgs, etiquetasWa] = jaVinculada
        ? await Promise.all([
            wa("mensagens", { chatId: c.id, quantas: 80 }).catch(() => []),
            est.waBusiness ? wa("etiquetasDaConversa", { chatId: c.id }).catch(() => null) : Promise.resolve(null),
          ])
        : [[], null];
      const r = await api("conversa/abrir", {
        wa_chat_id: c.id,
        telefone: nomeBusca ? "" : c.telefone || "",
        nome: nomeBusca || c.nome || undefined,
        buscar: buscando,
        ...(jaVinculada && msgs.length ? { mensagens: msgs } : {}),
        ...(jaVinculada && etiquetasWa ? { etiquetas_wa: etiquetasWa } : {}),
      });
      if (est.conversa?.id !== c.id) return;
      est.vinculo = r.vinculo;
      est.hypnobox = r.hypnobox;
      est.lead = r.lead;
      est.candidatos = r.sugestoes;
      lembrarVinculo(c.id, vinculada());
      if (vinculada() && !est.trocando) {
        if (jaVinculada) {
          est.msgsWa = msgs;
          est.guardadas = r.mensagens || [];
          atualizarTempoParado();
        } else {
          // primeira vez nesta faixa: o caminho em duas etapas
          await sincronizar();
          await sincronizarEtiquetasDaConversa().catch(() => {});
        }
      }
    } catch (e) {
      est.aviso = { tipo: "erro", texto: e.message };
    } finally {
      est.carregando = false;
      render();
    }
  }

  async function vincular(dados) {
    const c = est.conversa;
    const r = await api("vinculo", { wa_chat_id: c.id, telefone: c.telefone || "", nome: c.nome || undefined, ...dados });
    est.vinculo = r.vinculo;
    est.hypnobox = r.hypnobox;
    est.lead = r.lead;
    est.candidatos = null;
    est.trocando = false;
    lembrarVinculo(c.id, vinculada());
    if (vinculada()) await sincronizar();
  }

  let timerSinc = null;
  function agendarSincronia() {
    clearTimeout(timerSinc);
    timerSinc = setTimeout(() => cronometrar("acao:sincronizar-mensagem-nova", sincronizar).then(render).catch(() => {}), 2500);
  }

  async function sincronizar() {
    if (!vinculada()) return;
    const chatId = est.conversa.id;
    est.msgsWa = await wa("mensagens", { chatId, quantas: 80 });
    if (est.conversa?.id !== chatId || !est.msgsWa.length) return;
    // gravar já devolve as mensagens guardadas (com as transcrições): uma chamada só
    const r = await api("conversa", { vinculo_id: est.vinculo.id, mensagens: est.msgsWa });
    est.guardadas = r.mensagens || [];
    atualizarTempoParado();
  }

  async function sugerir(pedido) {
    await sincronizar();
    const r = await naFila(() => api("ia/sugestao", { vinculo_id: est.vinculo.id, pedido: pedido || undefined }));
    est.sugestoes = r.sugestoes;
    atualizarUso();
  }

  async function usarSugestao(texto) {
    await wa("porNaCaixa", { chatId: est.conversa.id, texto });
    est.aviso = { tipo: "ok", texto: "Texto colocado na caixa de mensagem. Revise e envie." };
  }

  async function transcrever(m) {
    const audio = await wa("baixarAudio", { msgId: m.id });
    const bin = atob(audio.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.length > 4_000_000) throw new Error("Áudio grande demais para transcrever (máximo 4 MB).");
    const fd = new FormData();
    fd.append("audio", new Blob([bytes], { type: audio.tipo }), "audio.ogg");
    fd.append("vinculo_id", est.vinculo.id);
    fd.append("msg_id", m.id);
    fd.append("ts", String(m.ts));
    fd.append("lado", m.lado);
    fd.append("segundos", String(m.seg || 0));
    const r = await naFila(() => api("ia/transcrever", fd));
    const g = est.guardadas.find((x) => x.ts === m.ts && x.id === idCurto(m.id));
    if (g) g.texto = r.texto;
    else est.guardadas.push({ ...m, id: idCurto(m.id), texto: r.texto });
    atualizarUso();
  }

  // ── etiquetas, prazo e lista ─────────────────────────────────────────────
  /**
   * Etiquetas da faixa. No WhatsApp Business, são as etiquetas do próprio
   * WhatsApp (espelhadas no banco para a Lista filtrar); no WhatsApp comum, só
   * as do sistema.
   */
  async function carregarEtiquetas() {
    try {
      if (est.waPronto) {
        const doWa = await wa("etiquetasWa", {});
        est.waBusiness = doWa.business;
        if (doWa.business) {
          const cor = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : undefined);
          est.etiquetas = (
            await api("etiquetas/sincronizar", {
              etiquetas: doWa.etiquetas.map((e) => ({ wa_label_id: e.id, nome: e.nome.slice(0, 40), cor: cor(e.cor) })),
            })
          ).etiquetas;
          render();
          return;
        }
      }
      est.etiquetas = (await api("etiquetas")).etiquetas;
      render();
    } catch {}
  }

  const etiquetaWa = (id) => est.etiquetas.find((e) => e.id === id)?.wa_label_id || null;

  /** Etiquetas da conversa no WhatsApp Business → vínculo no banco (mudanças feitas no celular). */
  async function sincronizarEtiquetasDaConversa() {
    if (!est.waBusiness || !vinculada()) return;
    const doWa = new Set(await wa("etiquetasDaConversa", { chatId: est.conversa.id }));
    const soSistema = (est.vinculo.etiquetas || []).filter((id) => !etiquetaWa(id));
    const deWa = est.etiquetas.filter((e) => e.wa_label_id && doWa.has(e.wa_label_id)).map((e) => e.id);
    const novas = [...new Set([...soSistema, ...deWa])];
    const atuais = est.vinculo.etiquetas || [];
    if (novas.length === atuais.length && novas.every((id) => atuais.includes(id))) return;
    est.vinculo.etiquetas = (await api("vinculo/etiquetas", { vinculo_id: est.vinculo.id, etiquetas: novas })).etiquetas;
  }

  async function criarEtiqueta(nome, cor) {
    let r;
    if (est.waBusiness) {
      // cria no WhatsApp (a cor vem da paleta dele) e espelha no banco
      const w = await wa("criarEtiquetaWa", { nome });
      r = await api("etiquetas", { nome: w.nome, wa_label_id: w.id, ...(/^#[0-9a-f]{6}$/i.test(w.cor || "") ? { cor: w.cor } : {}) });
    } else r = await api("etiquetas", { nome, cor });
    est.etiquetas = [...est.etiquetas, r.etiqueta].sort((a, b) => a.nome.localeCompare(b.nome));
    if (vinculada()) await alternarEtiqueta(r.etiqueta.id);
  }

  async function alternarEtiqueta(id) {
    const atuais = est.vinculo.etiquetas || [];
    const marcar = !atuais.includes(id);
    const waId = est.waBusiness ? etiquetaWa(id) : null;
    // primeiro no WhatsApp (se falhar, o banco não muda)
    if (waId) await wa("marcarEtiquetaWa", { chatId: est.conversa.id, labelId: waId, marcar });
    const novas = marcar ? [...atuais, id] : atuais.filter((x) => x !== id);
    const r = await api("vinculo/etiquetas", { vinculo_id: est.vinculo.id, etiquetas: novas });
    est.vinculo.etiquetas = r.etiquetas;
  }

  async function apagarEtiqueta(id) {
    await api("etiquetas/apagar", { id });
    est.etiquetas = est.etiquetas.filter((e) => e.id !== id);
    if (est.vinculo?.etiquetas) est.vinculo.etiquetas = est.vinculo.etiquetas.filter((x) => x !== id);
  }

  /** prazo: número de dias a partir de hoje (às 9h), uma data "aaaa-mm-dd" ou null para limpar */
  async function definirPrazo(prazo, nota) {
    let iso = null;
    if (typeof prazo === "number") {
      const d = new Date();
      d.setDate(d.getDate() + prazo);
      d.setHours(9, 0, 0, 0);
      iso = d.toISOString();
    } else if (prazo) iso = new Date(`${prazo}T09:00:00`).toISOString();
    const r = await api("vinculo/prazo", { vinculo_id: est.vinculo.id, retornar_em: iso, nota: nota || undefined });
    est.vinculo.retornar_em = r.retornar_em;
    est.vinculo.retorno_nota = r.retorno_nota;
    chrome.runtime.sendMessage({ gc: "conferir-prazos" }).catch(() => {}); // atualiza o número no ícone
  }

  /**
   * Lista de clientes. A última lista de cada filtro fica guardada nesta faixa:
   * aparece na hora e é atualizada por trás (só o botão Atualizar gira).
   */
  async function carregarLista() {
    const f = est.filtros;
    const chave = JSON.stringify(f);
    if (!est.itensLista || est.chaveLista !== chave) {
      const guardada = ((await ler("listaCache")) || {})[chave];
      if (guardada && est.filtros === f) {
        est.itensLista = guardada;
        est.chaveLista = chave;
        render();
      }
    }
    const r = await api("lista", {
      ...(f.etiqueta_id ? { etiqueta_id: f.etiqueta_id } : {}),
      situacao: f.situacao,
      ...(f.sem_contato_dias ? { sem_contato_dias: Number(f.sem_contato_dias) } : {}),
      ordem: f.ordem,
    });
    if (JSON.stringify(est.filtros) !== chave) return; // o filtro mudou no meio do caminho
    est.itensLista = r.itens;
    est.chaveLista = chave;
    for (const i of r.itens) est.vinculados[i.wa_chat_id] = true;
    guardar({ vinculados: est.vinculados });
    const cache = (await ler("listaCache")) || {};
    cache[chave] = r.itens;
    // só os últimos filtros usados
    const chaves = Object.keys(cache);
    if (chaves.length > 8) delete cache[chaves[0]];
    guardar({ listaCache: cache });
  }

  /** Conversas que esta faixa sabe que estão vinculadas (para abrir numa chamada só). */
  function lembrarVinculo(chatId, vinculadaAgora) {
    if (Boolean(est.vinculados[chatId]) === vinculadaAgora) return;
    if (vinculadaAgora) est.vinculados[chatId] = true;
    else delete est.vinculados[chatId];
    guardar({ vinculados: est.vinculados });
  }

  /** Tempo parado do vínculo a partir das mensagens lidas do WhatsApp. */
  function atualizarTempoParado() {
    if (!est.vinculo || !est.msgsWa.length) return;
    const ultCli = [...est.msgsWa].reverse().find((m) => m.lado === "<");
    const ultCor = [...est.msgsWa].reverse().find((m) => m.lado === ">");
    const ult = est.msgsWa[est.msgsWa.length - 1];
    Object.assign(est.vinculo, {
      ultima_cliente_em: ultCli ? new Date(ultCli.ts * 1000).toISOString() : est.vinculo.ultima_cliente_em,
      ultima_corretor_em: ultCor ? new Date(ultCor.ts * 1000).toISOString() : est.vinculo.ultima_corretor_em,
      ultima_lado: ult?.lado ?? est.vinculo.ultima_lado,
    });
  }

  /**
   * Público da Transmissão comercial do WhatsApp Business: CSV no modelo que o
   * próprio app exporta (instrução, linha em branco, "Nome completo,Telefone"),
   * com a lista filtrada da faixa, em partes de até 256 destinatários.
   */
  function baixarPublico() {
    const itens = (est.itensLista || []).filter((i) => String(i.telefone || "").replace(/\D/g, "").length >= 10);
    const semTelefone = (est.itensLista || []).length - itens.length;
    if (!itens.length) throw new Error("Nenhum cliente da lista tem telefone para o público.");
    const celula = (s) => {
      const t = String(s ?? "").replace(/[\r\n]+/g, " ").trim();
      return /[",;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const etiqueta = est.etiquetas.find((e) => e.id === est.filtros.etiqueta_id)?.nome;
    const base = `publico-${(etiqueta || "clientes").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`;
    const partes = [];
    for (let i = 0; i < itens.length; i += 256) partes.push(itens.slice(i, i + 256));
    partes.forEach((parte, n) => {
      const linhas = [
        "Insira o nome completo e o telefone de cada destinatário em uma linha separada. Você pode adicionar até 256 destinatários a um público.",
        "",
        "Nome completo,Telefone",
        ...parte.map((i) => `${celula(i.nome || i.nome_contato || "Cliente")},+${String(i.telefone).replace(/\D/g, "")}`),
      ];
      const blob = new Blob(["﻿" + linhas.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = partes.length > 1 ? `${base}-parte-${n + 1}.csv` : `${base}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    });
    est.aviso = {
      tipo: "ok",
      texto:
        `Público baixado: ${itens.length} destinatário${itens.length === 1 ? "" : "s"}` +
        (partes.length > 1 ? ` em ${partes.length} arquivos (até 256 cada)` : "") +
        (semTelefone ? `; ${semTelefone} sem telefone ficaram de fora` : "") +
        ". Importe aqui no WhatsApp Web: Ferramentas comerciais › Transmissão comercial › Novo público › Importar público.",
    };
  }

  async function abrirDaLista(chatId) {
    await wa("abrirConversa", { chatId });
    est.aba = "conversa";
  }

  async function atualizarUso() {
    try {
      est.uso = await api("ia/uso");
      render();
    } catch {}
  }

  // ── telas ────────────────────────────────────────────────────────────────
  function render() {
    $topo.innerHTML =
      `<button type="button" data-acao="recolher" title="Recolher a faixa" aria-label="Recolher a faixa">${ic("recolher")}</button>` +
      (est.usuario ? `<button type="button" data-acao="sair" title="Sair da conta" aria-label="Sair da conta">${ic("sair")}</button>` : "");
    // o painel é redesenhado inteiro: guarda o que estava digitado e o foco
    const valores = {};
    let foco = null;
    $app.querySelectorAll("form[id] [name]").forEach((el) => {
      const k = `${el.form.id}.${el.name}`;
      if (el.type !== "radio") valores[k] = el.value;
      if (el === document.activeElement) foco = { k, ini: el.selectionStart, fim: el.selectionEnd };
    });
    $app.innerHTML = !est.sessao || !est.usuario ? telaLogin() : telaPrincipal();
    $app.querySelectorAll("form[id] [name]").forEach((el) => {
      const k = `${el.form.id}.${el.name}`;
      if (k in valores && el.type !== "radio" && el.tagName !== "SELECT" && valores[k]) el.value = valores[k];
      if (foco?.k === k) {
        el.focus();
        try {
          el.setSelectionRange(foco.ini, foco.fim);
        } catch {}
      }
    });
  }

  // ícones (traços do Lucide, MIT)
  const ICONES = {
    recolher: '<path d="M3 3h18v18H3z"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/>',
    sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    conversa: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    lista: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
    externo: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    relogio: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    etiqueta: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r=".5"/>',
    calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    ia: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
    microfone: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    atualizar: '<path d="M3 12a9 9 0 0 1 9-9 9.8 9.8 0 0 1 6.7 2.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.8 9.8 0 0 1-6.7-2.7L3 16"/><path d="M8 16H3v5"/>',
    trocar: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
    lapis: '<path d="M21.2 6.8a1 1 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z"/>',
    busca: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    disparo: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  };
  const ic = (nome, p) => `<svg class="ic${p ? " p" : ""}" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nome] || ""}</svg>`;
  const iniciais = (nome) =>
    String(nome || "?")
      .replace(/[^\p{L}\s]/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join("") || "#";

  function telaLogin() {
    const opcoes = CFG.servidores
      .map((s) => `<option value="${esc(s.url)}">${esc(s.nome)}</option>`)
      .join("");
    if (est.ocupado.auto)
      return `<section class="cartao"><span class="carregando"></span> Entrando com a sua conta do Gestão Comercial…</section>`;
    const sis = est.sistema || { situacao: "nenhum" };
    const nomeServ = (url) => (CFG.servidores.find((s) => s.url === url) || {}).nome || url;
    const blocoSistema =
      sis.situacao === "ok"
        ? `<section class="cartao"><p class="mudo" style="margin:0 0 8px">O Gestão Comercial (${esc(nomeServ(sis.servidor))}) está aberto neste Chrome com a conta <b>${esc(sis.email)}</b>.</p>
           <button type="button" class="dourado largo" data-acao="entrar-sistema">Entrar na faixa como ${esc(sis.email.split("@")[0])}</button></section>`
        : sis.situacao === "expirado"
          ? `<p class="aviso alerta">O login do Gestão Comercial neste navegador expirou. Abra o sistema (${esc(nomeServ(sis.servidor))}) e recarregue a página: a faixa entra sozinha.</p>`
          : `<p class="aviso">Não achei o Gestão Comercial logado neste navegador. Abra o sistema, entre e recarregue a página dele: a faixa entra sozinha. Ou use e-mail e senha abaixo.</p>`;
    return `
      ${blocoSistema}
      <section class="cartao">
        <h3>Entrar</h3>
        <p class="mudo">Com o Gestão Comercial aberto e logado neste navegador, a faixa entra sozinha. Ou use o mesmo e-mail e senha do sistema.</p>
        <form id="form-login">
          <label>Servidor<select name="servidor">${opcoes}</select></label>
          <label>E-mail<input name="email" type="email" autocomplete="username" required /></label>
          <label>Senha<input name="senha" type="password" autocomplete="current-password" required /></label>
          <button type="submit" class="primario largo" ${est.ocupado.login ? "disabled" : ""}>
            ${est.ocupado.login ? '<span class="carregando"></span>' : ""} Entrar
          </button>
        </form>
      </section>
      ${est.aviso ? `<p class="aviso ${est.aviso.tipo}" role="alert">${esc(est.aviso.texto)}</p>` : ""}
      <p class="rodape">Ao entrar, você aceita o <a href="${esc((CFG.servidores[0] || {}).url)}/termo-extensao" target="_blank" rel="noopener">termo de uso</a>.</p>`;
  }

  function telaPrincipal() {
    const partes = [];
    if (est.versaoPublicada && maisAntiga(VERSAO, est.versaoPublicada))
      partes.push(`<p class="aviso alerta">Há uma versão nova da extensão (${esc(est.versaoPublicada)}). Baixe em Gestão Comercial › Extensão WhatsApp.</p>`);
    if (!est.chave)
      partes.push(`<p class="aviso alerta">Cadastre sua chave do Groq para ter sugestões e transcrições: <a href="${esc(est.sessao.servidor)}/settings/chave-ia" target="_blank" rel="noopener">Minha chave de IA</a>.</p>`);
    if (est.erroWa) partes.push(`<p class="aviso erro">${esc(est.erroWa)}</p>`);
    if (est.aviso) partes.push(`<p class="aviso ${est.aviso.tipo}" role="status">${esc(est.aviso.texto)}</p>`);

    const aba = (id, icone, texto) =>
      `<button type="button" role="tab" aria-selected="${est.aba === id}" class="${est.aba === id ? "ativa" : ""}" data-acao="aba" data-aba="${id}">${ic(icone, true)} ${texto}</button>`;
    partes.push(
      `<div class="abas" role="tablist" aria-label="Seções da faixa">${aba("lista", "lista", "Clientes")}${aba("conversa", "conversa", "Conversa")}${aba("disparo", "disparo", "Disparo")}</div>`,
    );
    if (est.aba === "lista") {
      partes.push(telaLista(), rodape());
      return partes.join("");
    }
    if (est.aba === "disparo") {
      partes.push(telaDisparo(), rodape());
      return partes.join("");
    }

    const c = est.conversa;
    if (!est.waPronto && !est.erroWa) partes.push(`<section class="cartao"><span class="carregando"></span> Esperando o WhatsApp Web carregar…</section>`);
    else if (!c)
      partes.push(`<section class="cartao"><p class="mudo" style="margin:0">Abra a conversa de um cliente no WhatsApp, ou escolha um na aba Clientes.</p></section>`);
    else if (c.grupo) partes.push(`<section class="cartao"><h3>${esc(c.nome)}</h3><p class="mudo">Grupos não são lidos pela extensão.</p></section>`);
    else partes.push(cartaoConversa());

    if (vinculada()) partes.push(cartaoSugestoes(), cartaoAudios());
    partes.push(rodape());
    return partes.join("");
  }

  function cartaoConversa() {
    const c = est.conversa;
    const v = est.vinculo;
    const nomeCab = est.hypnobox?.nome || c.nome || c.telefone;
    const cab = `<div class="cliente"><span class="avatar" aria-hidden="true">${esc(iniciais(nomeCab))}</span>
      <div class="info"><h3 title="${esc(nomeCab)}">${esc(nomeCab)}</h3><span class="mudo">${esc(formatarTel(c.telefone))}</span></div>${
        est.carregando ? '<span class="carregando" role="status" aria-label="Carregando"></span>' : ""
      }</div>`;
    if (est.carregando && !v && !est.candidatos) return `<section class="cartao">${cab}</section>`;
    if (est.trocando)
      return `<section class="cartao">${cab}${est.candidatos ? cartaoCandidatos() : ""}
        <p style="margin:8px 0 0"><button type="button" class="pequeno" data-acao="cancelar-troca">Cancelar</button></p></section>`;
    if (v && v.nao_cliente)
      return `<section class="cartao">${cab}<p class="mudo">Marcada como não é cliente: a extensão não lê esta conversa.</p>
        <button type="button" class="pequeno" data-acao="desfazer-nao-cliente">Desfazer</button></section>`;
    if (v) {
      const h = est.hypnobox;
      const l = est.lead;
      const esperando = v.ultima_lado === "<";
      const tempo = esperando
        ? `<span class="selo alerta">${ic("relogio", true)} Esperando sua resposta há ${esc(ha(v.ultima_cliente_em))}</span>`
        : v.ultima_lado === ">"
          ? `<span class="selo">${ic("relogio", true)} Aguardando o cliente há ${esc(ha(v.ultima_corretor_em))}</span>`
          : "";
      return `<section class="cartao">${cab}
        ${tempo ? `<div style="margin-top:10px">${tempo}</div>` : ""}
        ${
          h
            ? `<dl class="dados">
            <dt>Hypnobox</dt><dd>${esc(h.id_cliente)}</dd>
            ${h.etapa ? `<dt>Etapa</dt><dd>${esc(h.etapa)}${h.submomento ? ` · ${esc(h.submomento)}` : ""}</dd>` : ""}
            ${h.produto ? `<dt>Produto</dt><dd>${esc(h.produto)}</dd>` : ""}
            ${h.canal ? `<dt>Origem</dt><dd>${esc(h.canal)}${h.campanha ? ` · ${esc(h.campanha)}` : ""}</dd>` : ""}
            ${h.dias_sem_atualizar != null ? `<dt>Atualizado</dt><dd>há ${h.dias_sem_atualizar} dia${h.dias_sem_atualizar === 1 ? "" : "s"} no Hypnobox</dd>` : ""}
          </dl>`
            : ""
        }
        ${l ? `<dl class="dados"><dt>CRM</dt><dd>${esc(l.full_name)}${l.client_code ? ` · ${esc(l.client_code)}` : ""}</dd></dl>` : ""}
        <div class="acoes">
          ${h ? `<a class="botao pequeno" href="${esc(h.link)}" target="_blank" rel="noopener">${ic("externo", true)} Abrir no Hypnobox</a>` : ""}
          <button type="button" class="pequeno" data-acao="trocar-cliente">${ic("trocar", true)} Trocar cliente</button>
        </div>
      </section>
      ${cartaoEtiquetasPrazo()}`;
    }
    return `<section class="cartao">${cab}${cartaoCandidatos()}</section>`;
  }

  function cartaoCandidatos() {
    const k = est.candidatos || { leads: [], hypnobox: [] };
    const itens = [
      ...k.hypnobox.map(
        (h) => `<li class="item"><div class="info"><div class="nome">${esc(h.nome || "Cliente " + h.id_cliente)}</div>
          <div class="mudo">Hypnobox ${esc(h.id_cliente)}${h.etapa ? ` · ${esc(h.etapa)}` : ""}${h.produto ? ` · ${esc(h.produto)}` : ""}</div></div>
          <button type="button" class="pequeno dourado" data-acao="vincular-hyp" data-id="${esc(h.id_cliente)}">Vincular</button></li>`,
      ),
      ...k.leads.map(
        (l) => `<li class="item"><div class="info"><div class="nome">${esc(l.full_name)}</div><div class="mudo">CRM${l.client_code ? ` · ${esc(l.client_code)}` : ""}</div></div>
          <button type="button" class="pequeno dourado" data-acao="vincular-lead" data-id="${esc(l.id)}">Vincular</button></li>`,
      ),
    ];
    return `
      <p class="mudo" style="margin:8px 0">${
        est.termoBusca
          ? itens.length
            ? `Resultado para "${esc(est.termoBusca)}":`
            : `Nada encontrado para "${esc(est.termoBusca)}" entre os seus clientes.`
          : itens.length
            ? "Encontrei pelo telefone. É este cliente?"
            : k.deOutroCorretor
              ? "Este telefone é de um cliente de outro corretor no Hypnobox."
              : "Não encontrei este telefone entre os seus clientes."
      }</p>
      ${itens.length ? `<ul class="lista">${itens.join("")}</ul>` : ""}
      <form id="form-busca" style="margin-top:10px">
        <label for="busca-cliente" style="margin:0">Buscar pelo nome ou e-mail (Hypnobox e CRM)</label>
        <div class="campo-linha">
          <input id="busca-cliente" name="nome" minlength="3" placeholder="Nome ou e-mail do cliente" />
          <button type="submit" class="pequeno" aria-label="Buscar">${ic("busca", true)}</button>
        </div>
      </form>
      <hr class="separador" />
      <button type="button" class="pequeno largo" data-acao="nao-cliente">Não é cliente (não ler esta conversa)</button>`;
  }

  function cartaoSugestoes() {
    const oc = est.ocupado.sugerir;
    const lista = est.sugestoes
      ? `<ul class="lista" style="margin-top:8px">${est.sugestoes
          .map(
            (s, i) =>
              `<li><button type="button" class="sugestao" data-acao="usar" data-i="${i}">${esc(s.texto)}${s.porque ? `<small>${esc(s.porque)}</small>` : ""}</button></li>`,
          )
          .join("")}</ul><p class="mudo" style="margin:6px 0 0">Clique para colocar na caixa de mensagem.</p>`
      : "";
    return `<section class="cartao">
      <h2>${ic("ia", true)} Sugestão de resposta</h2>
      <form id="form-sugerir">
        <label for="pedido-ia" class="mudo" style="margin:0">O que você quer dizer (opcional)</label>
        <textarea id="pedido-ia" name="pedido" placeholder="Ex.: convidar para visita no sábado"></textarea>
        <button type="submit" class="primario largo" style="margin-top:8px" ${oc || !est.chave ? "disabled" : ""}>
          ${oc ? '<span class="carregando"></span> Pensando…' : `${ic("ia", true)} Sugerir resposta`}
        </button>
      </form>${lista}</section>`;
  }

  function cartaoAudios() {
    const audios = est.msgsWa.filter((m) => m.tipo === "a").slice(-6).reverse();
    if (!audios.length) return "";
    const itens = audios
      .map((m) => {
        const g = est.guardadas.find((x) => x.ts === m.ts && x.id === idCurto(m.id));
        const quem = m.lado === ">" ? "Você" : "Cliente";
        const quando = new Date(m.ts * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        const oc = est.ocupado["tr-" + m.id];
        return `<li class="item audio"><div class="info" style="width:100%"><div class="linha"><span class="mudo"><b style="color:var(--texto)">${quem}</b> · ${quando}${m.seg ? ` · ${m.seg}s` : ""}</span>
          ${g?.texto ? "" : `<button type="button" class="pequeno" data-acao="transcrever" data-id="${esc(m.id)}" ${oc || !est.chave ? "disabled" : ""}>${oc ? '<span class="carregando"></span> Transcrevendo' : "Transcrever"}</button>`}</div>
          ${g?.texto ? `<p>${esc(g.texto)}</p>` : ""}</div></li>`;
      })
      .join("");
    return `<section class="cartao"><h2>${ic("microfone", true)} Áudios recentes</h2><ul class="lista">${itens}</ul></section>`;
  }

  const chip = (e, extra = "") =>
    `<span class="chip" style="--cor:${esc(e.cor)}" ${extra}>${esc(e.nome)}</span>`;

  function cartaoEtiquetasPrazo() {
    const v = est.vinculo;
    const minhas = new Set(v.etiquetas || []);
    const atuais = est.etiquetas.filter((e) => minhas.has(e.id));
    const prazo = v.retornar_em
      ? `<p class="aviso ${vencido(v.retornar_em) ? "erro" : "ok"}" style="margin-bottom:8px">${ic("calendario", true)}
           <span><b>${vencido(v.retornar_em) ? "Prazo vencido" : "Falar até"} ${esc(dataCurta(v.retornar_em))}</b>${v.retorno_nota ? `<br>${esc(v.retorno_nota)}` : ""}</span></p>`
      : `<p class="mudo" style="margin:0 0 8px">Sem prazo marcado.</p>`;
    const editor = est.editandoEtiquetas
      ? `<div class="chips" style="margin-top:10px">${
          est.etiquetas
            .map(
              (e) =>
                `<button type="button" class="chip-botao ${minhas.has(e.id) ? "marcada" : ""}" style="--cor:${esc(e.cor)}" data-acao="alternar-etiqueta" data-id="${esc(e.id)}" aria-pressed="${minhas.has(e.id)}">${esc(e.nome)}</button>`,
            )
            .join("") || '<span class="mudo">Você ainda não tem etiquetas: crie a primeira abaixo.</span>'
        }</div>
        <form id="form-etiqueta" style="margin-top:10px">
          <label for="nova-etiqueta" style="margin:0">Nova etiqueta</label>
          <div class="campo-linha">
            <input id="nova-etiqueta" name="nome" maxlength="40" placeholder="Ex.: Quente, Investidor" />
            <button type="submit" class="pequeno">Criar</button>
          </div>
          ${
            est.waBusiness
              ? '<p class="mudo" style="margin:6px 0 0">São as etiquetas do seu WhatsApp Business: aparecem também no celular. A cor segue a paleta do WhatsApp.</p>'
              : `<fieldset class="cores" aria-label="Cor da etiqueta">${CORES.map(
                  (c, i) => `<label title="Cor ${i + 1}"><input type="radio" name="cor" value="${c}" ${i === 7 ? "checked" : ""} /><span style="--cor:${c}"></span></label>`,
                ).join("")}</fieldset>`
          }
        </form>
        <button type="button" class="pequeno largo" style="margin-top:10px" data-acao="fechar-etiquetas">Pronto</button>`
      : "";
    return `<section class="cartao">
      <div class="linha"><h2 style="margin:0">${ic("etiqueta", true)} Etiquetas</h2>
        ${est.editandoEtiquetas ? "" : `<button type="button" class="pequeno" data-acao="editar-etiquetas">${ic("lapis", true)} Editar</button>`}</div>
      <div class="chips" style="margin-top:8px">${atuais.map((e) => chip(e)).join("") || '<span class="mudo">Nenhuma etiqueta.</span>'}</div>
      ${editor}
      <hr class="separador" />
      <h2>${ic("calendario", true)} Próximo contato</h2>
      ${prazo}
      <div class="chips">
        <button type="button" class="pequeno" data-acao="prazo" data-dias="1">Amanhã</button>
        <button type="button" class="pequeno" data-acao="prazo" data-dias="3">3 dias</button>
        <button type="button" class="pequeno" data-acao="prazo" data-dias="7">1 semana</button>
        ${v.retornar_em ? '<button type="button" class="pequeno" data-acao="prazo-limpar">Limpar</button>' : ""}
      </div>
      <form id="form-prazo" class="campo-linha" style="margin-top:8px">
        <input type="date" name="data" aria-label="Outra data para o próximo contato" required />
        <button type="submit" class="pequeno">Definir</button>
      </form>
    </section>`;
  }

  function telaLista() {
    const f = est.filtros;
    const opEt = est.etiquetas.map((e) => `<option value="${esc(e.id)}" ${f.etiqueta_id === e.id ? "selected" : ""}>${esc(e.nome)}</option>`).join("");
    const op = (valor, texto, atual) => `<option value="${valor}" ${String(atual) === String(valor) ? "selected" : ""}>${texto}</option>`;
    const filtros = `<form id="form-filtros" class="cartao filtros">
      <label>Etiqueta<select name="etiqueta_id"><option value="">Todas</option>${opEt}</select></label>
      <label>Situação<select name="situacao">
        ${op("todas", "Todas", f.situacao)}${op("esperando", "Esperando minha resposta", f.situacao)}${op("aguardando", "Aguardando o cliente", f.situacao)}
        ${op("vencido", "Prazo vencido", f.situacao)}${op("com_prazo", "Com prazo marcado", f.situacao)}</select></label>
      <label>Sem contato há<select name="sem_contato_dias">
        ${op("", "Qualquer tempo", f.sem_contato_dias)}${op(3, "3+ dias", f.sem_contato_dias)}${op(7, "7+ dias", f.sem_contato_dias)}${op(15, "15+ dias", f.sem_contato_dias)}${op(30, "30+ dias", f.sem_contato_dias)}</select></label>
      <label>Ordem<select name="ordem">
        ${op("sem_contato", "Mais tempo sem contato primeiro", f.ordem)}${op("prazo", "Prazo mais próximo primeiro", f.ordem)}${op("recente", "Contato mais recente primeiro", f.ordem)}</select></label>
    </form>`;
    if (!est.itensLista)
      return `${filtros}<section class="cartao">${est.ocupado.lista ? '<span class="carregando"></span> Carregando…' : '<p class="mudo">Carregando a lista…</p>'}</section>`;
    const itens = est.itensLista
      .map((i) => {
        const d = dias(i.ultimo_contato_em);
        const esperando = i.ultima_lado === "<" && !i.ultima_cliente_so_ok;
        const ets = est.etiquetas.filter((e) => (i.etiquetas || []).includes(e.id));
        const venc = vencido(i.retornar_em);
        const estado = venc ? "vencido" : esperando ? "esperando" : "";
        return `<li><button type="button" class="item-lista ${estado}" data-acao="abrir-da-lista" data-chat="${esc(i.wa_chat_id)}">
          <span class="linha" style="flex-wrap:nowrap"><b style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.nome || "Cliente")}</b>${
            i.retornar_em
              ? `<span class="selo ${venc ? "erro" : "ok"}">${ic("calendario", true)} ${venc ? "Vencido" : "Até"} ${esc(dataCurta(i.retornar_em).slice(0, 5))}</span>`
              : ""
          }</span>
          ${i.etapa ? `<span class="mudo">${esc(i.etapa)}${i.produto ? ` · ${esc(i.produto)}` : ""}</span>` : ""}
          <span class="mudo">${ic("relogio", true)} ${
            d == null ? "sem mensagens guardadas" : d === 0 ? "contato hoje" : `${d} dia${d === 1 ? "" : "s"} sem contato`
          }${esperando ? ' · <b style="color:var(--alerta)">esperando você</b>' : ""}</span>
          ${ets.length ? `<span class="chips" style="margin-top:2px">${ets.map((e) => chip(e)).join("")}</span>` : ""}
        </button></li>`;
      })
      .join("");
    return `${filtros}<section class="cartao">
      <div class="linha"><h2 style="margin:0">${est.itensLista.length} cliente${est.itensLista.length === 1 ? "" : "s"}</h2>
        <button type="button" class="pequeno" data-acao="recarregar-lista" aria-label="Atualizar a lista">${
          est.ocupado.lista ? '<span class="carregando"></span>' : ic("atualizar", true)
        } Atualizar</button></div>
      ${
        itens
          ? `<button type="button" class="pequeno largo" style="margin-top:10px" data-acao="baixar-publico" title="Arquivo no modelo de público das Transmissões comerciais do WhatsApp Business">${ic("download", true)} Baixar público (CSV) para transmissão</button>
             <ul class="lista" style="margin-top:10px">${itens}</ul>`
          : '<p class="mudo" style="margin:8px 0 0">Nenhum cliente com esses filtros. Só entram as conversas que você vinculou.</p>'
      }
    </section>`;
  }

  // ── guia do disparo (aba Disparo) ─────────────────────────────────────────
  // O disparo é feito pela Transmissão comercial do próprio WhatsApp Business;
  // a faixa prepara (escolhe os clientes, etiqueta, baixa o público em CSV) e
  // ensina o caminho. "Concluí" registra o passo 9 da guia de primeiros passos.
  const PASSOS_DISPARO = [
    {
      t: "Escolha os clientes",
      d: [
        "Na aba Clientes, filtre quem vai receber: por etiqueta, situação (ex.: esperando minha resposta) ou tempo sem contato.",
        "Disparo bom é para um grupo com o mesmo interesse: mesmo produto, mesma região, mesma etapa.",
      ],
      botao: { texto: "Ir para Clientes", acao: "disparo-clientes" },
    },
    {
      t: "Marque a etiqueta e baixe o público",
      d: [
        "Abra cada cliente escolhido (clique nele na aba Clientes) e, na aba Conversa › Etiquetas › Editar, marque a etiqueta do envio (ex.: \"312 JAM sábado\"). Ela aparece também no celular.",
        "Na aba Clientes, filtre pela etiqueta do envio e clique em Baixar público (CSV): sai no modelo do WhatsApp, até 256 por arquivo, na pasta Downloads.",
      ],
      botao: { texto: "Ir para Clientes", acao: "disparo-clientes" },
    },
    {
      t: "Importe o público no WhatsApp Web",
      d: [
        "No menu da esquerda do WhatsApp Web: ícone da loja (Ferramentas comerciais) › Transmissão comercial.",
        "Aba Públicos › Novo público › Importar público › escolha o CSV baixado.",
        "Se preferir, use um público sugerido pelo próprio WhatsApp (conversas ativas, inativas, seus contatos).",
      ],
    },
    {
      t: "Créditos",
      d: [
        "As Transmissões comerciais são pagas por crédito (não existe mais lista de transmissão grátis).",
        "Compre no WhatsApp Business do celular: Ferramentas comerciais › Transmissões comerciais › Créditos para mensagens (pacotes de 250 a 10.000 mensagens; o app mostra o valor antes).",
      ],
    },
    {
      t: "Crie a transmissão",
      d: [
        "Em Transmissão comercial › Criar transmissão › Escolher público: selecione o público importado.",
        "Mensagem: abra a conversa de um cliente do grupo e use Sugerir resposta na aba Conversa (a IA só cita imóveis cadastrados). Ajuste e cole na transmissão. Anexo opcional: book, tabela ou foto.",
        "Confira a prévia e o resumo (destinatários de 256 e custo estimado) e clique em Enviar agora.",
      ],
    },
    {
      t: "Depois do envio",
      d: [
        "Marque um prazo de contato para quem não responder (aba Conversa › Próximo contato): o ícone da extensão avisa quando vencer.",
        "Acompanhe as respostas na aba Clientes, situação \"Esperando minha resposta\".",
      ],
    },
  ];

  function telaDisparo() {
    const i = Math.min(est.passoDisparo || 0, PASSOS_DISPARO.length - 1);
    const p = PASSOS_DISPARO[i];
    const ultimo = i === PASSOS_DISPARO.length - 1;
    return `<section class="cartao">
      <h2>${ic("disparo", true)} Preparar o disparo</h2>
      <div class="progresso" role="progressbar" aria-valuemin="1" aria-valuemax="${PASSOS_DISPARO.length}" aria-valuenow="${i + 1}" aria-label="Passo ${i + 1} de ${PASSOS_DISPARO.length}"><i style="width:${((i + 1) / PASSOS_DISPARO.length) * 100}%"></i></div>
      <p class="mudo" style="margin:10px 0 2px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:11px">Passo ${i + 1} de ${PASSOS_DISPARO.length}</p>
      <h3 style="margin-bottom:8px">${esc(p.t)}</h3>
      <ol class="passos">${p.d.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
      ${p.botao ? `<button type="button" class="pequeno largo" style="margin-top:8px" data-acao="${p.botao.acao}">${ic("lista", true)} ${esc(p.botao.texto)}</button>` : ""}
      <div class="linha" style="margin-top:12px;flex-wrap:nowrap">
        <button type="button" class="pequeno" data-acao="disparo-voltar" ${i === 0 ? "disabled" : ""}>Voltar</button>
        ${
          ultimo
            ? `<button type="button" class="pequeno primario" data-acao="disparo-concluir" ${est.ocupado.guia ? "disabled" : ""}>Concluí</button>`
            : '<button type="button" class="pequeno primario" data-acao="disparo-proximo">Próximo</button>'
        }
      </div>
    </section>`;
  }

  function rodape() {
    const u = est.uso?.uso || [];
    const sug = u.filter((x) => x.tipo === "sugestao").reduce((a, x) => a + x.pedidos, 0);
    const seg = u.filter((x) => x.tipo === "transcricao").reduce((a, x) => a + x.segundos_audio, 0);
    return `<p class="rodape">${esc(est.usuario?.nome || "")} · v${VERSAO}${
      u.length ? ` · hoje: ${sug} sugest${sug === 1 ? "ão" : "ões"}, ${Math.round(seg / 60)} min de áudio` : ""
    }</p>`;
  }

  const formatarTel = (t) => {
    const d = String(t || "").replace(/\D/g, "");
    const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
    return m ? `(${m[1]}) ${m[2]}-${m[3]}` : d;
  };
  const maisAntiga = (a, b) => {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
    return false;
  };

  // ── eventos da tela ──────────────────────────────────────────────────────
  document.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === "form-login") acao("login", () => entrar(f));
    else if (f.id === "form-busca" && f.nome.value.trim().length >= 3) acao("busca", () => abrirConversa(f.nome.value.trim()));
    else if (f.id === "form-sugerir") acao("sugerir", () => sugerir(f.pedido.value.trim()));
    else if (f.id === "form-etiqueta" && f.nome.value.trim()) acao("etiqueta", () => criarEtiqueta(f.nome.value.trim(), f.cor?.value));
    else if (f.id === "form-prazo" && f.data.value) acao("prazo", () => definirPrazo(f.data.value));
  });

  // filtros da lista: recarrega a cada mudança
  document.addEventListener("change", (e) => {
    const f = e.target.closest("#form-filtros");
    if (!f) return;
    est.filtros = {
      etiqueta_id: f.etiqueta_id.value,
      situacao: f.situacao.value,
      sem_contato_dias: f.sem_contato_dias.value,
      ordem: f.ordem.value,
    };
    acao("lista", carregarLista);
  });

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-acao]");
    if (!b) return;
    const a = b.dataset.acao;
    if (a === "aba") {
      est.aba = b.dataset.aba;
      render();
      if (est.aba === "lista") acao("lista", carregarLista);
    } else if (a === "disparo-proximo" || a === "disparo-voltar") {
      est.passoDisparo = Math.max(0, (est.passoDisparo || 0) + (a === "disparo-proximo" ? 1 : -1));
      render();
    } else if (a === "disparo-clientes") {
      est.aba = "lista";
      render();
      acao("lista", carregarLista);
    } else if (a === "disparo-concluir")
      acao("guia", async () => {
        await api("guia/passo", { passo: "disparo" });
        est.passoDisparo = 0;
        est.aviso = { tipo: "ok", texto: "Guia do disparo concluída e registrada nos seus primeiros passos." };
      });
    else if (a === "recarregar-lista") acao("lista", carregarLista);
    else if (a === "baixar-publico") acao("publico", async () => baixarPublico());
    else if (a === "abrir-da-lista") acao("abrir", () => abrirDaLista(b.dataset.chat));
    else if (a === "editar-etiquetas") {
      est.editandoEtiquetas = true;
      render();
    } else if (a === "fechar-etiquetas") {
      est.editandoEtiquetas = false;
      render();
    } else if (a === "alternar-etiqueta") acao("etiqueta", () => alternarEtiqueta(b.dataset.id));
    else if (a === "prazo") acao("prazo", () => definirPrazo(Number(b.dataset.dias)));
    else if (a === "prazo-limpar") acao("prazo", () => definirPrazo(null));
    else if (a === "sair") sair(true);
    else if (a === "entrar-sistema") entrarPeloSistema(true);
    else if (a === "recolher") parent.postMessage({ gc: "recolher" }, "https://web.whatsapp.com");
    else if (a === "vincular-hyp") acao("vincular", () => vincular({ id_cliente_hypnobox: b.dataset.id }));
    else if (a === "vincular-lead") acao("vincular", () => vincular({ lead_id: b.dataset.id }));
    else if (a === "nao-cliente") acao("vincular", () => vincular({ nao_cliente: true }));
    else if (a === "desfazer-nao-cliente" || a === "trocar-cliente") {
      est.trocando = true;
      est.candidatos = null;
      est.sugestoes = null;
      acao("busca", () => abrirConversa());
    } else if (a === "cancelar-troca") {
      est.trocando = false;
      render();
      if (vinculada()) acao("sinc", () => sincronizar());
    } else if (a === "usar") acao("usar", () => usarSugestao(est.sugestoes[Number(b.dataset.i)].texto));
    else if (a === "transcrever") {
      const m = est.msgsWa.find((x) => x.id === b.dataset.id);
      if (m) acao("tr-" + m.id, () => transcrever(m));
    }
  });

  // servidor escolhido da última vez
  ler("ultimoServidor").then((s) => {
    if (s) {
      const i = CFG.servidores.findIndex((x) => x.url === s);
      if (i > 0) CFG.servidores.unshift(...CFG.servidores.splice(i, 1));
    }
    iniciar();
  });
})();
